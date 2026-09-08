import type { Context, Next } from "hono";
import { prisma } from "./prisma";
import { getAuthUser, hasPermission, type AuthUser } from "./auth";

type AccessRequirement =
  | { type: "authenticated" }
  | { type: "permissions"; anyOf: string[] };

type RoutePolicy = {
  prefix: string;
  exact?: boolean;
  methods?: string[];
  read: AccessRequirement;
  write: AccessRequirement;
};

const authenticated: AccessRequirement = { type: "authenticated" };
const anyOf = (...permissions: string[]): AccessRequirement => ({
  type: "permissions",
  anyOf: permissions,
});

const productReaders = [
  "pos.sell",
  "products.manage",
  "inventory.view",
  "inventory.manage",
  "purchases.view",
  "purchases.manage",
  "sales.view",
  "sales.manage",
];

const partyReaders = [
  "pos.sell",
  "parties.manage",
  "sales.view",
  "sales.manage",
  "purchases.view",
  "purchases.manage",
  "cashbank.manage",
  "accounting.view",
  "accounting.manage",
];

export const routePolicies: RoutePolicy[] = [
  {
    prefix: "/api/accounting/post-sale-cogs",
    exact: true,
    methods: ["POST"],
    read: anyOf("pos.sell", "accounting.manage"),
    write: anyOf("pos.sell", "accounting.manage"),
  },
  { prefix: "/api/employees/me", exact: true, read: authenticated, write: authenticated },
  {
    prefix: "/api/attendance/scan-auth",
    exact: true,
    methods: ["POST"],
    read: authenticated,
    write: authenticated,
  },
  { prefix: "/api/auth", read: authenticated, write: authenticated },
  { prefix: "/api/users", read: anyOf("users.manage"), write: anyOf("users.manage") },
  {
    prefix: "/api/employees",
    read: anyOf("employees.view", "employees.manage"),
    write: anyOf("employees.manage"),
  },
  {
    prefix: "/api/attendance",
    read: anyOf("attendance.view", "attendance.manage"),
    write: anyOf("attendance.manage"),
  },
  {
    prefix: "/api/payroll",
    read: anyOf("payroll.view", "payroll.manage"),
    write: anyOf("payroll.manage"),
  },
  { prefix: "/api/dashboard", read: anyOf("dashboard.view"), write: anyOf("dashboard.view") },
  {
    prefix: "/api/alerts",
    read: anyOf("alerts.view", "inventory.view", "inventory.manage"),
    write: anyOf("alerts.view", "inventory.manage"),
  },
  { prefix: "/api/pos", read: anyOf("pos.sell"), write: anyOf("pos.sell") },
  { prefix: "/api/pos-cart", read: anyOf("pos.sell"), write: anyOf("pos.sell") },
  {
    prefix: "/api/pos-receipts",
    read: anyOf("pos.sell", "sales.view", "sales.manage"),
    write: anyOf("pos.sell", "sales.view", "sales.manage"),
  },
  {
    prefix: "/api/receipts",
    read: anyOf("pos.sell", "sales.view", "sales.manage", "cashbank.manage"),
    write: anyOf("pos.sell", "sales.view", "sales.manage", "cashbank.manage"),
  },
  { prefix: "/api/barcodes", read: anyOf(...productReaders), write: anyOf("products.manage") },
  {
    prefix: "/api/sales",
    read: anyOf("sales.view", "sales.manage", "pos.sell"),
    write: anyOf("sales.manage", "pos.sell"),
  },
  {
    prefix: "/api/sale-returns",
    read: anyOf("sales.view", "sales.manage"),
    write: anyOf("sales.manage"),
  },
  {
    prefix: "/api/purchases",
    read: anyOf("purchases.view", "purchases.manage"),
    write: anyOf("purchases.manage"),
  },
  {
    prefix: "/api/purchase-returns",
    read: anyOf("purchases.view", "purchases.manage"),
    write: anyOf("purchases.manage"),
  },
  {
    prefix: "/api/inventory-verifications",
    read: anyOf("inventory.manage"),
    write: anyOf("inventory.manage"),
  },
  {
    prefix: "/api/inventory/product-history",
    read: anyOf("inventory.view", "inventory.manage"),
    write: anyOf("inventory.manage"),
  },
  {
    prefix: "/api/inventory",
    read: anyOf("inventory.view", "inventory.manage", "pos.sell"),
    write: anyOf("inventory.manage"),
  },
  { prefix: "/api/products", read: anyOf(...productReaders), write: anyOf("products.manage") },
  { prefix: "/api/warehouses", read: anyOf(...productReaders), write: anyOf("inventory.manage") },
  { prefix: "/api/units", read: anyOf(...productReaders), write: anyOf("products.manage") },
  {
    prefix: "/api/product-categories",
    read: anyOf(...productReaders),
    write: anyOf("products.manage"),
  },
  { prefix: "/api/parties", read: anyOf(...partyReaders), write: anyOf("parties.manage") },
  {
    prefix: "/api/cash-registers",
    read: anyOf("cashbank.manage", "pos.sell", "sales.manage", "purchases.manage", "payroll.manage"),
    write: anyOf("cashbank.manage"),
  },
  {
    prefix: "/api/bank-accounts",
    read: anyOf("cashbank.manage", "sales.manage", "purchases.manage", "payroll.manage"),
    write: anyOf("cashbank.manage"),
  },
  { prefix: "/api/money-transfers", read: anyOf("cashbank.manage"), write: anyOf("cashbank.manage") },
  { prefix: "/api/payments", read: anyOf("cashbank.manage"), write: anyOf("cashbank.manage") },
  { prefix: "/api/income-expenses", read: anyOf("cashbank.manage"), write: anyOf("cashbank.manage") },
  {
    prefix: "/api/financial-categories",
    read: anyOf("cashbank.manage"),
    write: anyOf("cashbank.manage"),
  },
  {
    prefix: "/api/accounting",
    read: anyOf("accounting.view", "accounting.manage"),
    write: anyOf("accounting.manage"),
  },
  { prefix: "/api/reports", read: anyOf("reports.view"), write: anyOf("reports.view") },
  { prefix: "/api/exports", read: anyOf("reports.view"), write: anyOf("reports.view") },
  { prefix: "/api/backups", read: anyOf("backup.manage"), write: anyOf("backup.manage") },
  { prefix: "/api/system-health", read: anyOf("backup.manage"), write: anyOf("backup.manage") },
  { prefix: "/api/settings", read: authenticated, write: anyOf("settings.manage") },
  { prefix: "/api/currencies", read: authenticated, write: anyOf("settings.manage") },
  { prefix: "/api/currency-rates", read: authenticated, write: anyOf("settings.manage") },
  {
    prefix: "/api/attachments",
    read: anyOf(...partyReaders, "inventory.view", "inventory.manage"),
    write: anyOf(
      "sales.manage",
      "purchases.manage",
      "cashbank.manage",
      "inventory.manage",
      "parties.manage",
      "settings.manage",
    ),
  },
];

function matchesPolicy(path: string, method: string, policy: RoutePolicy) {
  if (policy.methods && !policy.methods.includes(method)) return false;
  return policy.exact
    ? path === policy.prefix
    : path === policy.prefix || path.startsWith(`${policy.prefix}/`);
}

export function resolvePermissionRequirement(path: string, method: string) {
  const policy = routePolicies.find((item) => matchesPolicy(path, method, item));
  if (!policy) return null;
  return method === "GET" || method === "HEAD" ? policy.read : policy.write;
}

export function satisfiesPermissionRequirement(user: AuthUser, requirement: AccessRequirement) {
  if (requirement.type === "authenticated") return true;
  return requirement.anyOf.some((permission) => hasPermission(user, permission));
}

export function permissionEnforcementMode() {
  return process.env.PERMISSION_ENFORCEMENT_MODE?.trim().toLowerCase() === "enforce"
    ? "enforce"
    : "observe";
}

async function auditObservedViolation(
  c: Context,
  user: AuthUser,
  reason: "UNMAPPED_ROUTE" | "MISSING_PERMISSION",
) {
  const requestPath = new URL(c.req.url).pathname;
  console.warn("[permissions:observe]", reason, c.req.method, requestPath, user.username);
  try {
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "PERMISSION_OBSERVE_VIOLATION",
        entityType: "RoutePolicy",
        entityId: requestPath,
        description: [reason, c.req.method, requestPath].join(": "),
        metadata: { reason, method: c.req.method, path: requestPath },
      },
    });
  } catch (error) {
    console.warn("[permissions:observe] audit write failed", error);
  }
}

export async function permissionMiddleware(c: Context, next: Next) {
  const user = getAuthUser(c);
  if (!user) {
    await next();
    return;
  }

  const path = new URL(c.req.url).pathname;
  const requirement = resolvePermissionRequirement(path, c.req.method);
  const reason = !requirement
    ? "UNMAPPED_ROUTE"
    : satisfiesPermissionRequirement(user, requirement)
      ? null
      : "MISSING_PERMISSION";

  if (!reason) {
    await next();
    return;
  }

  if (permissionEnforcementMode() === "observe") {
    await auditObservedViolation(c, user, reason);
    await next();
    return;
  }

  if (!requirement) {
    return c.json({ message: "Access policy is not configured for this route" }, 403);
  }

  const permissions =
    requirement.type === "permissions" ? requirement.anyOf.join(" or ") : "login";
  return c.json({ message: `Permission required: ${permissions}` }, 403);
}
