import type { MiddlewareHandler } from "hono";
import { customerMessage } from "./customer-message";

type ErrorPayload = {
  message?: unknown;
  error?: { message?: unknown } | unknown;
};

/** Localizes handler errors once for Desktop, Web, and Mobile clients. */
export const customerErrorMiddleware: MiddlewareHandler = async (c, next) => {
  await next();

  const response = c.res;
  const contentType = response.headers.get("content-type") || "";
  if (response.status < 400 || !contentType.includes("application/json")) return;

  let payload: ErrorPayload;
  try {
    payload = JSON.parse(await response.clone().text()) as ErrorPayload;
  } catch {
    return;
  }

  if (!payload || typeof payload !== "object") return;

  let changed = false;
  if (typeof payload.message === "string") {
    const translated = customerMessage(payload.message);
    changed ||= translated !== payload.message;
    payload.message = translated;
  }

  if (payload.error && typeof payload.error === "object" && "message" in payload.error) {
    const error = payload.error as { message?: unknown };
    if (typeof error.message === "string") {
      const translated = customerMessage(error.message);
      changed ||= translated !== error.message;
      error.message = translated;
    }
  }

  if (!changed) return;

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  c.res = new Response(JSON.stringify(payload), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};
