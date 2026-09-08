import type { Context } from "hono";

function clean(value: string | undefined | null, max = 200) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, max) : null;
}

function forwardedIp(c: Context) {
  return clean(
    c.req.header("x-forwarded-for")?.split(",")[0] ||
      c.req.header("x-real-ip") ||
      null,
    100,
  );
}

export function inventoryOperationEvidence(c: Context) {
  const deviceType = clean(c.req.header("x-pos-device-type"), 40);
  const userAgent = c.req.header("user-agent") || "";
  const inferredChannel = userAgent.includes("Electron")
    ? "ELECTRON"
    : /Mobile|Android|iPhone/i.test(userAgent)
      ? "MOBILE"
      : "WEB";
  const correlationId = clean(
    c.req.header("x-correlation-id") ||
      c.req.header("x-request-id") ||
      c.req.header("idempotency-key") ||
      c.req.header("x-idempotency-key"),
  );

  return {
    sourceChannel: clean(c.req.header("x-client-channel"), 40) || deviceType || inferredChannel,
    sourceDeviceCode: clean(
      c.req.header("x-pos-device-code") || c.req.header("x-device-id"),
      200,
    ),
    appVersion: clean(c.req.header("x-app-version"), 100),
    correlationId,
    requestIp: forwardedIp(c),
  };
}
