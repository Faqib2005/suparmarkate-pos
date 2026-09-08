import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { HTTPException } from "hono/http-exception";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "./lib/prisma";
import { startPosWebSocketServer } from "./lib/pos-realtime";
import { authMiddleware } from "./lib/auth";
import { permissionMiddleware } from "./lib/permissions";
import { startBackupScheduler } from "./lib/backup-scheduler";
import { getDiskHealth, slowRequestMiddleware } from "./lib/monitoring";
import { getMaintenanceMode, maintenanceModeMiddleware } from "./lib/maintenance-mode";
import {
  closeRedisCache,
  getRedisHealth,
  invalidateReadCachesAfterWrite
} from "./lib/cache";
import { startStockBalanceReconciliationScheduler } from "./lib/stock-balance-reconciliation";
import {
  idempotencyMiddleware,
  startIdempotencyCleanupScheduler
} from "./lib/idempotency";

import { currenciesRoute } from "./modules/currencies/routes";
import { currencyRatesRoute } from "./modules/currency-rates/routes";
import { warehousesRoute } from "./modules/warehouses/routes";
import { unitsRoute } from "./modules/units/routes";
import { productCategoriesRoute } from "./modules/product-categories/routes";
import { productsRoute } from "./modules/products/routes";
import { inventoryRoute } from "./modules/inventory/routes";
import { inventoryVerificationsRoute } from "./modules/inventory-verifications/routes";
import { partiesRoute } from "./modules/parties/routes";
import { cashRegistersRoute } from "./modules/cash-registers/routes";
import { bankAccountsRoute } from "./modules/bank-accounts/routes";
import { moneyTransfersRoute } from "./modules/money-transfers/routes";
import { purchasesRoute } from "./modules/purchases/routes";
import { salesRoute } from "./modules/sales/routes";
import { purchaseReturnsRoute } from "./modules/purchase-returns/routes";
import { saleReturnsRoute } from "./modules/sale-returns/routes";
import { settingsRoute } from "./modules/settings/routes";
import { receiptsRoute } from "./modules/receipts/routes";
import { paymentsRoute } from "./modules/payments/routes";
import { alertsRoute } from "./modules/alerts/routes";
import { posRoute } from "./modules/pos/routes";
import { accountingRoute } from "./modules/accounting/routes";
import { posReceiptsRoute } from "./modules/pos-receipts/routes";
import { posCartRoute } from "./modules/pos-cart/routes";
import { barcodesRoute } from "./modules/barcodes/routes";
import { dashboardRoute } from "./modules/dashboard/routes";
import { reportsRoute } from "./modules/reports/routes";
import { financialCategoriesRoute } from "./modules/financial-categories/routes";
import { incomeExpensesRoute } from "./modules/income-expenses/routes";
import { backupsRoute } from "./modules/backups/routes";
import { enqueueJob, startPersistentJobWorker } from "./lib/persistent-jobs";
import { authRoute } from "./modules/auth/routes";
import { usersRoute } from "./modules/users/routes";
import { employeesRoute } from "./modules/employees/routes";
import { attendanceRoute } from "./modules/attendance/routes";
import { payrollRoute } from "./modules/payroll/routes";
import { attachmentsRoute } from "./modules/attachments/routes";
import { exportsRoute } from "./modules/exports/routes";
import { systemHealthRoute } from "./modules/system-health/routes";
import { ensureRuntimeServerConfigFile } from "./lib/runtime-server-config";
import { startSystemHealthWebSocketServer } from "./lib/system-health-realtime";
import { BUSINESS_TIME_ZONE, kabulDateKey } from "./lib/kabul-date";

const app = new Hono();
const webDistDir =
  process.env.WEB_DIST_DIR || path.resolve(process.cwd(), "../desktop/dist");
const webIndexPath = path.join(webDistDir, "index.html");
const webAppAvailable =
  process.env.WEB_APP_ENABLED !== "false" && existsSync(webIndexPath);

const corsOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function prismaErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  return String((error as { code?: unknown }).code || "");
}

function publicErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Internal server error";
}

function publicErrorStatus(error: unknown) {
  const code = prismaErrorCode(error);

  if (code === "P2002") return 409;
  if (code === "P2003") return 409;
  if (code === "P2025") return 404;

  if (error instanceof Error && error.message.trim()) return 400;

  return 500;
}

function publicPrismaMessage(error: unknown) {
  const code = prismaErrorCode(error);
  const target =
    error && typeof error === "object" && "meta" in error
      ? (error as { meta?: { target?: unknown } }).meta?.target
      : null;
  const targetText = Array.isArray(target) ? target.join(", ") : String(target || "");

  if (code === "P2002") {
    if (targetText.includes("barcode")) {
      return "این بارکود قبلاً برای محصول دیگری ثبت شده است.";
    }
    return "این معلومات قبلاً در سیستم ثبت شده است و تکراری قابل ثبت نیست.";
  }

  if (code === "P2003") {
    return "این رکورد به معلومات دیگر سیستم وابسته است و این عملیات قابل انجام نیست.";
  }

  if (code === "P2025") {
    return "رکورد مورد نظر پیدا نشد.";
  }

  return "";
}

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return origin;
      if (origin === "null" || origin.startsWith("file://")) return origin;
      if (corsOrigins.length === 0) return process.env.NODE_ENV === "production" ? "" : origin;
      return corsOrigins.includes(origin) ? origin : "";
    }
  })
);

app.use("/uploads/products/*", serveStatic({ root: "./" }));
app.use("/uploads/receipts/*", serveStatic({ root: "./" }));
app.use("*", slowRequestMiddleware);
app.use("/api/*", maintenanceModeMiddleware);
app.use("/api/*", invalidateReadCachesAfterWrite);
app.use("/api/*", authMiddleware);
app.use("/api/*", permissionMiddleware);
app.use("/api/*", idempotencyMiddleware);

app.get("/", (c) => {
  if (webAppAvailable) {
    c.header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    return c.html(readFileSync(webIndexPath, "utf8"));
  }

  return c.json({
    name: "Supermarket POS API",
    status: "running",
    webApp: "not-built"
  });
});

app.get("/health", async (c) => {
  try {
    const [disk, redis, databaseSize, databaseClock] = await Promise.all([
      getDiskHealth(),
      getRedisHealth(),
      prisma.$queryRaw<Array<{ bytes: bigint }>>`SELECT pg_database_size(current_database()) AS bytes`,
      prisma.$queryRaw<Array<{ dbNow: Date; dbTimeZone: string }>>`
        SELECT CURRENT_TIMESTAMP AS "dbNow",
          current_setting('TimeZone') AS "dbTimeZone"
      `
    ]);

    const apiNow = new Date();
    const dbNow = new Date(databaseClock[0]?.dbNow ?? apiNow);

    return c.json({
      status: "ok",
      database: "connected",
      databaseSizeBytes: Number(databaseSize[0]?.bytes || 0),
      disk,
      redis,
      maintenanceMode: getMaintenanceMode(),
      time: apiNow.toISOString(),
      clock: {
        databaseUtc: dbNow.toISOString(),
        kabulDate: kabulDateKey(apiNow),
        businessTimeZone: BUSINESS_TIME_ZONE,
        databaseTimeZone: databaseClock[0]?.dbTimeZone || null,
        apiDatabaseSkewMs: Math.abs(apiNow.getTime() - dbNow.getTime())
      }
    });
  } catch (error) {
    console.error(error);

    return c.json(
      {
        status: "error",
        database: "disconnected"
      },
      500
    );
  }
});

app.route("/api/currencies", currenciesRoute);
app.route("/api/currency-rates", currencyRatesRoute);
app.route("/api/auth", authRoute);
app.route("/api/users", usersRoute);
app.route("/api/employees", employeesRoute);
app.route("/api/attendance", attendanceRoute);
app.route("/api/payroll", payrollRoute);
app.route("/api/warehouses", warehousesRoute);
app.route("/api/units", unitsRoute);
app.route("/api/product-categories", productCategoriesRoute);
app.route("/api/products", productsRoute);
app.route("/api/inventory", inventoryRoute);
app.route("/api/inventory-verifications", inventoryVerificationsRoute);
app.route("/api/parties", partiesRoute);
app.route("/api/cash-registers", cashRegistersRoute);
app.route("/api/bank-accounts", bankAccountsRoute);
app.route("/api/money-transfers", moneyTransfersRoute);
app.route("/api/purchases", purchasesRoute);
app.route("/api/sales", salesRoute);
app.route("/api/purchase-returns", purchaseReturnsRoute);
app.route("/api/sale-returns", saleReturnsRoute);
app.route("/api/settings", settingsRoute);
app.route("/api/receipts", receiptsRoute);
app.route("/api/payments", paymentsRoute);
app.route("/api/alerts", alertsRoute);
app.route("/api/pos", posRoute);
app.route("/api/accounting", accountingRoute);
app.route("/api/pos-receipts", posReceiptsRoute);
app.route("/api/pos-cart", posCartRoute);
app.route("/api/barcodes", barcodesRoute);
app.route("/api/dashboard", dashboardRoute);
app.route("/api/reports", reportsRoute);
app.route("/api/financial-categories", financialCategoriesRoute);
app.route("/api/income-expenses", incomeExpensesRoute);
app.route("/api/backups", backupsRoute);
app.route("/api/attachments", attachmentsRoute);
app.route("/api/exports", exportsRoute);
app.route("/api/system-health", systemHealthRoute);

if (webAppAvailable) {
  app.use("/*", serveStatic({ root: webDistDir }));

  app.get("*", (c) => {
    const pathName = new URL(c.req.url).pathname;
    if (
      pathName.startsWith("/api/") ||
      pathName.startsWith("/uploads/") ||
      pathName === "/health" ||
      path.extname(pathName)
    ) {
      return c.notFound();
    }

    c.header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    return c.html(readFileSync(webIndexPath, "utf8"));
  });
}

app.notFound((c) => {
  return c.json(
    {
      message: "Route not found"
    },
    404
  );
});

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    const response = error.getResponse();
    const status = response.status || error.status || 500;
    return c.json(
      {
        message: error.message || response.statusText || "درخواست انجام نشد"
      },
      status as 400
    );
  }

  console.error(error);

  const prismaMessage = publicPrismaMessage(error);
  const status = publicErrorStatus(error);

  return c.json(
    {
      message:
        prismaMessage ||
        (status < 500 ? publicErrorMessage(error) : "Internal server error")
    },
    status as 400
  );
});

const port = Number(process.env.PORT || 4000);
const posWebSocketPort = Number(process.env.POS_WS_PORT || 4001);
const systemHealthWebSocketPort = Number(process.env.SYSTEM_HEALTH_WS_PORT || 4002);

const apiServer = serve({
  fetch: app.fetch,
  port
});

const posWebSocketServer = startPosWebSocketServer(posWebSocketPort);
const systemHealthWebSocketServer = startSystemHealthWebSocketServer(systemHealthWebSocketPort);
startBackupScheduler(() => enqueueJob("BACKUP_CREATE", { source: "schedule" }));
startStockBalanceReconciliationScheduler();
startIdempotencyCleanupScheduler();
void startPersistentJobWorker();
void ensureRuntimeServerConfigFile();

console.log(`API running on http://localhost:${port}`);
console.log(`POS WebSocket running on ws://localhost:${posWebSocketPort}`);

async function closeWebSocketServer(
  server: ReturnType<typeof startPosWebSocketServer>
) {
  if (!server) return;
  for (const socket of server.clients) {
    socket.close(1001, "Server shutting down");
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timeout = setTimeout(() => {
      for (const socket of server.clients) socket.terminate();
      finish();
    }, 3000);
    timeout.unref();
    server.close(() => {
      clearTimeout(timeout);
      finish();
    });
  });
}

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received; closing Muhaseb services...`);

  const forceExit = setTimeout(() => {
    console.error("[shutdown] graceful shutdown timed out");
    process.exit(1);
  }, 12_000);
  forceExit.unref();

  await Promise.allSettled([
    new Promise<void>((resolve) => apiServer.close(() => resolve())),
    closeWebSocketServer(posWebSocketServer),
    closeWebSocketServer(systemHealthWebSocketServer),
    closeRedisCache(),
    prisma.$disconnect()
  ]);
  clearTimeout(forceExit);
  console.log("[shutdown] Muhaseb services closed cleanly");
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
