import { createHash, randomUUID } from "node:crypto";
import type { Context, Next } from "hono";
import { getAuthUser } from "./auth";
import { prisma } from "./prisma";
import { acquireTransactionLock } from "./db-lock";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const FALLBACK_DEDUPLICATION_MS = Math.max(
  500,
  Number(process.env.IDEMPOTENCY_FALLBACK_WINDOW_MS || 3_000),
);
const RECORD_TTL_DAYS = Math.max(1, Number(process.env.IDEMPOTENCY_RECORD_TTL_DAYS || 30));
const PROCESSING_WAIT_MS = Math.max(
  1_000,
  Number(process.env.IDEMPOTENCY_PROCESSING_WAIT_MS || 15_000),
);
const MAX_REPLAY_BODY_BYTES = Math.max(
  64 * 1024,
  Number(process.env.IDEMPOTENCY_MAX_RESPONSE_BYTES || 2 * 1024 * 1024),
);

const EXCLUDED_PATHS = [
  "/api/auth/",
  "/api/exports/",
  "/api/settings/reset-system",
  "/api/backups/restore",
];

function isExcludedPath(path: string) {
  if (path === "/api/pos/scan") return true;
  if (path.startsWith("/api/backups/") && path.endsWith("/restore")) return true;
  return EXCLUDED_PATHS.some((prefix) => path.startsWith(prefix));
}

function normalizeUrl(urlValue: string) {
  const url = new URL(urlValue);
  const sorted = new URLSearchParams(
    [...url.searchParams.entries()].sort(
      ([leftKey, leftValue], [rightKey, rightValue]) =>
        leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue),
    ),
  );
  return `${url.pathname}${sorted.size ? `?${sorted.toString()}` : ""}`;
}

async function hashMultipartRequest(formData: FormData, hash: ReturnType<typeof createHash>) {
  let index = 0;
  for (const [name, value] of formData.entries()) {
    hash.update(`field:${index}:${name}:`);
    if (typeof value === "string") {
      hash.update(`text:${value}`);
    } else {
      hash.update(`file:${value.name}:${value.type}:${value.size}:`);
      hash.update(Buffer.from(await value.arrayBuffer()));
    }
    hash.update("\u0000");
    index += 1;
  }
}

async function createRequestHash(c: Context) {
  const hash = createHash("sha256");
  const normalizedUrl = normalizeUrl(c.req.url);
  const contentType = (c.req.header("content-type") || "").toLowerCase();
  hash.update(`${c.req.method}:${normalizedUrl}:`);

  const suppliedPayloadHash = c.req.header("x-idempotency-payload-hash")?.trim();
  if (suppliedPayloadHash) {
    hash.update(`client:${suppliedPayloadHash}`);
  }

  if (contentType.includes("multipart/form-data")) {
    await hashMultipartRequest(await c.req.formData(), hash);
  } else {
    // Use Hono's body cache. Reading raw.clone() repeatedly under sustained
    // load can leave downstream route parsers with an unusable stream.
    hash.update(Buffer.from(await c.req.arrayBuffer()));
  }

  return {
    requestHash: hash.digest("hex"),
    path: normalizedUrl,
  };
}

function operationScope(c: Context) {
  const user = getAuthUser(c);
  if (user) return `user:${user.id}`;

  const device =
    c.req.header("x-pos-device-code") ||
    c.req.header("x-device-id") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "public";
  return `device:${device}`;
}

function expiresAt() {
  return new Date(Date.now() + RECORD_TTL_DAYS * 24 * 60 * 60 * 1_000);
}

async function waitForCompletion(id: string) {
  const deadline = Date.now() + PROCESSING_WAIT_MS;
  while (Date.now() < deadline) {
    const record = await prisma.idempotencyRecord.findUnique({ where: { id } });
    if (!record || record.status !== "PROCESSING") return record;
    await new Promise((resolve) => setTimeout(resolve, 125));
  }

  return prisma.idempotencyRecord.findUnique({ where: { id } });
}

function replayRecord(record: {
  id: string;
  operationKey: string;
  status: string;
  responseStatus: number | null;
  responseBody: string | null;
  responseContentType: string | null;
  errorMessage: string | null;
}) {
  const headers = new Headers({
    "X-Operation-Id": record.operationKey,
    "Idempotency-Replayed": "true",
    "Cache-Control": "no-store",
  });

  if (record.status === "COMPLETED" && record.responseBody !== null) {
    if (record.responseContentType) headers.set("Content-Type", record.responseContentType);
    return new Response(record.responseBody, {
      status: record.responseStatus || 200,
      headers,
    });
  }

  const message =
    record.status === "PROCESSING"
      ? "این عملیات هنوز در حال پردازش است؛ چند لحظه بعد دوباره تلاش کنید."
      : record.errorMessage ||
        "وضعیت عملیات قبلی مشخص است، اما پاسخ آن قابل بازپخش نیست. عملیات جدید بسازید.";
  headers.set("Content-Type", "application/json; charset=UTF-8");
  const replayStatus =
    record.status === "PROCESSING" ||
    (record.status === "COMPLETED" && record.responseBody === null)
      ? 409
      : record.responseStatus || 409;
  return new Response(JSON.stringify({ message, operationId: record.operationKey }), {
    status: replayStatus,
    headers,
  });
}

export async function idempotencyMiddleware(c: Context, next: Next) {
  const method = c.req.method.toUpperCase();
  const pathName = new URL(c.req.url).pathname;
  if (!WRITE_METHODS.has(method) || isExcludedPath(pathName)) {
    await next();
    return;
  }

  const explicitKey =
    c.req.header("idempotency-key")?.trim() || c.req.header("x-idempotency-key")?.trim() || "";
  if (explicitKey && (explicitKey.length < 8 || explicitKey.length > 200)) {
    return c.json({ message: "شناسه عملیات معتبر نیست." }, 400);
  }

  const { requestHash, path } = await createRequestHash(c);
  const scope = operationScope(c);
  const userId = getAuthUser(c)?.id || null;
  const recordData = {
    operationKey: explicitKey || randomUUID(),
    scope,
    requestHash,
    method,
    path,
    userId,
    expiresAt: expiresAt(),
  };
  const reserved = explicitKey
    ? await (async () => {
        try {
          const record = await prisma.idempotencyRecord.create({ data: recordData });
          return { owner: true as const, record };
        } catch (error) {
          if ((error as { code?: string } | null)?.code !== "P2002") throw error;
          const record = await prisma.idempotencyRecord.findUnique({
            where: { scope_operationKey: { scope, operationKey: explicitKey } },
          });
          if (!record) throw error;
          return { owner: false as const, record };
        }
      })()
    : await prisma.$transaction(async (tx) => {
        const lockId = explicitKey || requestHash;
        await acquireTransactionLock(tx, "idempotency", `${scope}:${lockId}`);

        const existing = explicitKey
          ? await tx.idempotencyRecord.findUnique({
              where: { scope_operationKey: { scope, operationKey: explicitKey } },
            })
          : await tx.idempotencyRecord.findFirst({
              where: {
                scope,
                requestHash,
                createdAt: { gte: new Date(Date.now() - FALLBACK_DEDUPLICATION_MS) },
              },
              orderBy: { createdAt: "desc" },
            });

        if (existing) {
          return { owner: false as const, record: existing };
        }

        const record = await tx.idempotencyRecord.create({
          data: recordData,
        });
        return { owner: true as const, record };
      });

  if (!reserved.owner) {
    if (reserved.record.requestHash !== requestHash) {
      return c.json(
        {
          message: "این شناسه عملیات قبلاً برای درخواست دیگری استفاده شده است.",
          operationId: reserved.record.operationKey,
        },
        409,
      );
    }

    const settled =
      reserved.record.status === "PROCESSING"
        ? await waitForCompletion(reserved.record.id)
        : reserved.record;
    if (!settled) {
      return c.json({ message: "رکورد عملیات قبلی پیدا نشد." }, 409);
    }
    return replayRecord(settled);
  }

  c.header("X-Operation-Id", reserved.record.operationKey);
  try {
    await next();
    const clonedResponse = c.res.clone();
    const body = await clonedResponse.text();
    const bodySize = Buffer.byteLength(body, "utf8");
    const responseStatus = c.res.status;
    const responseContentType = c.res.headers.get("content-type");
    const replayableBody = bodySize <= MAX_REPLAY_BODY_BYTES ? body : null;

    await prisma.idempotencyRecord.update({
      where: { id: reserved.record.id },
      data: {
        status: responseStatus < 500 ? "COMPLETED" : "FAILED",
        responseStatus,
        responseBody: replayableBody,
        responseContentType,
        errorMessage:
          responseStatus >= 500
            ? "عملیات قبلی با خطای سرور متوقف شد؛ برای جلوگیری از تکرار خودکار، عملیات تازه بسازید."
            : replayableBody === null
              ? "پاسخ عملیات برای بازپخش بسیار بزرگ بود."
              : null,
        expiresAt: expiresAt(),
      },
    });
  } catch (error) {
    await prisma.idempotencyRecord
      .update({
        where: { id: reserved.record.id },
        data: {
          status: "FAILED",
          responseStatus: 500,
          errorMessage:
            error instanceof Error
              ? error.message.slice(0, 1_000)
              : "عملیات با خطای نامشخص متوقف شد.",
          expiresAt: expiresAt(),
        },
      })
      .catch(() => undefined);
    throw error;
  }
}

export function startIdempotencyCleanupScheduler() {
  const cleanup = async () => {
    try {
      await prisma.idempotencyRecord.deleteMany({
        where: {
          status: { in: ["COMPLETED", "FAILED"] },
          expiresAt: { lt: new Date() },
        },
      });
    } catch (error) {
      console.error("[idempotency-cleanup] failed", error);
    }
  };

  const initial = setTimeout(() => void cleanup(), 60_000);
  initial.unref();
  const interval = setInterval(() => void cleanup(), 6 * 60 * 60 * 1_000);
  interval.unref();
}
