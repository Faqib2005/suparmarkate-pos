import type { MiddlewareHandler } from "hono";

let reason: string | null = null;

export function setMaintenanceMode(nextReason: string | null) {
  reason = nextReason;
}

export function getMaintenanceMode() {
  return reason;
}

export const maintenanceModeMiddleware: MiddlewareHandler = async (c, next) => {
  if (reason && c.req.method !== "OPTIONS") {
    return c.json({ message: `سرور در حالت نگهداری است: ${reason}` }, 503);
  }

  await next();
};
