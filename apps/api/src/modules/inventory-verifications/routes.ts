import { Hono } from "hono";
import { z } from "zod";

import { getAuthUser, writeAudit } from "../../lib/auth";
import { acquireTransactionLock } from "../../lib/db-lock";
import {
  classifyInventoryEvidence,
  confirmIndependentCounts,
  signedStockMovement,
} from "../../lib/inventory-verification";
import { prisma } from "../../lib/prisma";
import { roundStockQuantity, stockDecimal } from "../../lib/stock-quantity";

export const inventoryVerificationsRoute = new Hono();

const productSchema = z.object({
  productId: z.string().min(1),
  selectionReason: z.string().trim().max(300).optional().nullable(),
  precisionBase: z.coerce.number().min(0.0001).max(100).default(0.0001),
});

const sessionSchema = z.object({
  warehouseId: z.string().min(1),
  note: z.string().trim().max(1000).optional().nullable(),
  products: z.array(productSchema).min(1).max(100),
});

const countSchema = z.object({
  productId: z.string().min(1),
  checkpointKey: z.string().trim().min(1).max(80),
  checkpointType: z.enum(["OPENING", "DAILY", "CLOSING"]),
  cutoffAt: z.coerce.date(),
  quantityBase: z.coerce.number().nonnegative().max(1_000_000_000),
  note: z.string().trim().max(500).optional().nullable(),
});

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "عملیات بررسی موجودی ناکام شد.";
}

function timeWhere(from: Date, to: Date) {
  return {
    OR: [
      { occurredAt: { gte: from, lte: to } },
      { occurredAt: null, createdAt: { gte: from, lte: to } },
    ],
  };
}

async function hydrateSession(id: string) {
  const session = await prisma.inventoryVerificationSession.findUnique({
    where: { id },
    include: {
      products: { include: { counts: { orderBy: { createdAt: "asc" } } } },
    },
  });
  if (!session) return null;
  const productIds = session.products.map((item) => item.productId);
  const userIds = Array.from(
    new Set([
      session.createdByUserId,
      ...session.products.flatMap((item) => item.counts.map((entry) => entry.counterUserId)),
    ]),
  );
  const [warehouse, products, users] = await Promise.all([
    prisma.warehouse.findUnique({ where: { id: session.warehouseId } }),
    prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { baseUnit: true },
    }),
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, displayName: true },
    }),
  ]);
  return {
    ...session,
    warehouse,
    productDetails: products,
    counterUsers: users,
  };
}

inventoryVerificationsRoute.get("/", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") || 1));
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") || 20)));
  const status = c.req.query("status")?.trim();
  const where = status ? { status } : {};
  const [items, total] = await Promise.all([
    prisma.inventoryVerificationSession.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: { _count: { select: { products: true, counts: true } } },
    }),
    prisma.inventoryVerificationSession.count({ where }),
  ]);
  return c.json({ data: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

inventoryVerificationsRoute.post("/", async (c) => {
  const authUser = getAuthUser(c);
  if (!authUser) return c.json({ message: "Authentication required" }, 401);
  const parsed = sessionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ message: "اطلاعات جلسه شمارش معتبر نیست.", details: parsed.error.flatten() }, 400);

  const productIds = parsed.data.products.map((item) => item.productId);
  if (new Set(productIds).size !== productIds.length) {
    return c.json({ message: "یک محصول در جلسه شمارش تکرار شده است." }, 400);
  }
  const [warehouse, productCount] = await Promise.all([
    prisma.warehouse.findFirst({
      where: { id: parsed.data.warehouseId, isActive: true, deletedAt: null },
    }),
    prisma.product.count({
      where: { id: { in: productIds }, isActive: true, deletedAt: null },
    }),
  ]);
  if (!warehouse) return c.json({ message: "گدام فعال پیدا نشد." }, 404);
  if (productCount !== productIds.length) {
    return c.json({ message: "یک یا چند محصول حذف یا غیرفعال است." }, 400);
  }

  const session = await prisma.inventoryVerificationSession.create({
    data: {
      warehouseId: warehouse.id,
      note: parsed.data.note ?? null,
      createdByUserId: authUser.id,
      products: {
        create: parsed.data.products.map((item) => ({
          productId: item.productId,
          selectionReason: item.selectionReason ?? null,
          precisionBase: stockDecimal(item.precisionBase),
        })),
      },
    },
    include: { products: true },
  });
  await writeAudit(c, {
    action: "INVENTORY_VERIFICATION_STARTED",
    entityType: "InventoryVerificationSession",
    entityId: session.id,
    metadata: { warehouseId: warehouse.id, productCount: productIds.length },
  });
  return c.json({ data: session }, 201);
});

inventoryVerificationsRoute.get("/:id", async (c) => {
  const session = await hydrateSession(c.req.param("id"));
  return session ? c.json({ data: session }) : c.json({ message: "جلسه بررسی پیدا نشد." }, 404);
});

inventoryVerificationsRoute.post("/:id/counts", async (c) => {
  const authUser = getAuthUser(c);
  if (!authUser) return c.json({ message: "Authentication required" }, 401);
  const parsed = countSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ message: "مقدار شمارش معتبر نیست.", details: parsed.error.flatten() }, 400);
  if (parsed.data.cutoffAt.getTime() > Date.now() + 5 * 60_000) {
    return c.json({ message: "زمان cutoff نمی‌تواند در آینده باشد." }, 400);
  }

  const sessionProduct = await prisma.inventoryVerificationProduct.findFirst({
    where: {
      sessionId: c.req.param("id"),
      productId: parsed.data.productId,
      session: { status: "ACTIVE" },
    },
    include: {
      counts: {
        where:
          parsed.data.checkpointType === "DAILY"
            ? { checkpointKey: parsed.data.checkpointKey }
            : { checkpointType: parsed.data.checkpointType },
      },
    },
  });
  if (!sessionProduct) return c.json({ message: "محصول در جلسه فعال پیدا نشد." }, 404);
  const existingCheckpoint = sessionProduct.counts[0];
  if (
    existingCheckpoint &&
    (existingCheckpoint.checkpointKey !== parsed.data.checkpointKey ||
      existingCheckpoint.cutoffAt.getTime() !== parsed.data.cutoffAt.getTime())
  ) {
    return c.json({ message: "checkpoint و cutoff شمارش دوم باید دقیقاً با شمارش اول یکسان باشد." }, 409);
  }

  const entry = await prisma.inventoryPhysicalCountEntry.upsert({
    where: {
      sessionProductId_checkpointKey_counterUserId: {
        sessionProductId: sessionProduct.id,
        checkpointKey: parsed.data.checkpointKey,
        counterUserId: authUser.id,
      },
    },
    create: {
      sessionId: c.req.param("id"),
      sessionProductId: sessionProduct.id,
      checkpointKey: parsed.data.checkpointKey,
      checkpointType: parsed.data.checkpointType,
      cutoffAt: parsed.data.cutoffAt,
      counterUserId: authUser.id,
      quantityBase: stockDecimal(parsed.data.quantityBase),
      note: parsed.data.note ?? null,
    },
    update: {
      quantityBase: stockDecimal(parsed.data.quantityBase),
      note: parsed.data.note ?? null,
    },
  });
  await writeAudit(c, {
    action: "INVENTORY_PHYSICAL_COUNT_RECORDED",
    entityType: "InventoryPhysicalCountEntry",
    entityId: entry.id,
    metadata: {
      sessionId: c.req.param("id"),
      productId: parsed.data.productId,
      checkpointKey: parsed.data.checkpointKey,
      checkpointType: parsed.data.checkpointType,
    },
  });
  return c.json({ data: entry }, 201);
});

inventoryVerificationsRoute.post("/:id/close", async (c) => {
  const authUser = getAuthUser(c);
  if (!authUser) return c.json({ message: "Authentication required" }, 401);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const sessionId = c.req.param("id");
      await acquireTransactionLock(tx, "inventory-verification-close", sessionId);
      const session = await tx.inventoryVerificationSession.findUnique({
        where: { id: sessionId },
        include: { products: { include: { counts: true } } },
      });
      if (!session) throw new Error("جلسه بررسی پیدا نشد.");
      if (session.status !== "ACTIVE") throw new Error("این جلسه قبلاً بسته شده است.");

      const confirmations = session.products.map((item) => ({
        item,
        opening: confirmIndependentCounts(item.counts, "OPENING", Number(item.precisionBase)),
        closing: confirmIndependentCounts(item.counts, "CLOSING", Number(item.precisionBase)),
      }));
      const openingCutoffs = new Set(
        confirmations.map((row) => row.opening.cutoffAt.getTime()),
      );
      const closingCutoffs = new Set(
        confirmations.map((row) => row.closing.cutoffAt.getTime()),
      );
      if (openingCutoffs.size !== 1 || closingCutoffs.size !== 1) {
        throw new Error(
          "تمام محصولات باید cutoff آغاز و پایان یکسان داشته باشند؛ شمارش‌ها را با زمان مشترک ثبت کنید.",
        );
      }
      for (const row of confirmations) {
        if (row.closing.cutoffAt <= row.opening.cutoffAt) {
          throw new Error("cutoff شمارش نهایی باید بعد از شمارش آغازین باشد.");
        }
      }
      const latestClosing = new Date(Math.max(...confirmations.map((row) => row.closing.cutoffAt.getTime())));
      const productIds = session.products.map((item) => item.productId);
      const movementAfterCutoff = await tx.stockMovement.findFirst({
        where: {
          productId: { in: productIds },
          warehouseId: session.warehouseId,
          OR: [
            { occurredAt: { gt: latestClosing } },
            { occurredAt: null, createdAt: { gt: latestClosing } },
          ],
        },
        select: { id: true },
      });
      if (movementAfterCutoff) {
        throw new Error("پس از cutoff نهایی حرکت موجودی ثبت شده است؛ شمارش نهایی باید تکرار شود.");
      }

      const rows = [];
      for (const row of confirmations) {
        const [movements, lots] = await Promise.all([
          tx.stockMovement.findMany({
            where: {
              productId: row.item.productId,
              warehouseId: session.warehouseId,
              ...timeWhere(row.opening.cutoffAt, row.closing.cutoffAt),
            },
            select: { type: true, quantity: true },
          }),
          tx.stockLot.aggregate({
            where: { productId: row.item.productId, warehouseId: session.warehouseId },
            _sum: { remainingQuantity: true },
          }),
        ]);
        const movementDelta = roundStockQuantity(
          movements.reduce(
            (sum, movement) => sum + signedStockMovement(movement.type, Number(movement.quantity)),
            0,
          ),
        );
        const expectedClosing = roundStockQuantity(row.opening.quantity + movementDelta);
        const systemClosing = roundStockQuantity(Number(lots._sum.remainingQuantity || 0));
        const verdict = classifyInventoryEvidence({
          expectedClosing,
          systemClosing,
          physicalClosing: row.closing.quantity,
          precisionBase: Number(row.item.precisionBase),
        });
        rows.push(await tx.inventoryVerificationProduct.update({
          where: { id: row.item.id },
          data: {
            openingConfirmedQuantity: stockDecimal(row.opening.quantity),
            closingConfirmedQuantity: stockDecimal(row.closing.quantity),
            expectedClosingQuantity: stockDecimal(expectedClosing),
            systemQuantityAtClose: stockDecimal(systemClosing),
            classification: verdict.classification,
            discrepancy: stockDecimal(verdict.discrepancy),
          },
        }));
      }
      await tx.inventoryVerificationSession.update({
        where: { id: session.id },
        data: { status: "COMPLETED", closedAt: latestClosing },
      });
      return { sessionId: session.id, products: rows };
    });
    await writeAudit(c, {
      action: "INVENTORY_VERIFICATION_COMPLETED",
      entityType: "InventoryVerificationSession",
      entityId: result.sessionId,
      metadata: {
        matched: result.products.filter((item) => item.classification === "MATCHED").length,
        systemMismatches: result.products.filter((item) => item.classification === "SYSTEM_LEDGER_MISMATCH").length,
        physicalVariances: result.products.filter((item) => item.classification === "PHYSICAL_VARIANCE").length,
      },
    });
    return c.json({ data: result });
  } catch (error) {
    return c.json({ message: errorMessage(error) }, 409);
  }
});

inventoryVerificationsRoute.get("/:id/evidence", async (c) => {
  const session = await hydrateSession(c.req.param("id"));
  if (!session) return c.json({ message: "جلسه بررسی پیدا نشد." }, 404);
  const page = Math.max(1, Number(c.req.query("page") || 1));
  const limit = Math.min(500, Math.max(1, Number(c.req.query("limit") || 100)));
  const productIds = session.products.map((item) => item.productId);
  const movementWhere = {
    productId: { in: productIds },
    warehouseId: session.warehouseId,
    ...timeWhere(session.startedAt, session.closedAt || new Date()),
  };
  const [movements, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where: movementWhere,
      orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        product: { select: { id: true, name: true, barcode: true } },
        createdByUser: { select: { id: true, username: true, displayName: true } },
        operation: true,
      },
    }),
    prisma.stockMovement.count({ where: movementWhere }),
  ]);
  return c.json({
    data: {
      session,
      movements,
      verdictCounts: session.products.reduce<Record<string, number>>((result, item) => {
        const key = item.classification || "PENDING";
        result[key] = (result[key] || 0) + 1;
        return result;
      }, {}),
    },
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});
