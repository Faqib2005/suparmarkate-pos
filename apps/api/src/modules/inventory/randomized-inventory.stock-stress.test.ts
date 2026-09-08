import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuthUser } from "../../lib/auth";
import { idempotencyMiddleware } from "../../lib/idempotency";
import { createOperationReference } from "../../lib/operation-id";
import { prisma } from "../../lib/prisma";
import { reconcileStockBalances } from "../../lib/stock-balance-reconciliation";
import { roundStockQuantity, STOCK_QUANTITY_FACTOR } from "../../lib/stock-quantity";
import { StockMovementType } from "../../generated/prisma/enums";
import { productsRoute } from "../products/routes";
import { purchaseReturnsRoute } from "../purchase-returns/routes";
import { purchasesRoute } from "../purchases/routes";
import { saleReturnsRoute } from "../sale-returns/routes";
import { salesRoute } from "../sales/routes";
import { inventoryRoute } from "./routes";

const databaseUrl = process.env.DATABASE_URL || "";
if (
  process.env.NODE_ENV !== "test" ||
  !/[/_]supermarket_test(?:\?|$)/.test(databaseUrl)
) {
  throw new Error(
    "The randomized stock test may only run with NODE_ENV=test against supermarket_test."
  );
}

const PRODUCT_COUNT = Math.min(
  2_000,
  Math.max(1, Number(process.env.STOCK_STRESS_PRODUCT_COUNT || 100)),
);
const OPERATIONS_PER_PRODUCT = Math.min(
  2_000,
  Math.max(1, Number(process.env.STOCK_STRESS_OPERATIONS_PER_PRODUCT || 50)),
);
const PRODUCT_CONCURRENCY = Math.min(
  50,
  Math.max(1, Number(process.env.STOCK_STRESS_PRODUCT_CONCURRENCY || 5)),
);
const marker = createOperationReference("STOCK-STRESS");

type TestUnit = { id: string; rate: number; name: string };
type TestProduct = { id: string; barcode: string; hasExpiry: boolean; units: TestUnit[] };

let adminUser: AuthUser;
let baseCurrencyId = "";
let customerId = "";
let supplierId = "";
let warehouseIds: string[] = [];
let products: TestProduct[] = [];
const usedMovementTypes = new Set<StockMovementType>();
const expectedStock = new Map<string, number>();
const app = new Hono<{ Variables: { authUser: AuthUser } }>();
const useExistingProducts = process.env.STOCK_STRESS_USE_EXISTING_PRODUCTS === "true";
const testExpiryDate = "2027-12-31";

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function enteredQuantity(unit: TestUnit, random: () => number) {
  const choices = [0.25, 0.5, 1];
  return choices[Math.floor(random() * choices.length)]!;
}

async function jsonRequest(
  path: string,
  init: RequestInit = {},
  operationId = createOperationReference("TEST-OP"),
) {
  const response = await app.request(`http://localhost${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.method && init.method !== "GET"
        ? {
            "Idempotency-Key": operationId,
            "x-correlation-id": operationId,
          }
        : {}),
      "x-client-channel": "TEST",
      "x-pos-device-code": "STOCK-STRESS-DEVICE",
      "x-app-version": "stock-stress",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${init.method || "GET"} ${path} failed (${response.status}): ${text}`);
  }
  return { response, payload };
}

function post(path: string, body: unknown, operationId?: string) {
  return jsonRequest(path, { method: "POST", body: JSON.stringify(body) }, operationId);
}

async function warehouseStock(productId: string, warehouseId: string) {
  const aggregate = await prisma.stockLot.aggregate({
    where: { productId, warehouseId },
    _sum: { remainingQuantity: true },
  });
  return roundStockQuantity(Number(aggregate._sum.remainingQuantity || 0));
}

function expectedKey(productId: string, warehouseId: string) {
  return `${productId}:${warehouseId}`;
}

function setExpectedStock(productId: string, warehouseId: string, quantity: number) {
  expectedStock.set(expectedKey(productId, warehouseId), roundStockQuantity(quantity));
}

function changeExpectedStock(productId: string, warehouseId: string, delta: number) {
  const key = expectedKey(productId, warehouseId);
  expectedStock.set(key, roundStockQuantity((expectedStock.get(key) || 0) + delta));
}

async function assertExpectedStock(productId: string, warehouseId: string) {
  const key = expectedKey(productId, warehouseId);
  const expected = expectedStock.get(key) || 0;
  const actual = await warehouseStock(productId, warehouseId);
  const variance = roundStockQuantity(actual - expected);
  const precisionQuantum = 1 / STOCK_QUANTITY_FACTOR;
  expect(
    Math.abs(variance),
    `independent stock oracle mismatch for ${productId}:${warehouseId}; expected ${expected}, actual ${actual}`,
  ).toBeLessThanOrEqual(precisionQuantum);

  // Continue from the accepted four-decimal quantity so legal conversion rounding cannot accumulate.
  expectedStock.set(key, actual);
}

async function addStock(
  product: TestProduct,
  warehouseId: string,
  unit: TestUnit,
  quantity: number,
  note: string,
) {
  usedMovementTypes.add(StockMovementType.ADJUSTMENT_IN);
  const result = await post("/api/inventory/adjustments", {
    productId: product.id,
    warehouseId,
    unitId: unit.id,
    type: "ADJUSTMENT_IN",
    quantity,
    unitCost: 10 * unit.rate,
    currencyId: baseCurrencyId,
    ...(product.hasExpiry ? { expiryDate: testExpiryDate } : {}),
    note,
  });
  changeExpectedStock(product.id, warehouseId, quantity * unit.rate);
  await assertExpectedStock(product.id, warehouseId);
  return result;
}

async function ensureOutboundStock(
  product: TestProduct,
  warehouseId: string,
  unit: TestUnit,
  quantity: number,
) {
  const required = roundStockQuantity(quantity * unit.rate);
  const available = await warehouseStock(product.id, warehouseId);
  // Keep one base unit of headroom because an old FIFO lot can contain dust
  // that is valid in the base unit but cannot be represented in a large unit.
  if (available < required + 1) {
    const missingBase = roundStockQuantity(Math.max(0, required - available) + 24);
    await addStock(
      product,
      warehouseId,
      unit,
      roundStockQuantity(missingBase / unit.rate),
      `${marker} automatic replenishment`,
    );
  }
}

async function createPurchase(
  product: TestProduct,
  warehouseId: string,
  unit: TestUnit,
  quantity: number,
) {
  usedMovementTypes.add(StockMovementType.PURCHASE);
  const result = await post("/api/purchases", {
    invoiceNo: createOperationReference("STRESS-P"),
    supplierId,
    currencyId: baseCurrencyId,
    paidAmount: 0,
    discount: 0,
    note: marker,
    items: [
      {
        productId: product.id,
        warehouseId,
        unitId: unit.id,
        quantity,
        unitCost: 10 * unit.rate,
        ...(product.hasExpiry ? { expiryDate: testExpiryDate } : {}),
        updateSalePrice: false,
      },
    ],
  });
  changeExpectedStock(product.id, warehouseId, quantity * unit.rate);
  await assertExpectedStock(product.id, warehouseId);
  return result.payload.data.purchase as {
    id: string;
    items: Array<{ id: string; quantity: unknown }>;
  };
}

async function createSale(
  product: TestProduct,
  warehouseId: string,
  unit: TestUnit,
  quantity: number,
) {
  await ensureOutboundStock(product, warehouseId, unit, quantity);
  usedMovementTypes.add(StockMovementType.SALE);
  const result = await post("/api/sales", {
    clientRequestId: createOperationReference("STRESS-SALE"),
    invoiceNo: createOperationReference("STRESS-S"),
    customerId,
    currencyId: baseCurrencyId,
    paidAmount: 0,
    discount: 0,
    note: marker,
    items: [
      {
        productId: product.id,
        warehouseId,
        unitId: unit.id,
        quantity,
        unitPrice: 20 * unit.rate,
        discount: 0,
      },
    ],
  });
  const sale = result.payload.data.sale as {
    id: string;
    items: Array<{ id: string; quantity: unknown }>;
  };
  expect(sale.items.every((item) => Number(item.quantity) > 0)).toBe(true);
  changeExpectedStock(product.id, warehouseId, -quantity * unit.rate);
  await assertExpectedStock(product.id, warehouseId);
  return sale;
}

async function runProductScenario(product: TestProduct, productIndex: number) {
  const random = seededRandom(7_919 + productIndex * 97);
  const usedUnits = new Set<string>();
  const openingUnit = product.units.find((unit) => unit.rate === 1) ?? product.units[0]!;

  await post("/api/inventory/opening-stock", {
    productId: product.id,
    warehouseId: warehouseIds[0],
    unitId: openingUnit.id,
    quantity: roundStockQuantity(50 / openingUnit.rate),
    unitCost: 10,
    currencyId: baseCurrencyId,
    ...(product.hasExpiry ? { expiryDate: testExpiryDate } : {}),
    note: `${marker} opening 50`,
  });
  usedMovementTypes.add(StockMovementType.OPENING_STOCK);
  setExpectedStock(product.id, warehouseIds[0]!, 50);
  setExpectedStock(product.id, warehouseIds[1]!, 0);
  await assertExpectedStock(product.id, warehouseIds[0]!);
  await assertExpectedStock(product.id, warehouseIds[1]!);

  const requiredKinds = [
    "ADJUSTMENT_IN",
    "ADJUSTMENT_OUT",
    "DAMAGE",
    "TRANSFER",
    "PURCHASE",
    "SALE",
    "SALE_RETURN",
    "PURCHASE_RETURN",
    "ADJUSTMENT_CANCEL",
    "TRANSFER_CANCEL",
    "SALE_CANCEL",
    "PURCHASE_CANCEL",
    "SALE_RETURN_CANCEL",
    "PURCHASE_RETURN_CANCEL",
  ] as const;

  for (let operationIndex = 0; operationIndex < OPERATIONS_PER_PRODUCT; operationIndex += 1) {
    const unit =
      operationIndex < product.units.length
        ? product.units[operationIndex]!
        : product.units[Math.floor(random() * product.units.length)]!;
    usedUnits.add(unit.id);
    const quantity = enteredQuantity(unit, random);
    const kind =
      operationIndex < requiredKinds.length
        ? requiredKinds[operationIndex]!
        : requiredKinds[Math.floor(random() * requiredKinds.length)]!;
    const warehouseIndex = Math.floor(random() * warehouseIds.length);
    const warehouseId = warehouseIds[warehouseIndex]!;
    const otherWarehouseId = warehouseIds[warehouseIndex === 0 ? 1 : 0]!;
    const quantityBase = roundStockQuantity(quantity * unit.rate);

    if (kind === "ADJUSTMENT_IN") {
      await addStock(product, warehouseId, unit, quantity, marker);
      continue;
    }

    if (kind === "ADJUSTMENT_OUT" || kind === "DAMAGE") {
      await ensureOutboundStock(product, warehouseId, unit, quantity);
      const type = kind === "DAMAGE" ? "DAMAGE" : "ADJUSTMENT_OUT";
      usedMovementTypes.add(
        kind === "DAMAGE" ? StockMovementType.DAMAGE : StockMovementType.ADJUSTMENT_OUT,
      );
      await post("/api/inventory/adjustments", {
        productId: product.id,
        warehouseId,
        unitId: unit.id,
        type,
        quantity,
        note: marker,
      });
      changeExpectedStock(product.id, warehouseId, -quantityBase);
      await assertExpectedStock(product.id, warehouseId);
      continue;
    }

    if (kind === "TRANSFER" || kind === "TRANSFER_CANCEL") {
      await ensureOutboundStock(product, warehouseId, unit, quantity);
      usedMovementTypes.add(StockMovementType.TRANSFER_OUT);
      usedMovementTypes.add(StockMovementType.TRANSFER_IN);
      const transfer = await post("/api/inventory/transfers", {
        productId: product.id,
        fromWarehouseId: warehouseId,
        toWarehouseId: otherWarehouseId,
        unitId: unit.id,
        quantity,
        note: marker,
      });
      changeExpectedStock(product.id, warehouseId, -quantityBase);
      changeExpectedStock(product.id, otherWarehouseId, quantityBase);
      await assertExpectedStock(product.id, warehouseId);
      await assertExpectedStock(product.id, otherWarehouseId);
      if (kind === "TRANSFER_CANCEL") {
        await post(`/api/inventory/transfers/${transfer.payload.data.referenceId}/cancel`, {
          reason: `${marker} transfer cancellation`,
        });
        changeExpectedStock(product.id, warehouseId, quantityBase);
        changeExpectedStock(product.id, otherWarehouseId, -quantityBase);
        await assertExpectedStock(product.id, warehouseId);
        await assertExpectedStock(product.id, otherWarehouseId);
      }
      continue;
    }

    if (kind === "PURCHASE") {
      await createPurchase(product, warehouseId, unit, quantity);
      continue;
    }

    if (kind === "SALE") {
      await createSale(product, warehouseId, unit, quantity);
      continue;
    }

    if (kind === "PURCHASE_RETURN" || kind === "PURCHASE_RETURN_CANCEL") {
      const purchase = await createPurchase(product, warehouseId, unit, quantity);
      usedMovementTypes.add(StockMovementType.PURCHASE_RETURN);
      const returned = await post("/api/purchase-returns", {
        purchaseId: purchase.id,
        supplierId,
        receivedAmount: 0,
        note: marker,
        items: [{ purchaseItemId: purchase.items[0]!.id, quantity }],
      });
      changeExpectedStock(product.id, warehouseId, -quantityBase);
      await assertExpectedStock(product.id, warehouseId);
      if (kind === "PURCHASE_RETURN_CANCEL") {
        await post(`/api/purchase-returns/${returned.payload.data.purchaseReturn.id}/cancel`, {
          reason: `${marker} purchase return cancellation`,
        });
        changeExpectedStock(product.id, warehouseId, quantityBase);
        await assertExpectedStock(product.id, warehouseId);
      }
      continue;
    }

    if (kind === "SALE_RETURN" || kind === "SALE_RETURN_CANCEL") {
      const sale = await createSale(product, warehouseId, unit, quantity);
      usedMovementTypes.add(StockMovementType.SALE_RETURN);
      const returned = await post("/api/sale-returns", {
        saleId: sale.id,
        customerId,
        refundAmount: 0,
        note: marker,
        items: sale.items.map((item) => ({
          saleItemId: item.id,
          quantity: Number(item.quantity),
        })),
      });
      changeExpectedStock(product.id, warehouseId, quantityBase);
      await assertExpectedStock(product.id, warehouseId);
      if (kind === "SALE_RETURN_CANCEL") {
        await post(`/api/sale-returns/${returned.payload.data.saleReturn.id}/cancel`, {
          reason: `${marker} sale return cancellation`,
        });
        changeExpectedStock(product.id, warehouseId, -quantityBase);
        await assertExpectedStock(product.id, warehouseId);
      }
      continue;
    }

    if (kind === "SALE_CANCEL") {
      const sale = await createSale(product, warehouseId, unit, quantity);
      usedMovementTypes.add(StockMovementType.SALE_RETURN);
      await post(`/api/sales/${sale.id}/cancel`, { reason: `${marker} sale cancellation` });
      changeExpectedStock(product.id, warehouseId, quantityBase);
      await assertExpectedStock(product.id, warehouseId);
      continue;
    }

    if (kind === "PURCHASE_CANCEL") {
      const purchase = await createPurchase(product, warehouseId, unit, quantity);
      usedMovementTypes.add(StockMovementType.PURCHASE_RETURN);
      await post(`/api/purchases/${purchase.id}/cancel`, {
        reason: `${marker} purchase cancellation`,
      });
      changeExpectedStock(product.id, warehouseId, -quantityBase);
      await assertExpectedStock(product.id, warehouseId);
      continue;
    }

    const adjustment = await addStock(product, warehouseId, unit, quantity, marker);
    usedMovementTypes.add(StockMovementType.ADJUSTMENT_OUT);
    await post(`/api/inventory/movements/${adjustment.payload.data.movement.id}/cancel`, {
      reason: `${marker} adjustment cancellation`,
    });
    changeExpectedStock(product.id, warehouseId, -quantityBase);
    await assertExpectedStock(product.id, warehouseId);
  }

  expect(usedUnits.size).toBe(product.units.length);
  const movementCount = await prisma.stockMovement.count({
    where: { productId: product.id },
  });
  expect(movementCount).toBeGreaterThanOrEqual(OPERATIONS_PER_PRODUCT + 1);
}

beforeAll(async () => {
  const [user, currency] = await Promise.all([
    prisma.user.findFirst({ where: { isActive: true } }),
    prisma.currency.findFirst({ where: { isBase: true, deletedAt: null } }),
  ]);
  if (!user || !currency) {
    throw new Error("Seeded admin and base currency are required for the stock stress test.");
  }
  adminUser = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: "Admin",
    permissions: [],
    mustChangePassword: false,
    employee: null,
  };
  baseCurrencyId = currency.id;

  app.use("/api/*", async (c, next) => {
    c.set("authUser", adminUser);
    await next();
  });
  app.use("/api/*", idempotencyMiddleware);
  app.route("/api/inventory", inventoryRoute);
  app.route("/api/products", productsRoute);
  app.route("/api/purchases", purchasesRoute);
  app.route("/api/sales", salesRoute);
  app.route("/api/purchase-returns", purchaseReturnsRoute);
  app.route("/api/sale-returns", saleReturnsRoute);

  const [baseUnit, packUnit, cartonUnit] = await Promise.all([
    prisma.unit.create({ data: { name: `${marker} piece`, shortName: "pc" } }),
    prisma.unit.create({ data: { name: `${marker} pack`, shortName: "pk" } }),
    prisma.unit.create({ data: { name: `${marker} carton`, shortName: "ct" } }),
  ]);
  const warehouses = await Promise.all([
    prisma.warehouse.create({ data: { name: `${marker} main` } }),
    prisma.warehouse.create({ data: { name: `${marker} secondary` } }),
  ]);
  warehouseIds = warehouses.map((warehouse) => warehouse.id);
  const [customer, supplier] = await Promise.all([
    prisma.party.create({
      data: { type: "CUSTOMER", name: `${marker} customer`, code: `${marker}-C` },
    }),
    prisma.party.create({
      data: { type: "SUPPLIER", name: `${marker} supplier`, code: `${marker}-S` },
    }),
  ]);
  customerId = customer.id;
  supplierId = supplier.id;

  const unitDefinitions = [
    { id: baseUnit.id, rate: 1, name: baseUnit.name },
    { id: packUnit.id, rate: 6, name: packUnit.name },
    { id: cartonUnit.id, rate: 12, name: cartonUnit.name },
  ];
  products = [];
  if (useExistingProducts) {
    const candidateProducts = await prisma.product.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        units: { some: { conversionRate: 1 } },
      },
      include: {
        _count: { select: { stockMovements: true } },
        units: {
          where: { conversionRate: { gt: 0 } },
          include: { unit: true },
          orderBy: { conversionRate: "asc" },
          take: 10,
        },
      },
      orderBy: { id: "asc" },
      take: 2_000,
    });
    if (candidateProducts.length < PRODUCT_COUNT) {
      throw new Error(
        `Existing-data stress mode requires ${PRODUCT_COUNT} active products with valid units; found ${candidateProducts.length}.`,
      );
    }

    const complaintTokens = new Set(
      (process.env.STOCK_STRESS_COMPLAINT_PRODUCTS || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    const selected: typeof candidateProducts = [];
    const selectedIds = new Set<string>();
    const addCandidates = (items: typeof candidateProducts, limit: number) => {
      for (const item of items) {
        if (selected.length >= PRODUCT_COUNT || limit <= 0) break;
        if (selectedIds.has(item.id)) continue;
        selected.push(item);
        selectedIds.add(item.id);
        limit -= 1;
      }
    };
    addCandidates(
      candidateProducts.filter(
        (item) =>
          complaintTokens.has(item.id) ||
          complaintTokens.has(item.barcode || "") ||
          complaintTokens.has(item.barcodeNormalized || ""),
      ),
      PRODUCT_COUNT,
    );
    addCandidates(candidateProducts.filter((item) => item.hasExpiry), 20);
    addCandidates(candidateProducts.filter((item) => item.units.length > 1), 30);
    addCandidates(
      [...candidateProducts].sort(
        (left, right) => right._count.stockMovements - left._count.stockMovements,
      ),
      30,
    );
    const random = seededRandom(41_729);
    const randomCandidates = [...candidateProducts];
    for (let index = randomCandidates.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [randomCandidates[index], randomCandidates[swapIndex]] = [
        randomCandidates[swapIndex]!,
        randomCandidates[index]!,
      ];
    }
    addCandidates(randomCandidates, PRODUCT_COUNT);

    products = selected.slice(0, PRODUCT_COUNT).map((product) => ({
      id: product.id,
      barcode: product.barcode || product.id,
      hasExpiry: product.hasExpiry,
      units: product.units.map((item) => ({
        id: item.unitId,
        rate: Number(item.conversionRate),
        name: item.unit.name,
      })),
    }));
    return;
  }

  for (let index = 0; index < PRODUCT_COUNT; index += 1) {
    const barcode = `98${String(Date.now()).slice(-7)}${String(index).padStart(3, "0")}${String(index % 10)}`;
    const product = await prisma.product.create({
      data: {
        name: `${marker} product ${index + 1}`,
        sku: `${marker}-SKU-${index + 1}`,
        barcode,
        barcodeNormalized: barcode,
        baseUnitId: baseUnit.id,
        defaultWarehouseId: warehouses[0]!.id,
        units: {
          create: unitDefinitions.map((unit, unitIndex) => ({
            unitId: unit.id,
            conversionRate: unit.rate,
            purchasePrice: 10 * unit.rate,
            salePrice: 20 * unit.rate,
            isDefaultPurchase: unitIndex === 1,
            isDefaultSale: unitIndex === 0,
          })),
        },
      },
    });
    products.push({ id: product.id, barcode, hasExpiry: false, units: unitDefinitions });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("randomized inventory movement release gate", () => {
  it(`keeps ${PRODUCT_COUNT} products consistent through ${OPERATIONS_PER_PRODUCT} realistic randomized operations each`, async () => {
    const startedAt = new Date();
    for (let offset = 0; offset < products.length; offset += PRODUCT_CONCURRENCY) {
      const batch = await Promise.allSettled(
        products
          .slice(offset, offset + PRODUCT_CONCURRENCY)
          .map((product, index) => runProductScenario(product, offset + index)),
      );
      const failure = batch.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") {
        throw failure.reason;
      }
    }

    const productIds = products.map((product) => product.id);
    const [lots, balances, movements, idempotencyCount, operationRows] = await Promise.all([
      prisma.stockLot.findMany({
        where: {
          productId: { in: productIds },
          warehouseId: { in: warehouseIds },
        },
        select: { productId: true, warehouseId: true, remainingQuantity: true },
      }),
      prisma.stockBalance.findMany({
        where: {
          productId: { in: productIds },
          warehouseId: { in: warehouseIds },
        },
        select: { productId: true, warehouseId: true, quantityBase: true },
      }),
      prisma.stockMovement.findMany({
        where: {
          productId: { in: productIds },
          warehouseId: { in: warehouseIds },
        },
        select: {
          productId: true,
          warehouseId: true,
          type: true,
          quantity: true,
          operationId: true,
          occurredAt: true,
        },
      }),
      prisma.idempotencyRecord.count({
        where: { userId: adminUser.id, createdAt: { gte: startedAt } },
      }),
      prisma.inventoryOperation.findMany({
        where: {
          createdByUserId: adminUser.id,
          createdAt: { gte: startedAt },
        },
        select: {
          sourceChannel: true,
          sourceDeviceCode: true,
          appVersion: true,
          correlationId: true,
        },
      }),
    ]);

    const keyOf = (productId: string, warehouseId: string) => `${productId}:${warehouseId}`;
    const lotTotals = new Map<string, number>();
    for (const lot of lots) {
      expect(Number(lot.remainingQuantity)).toBeGreaterThanOrEqual(0);
      const key = keyOf(lot.productId, lot.warehouseId);
      lotTotals.set(
        key,
        roundStockQuantity((lotTotals.get(key) || 0) + Number(lot.remainingQuantity)),
      );
    }
    const balanceTotals = new Map(
      balances.map((balance) => [
        keyOf(balance.productId, balance.warehouseId),
        roundStockQuantity(Number(balance.quantityBase)),
      ]),
    );
    const ledgerTotals = new Map<string, number>();
    const inbound = new Set<StockMovementType>([
      StockMovementType.OPENING_STOCK,
      StockMovementType.PURCHASE,
      StockMovementType.SALE_RETURN,
      StockMovementType.ADJUSTMENT_IN,
      StockMovementType.TRANSFER_IN,
    ]);
    for (const movement of movements) {
      expect(movement.operationId).toBeTruthy();
      expect(movement.occurredAt).toBeInstanceOf(Date);
      const key = keyOf(movement.productId, movement.warehouseId);
      const signed = Number(movement.quantity) * (inbound.has(movement.type) ? 1 : -1);
      ledgerTotals.set(key, roundStockQuantity((ledgerTotals.get(key) || 0) + signed));
    }

    const allKeys = new Set([...lotTotals.keys(), ...balanceTotals.keys(), ...ledgerTotals.keys()]);
    for (const key of allKeys) {
      expect(balanceTotals.get(key) || 0).toBeCloseTo(lotTotals.get(key) || 0, 4);
      expect(ledgerTotals.get(key) || 0).toBeCloseTo(lotTotals.get(key) || 0, 4);
    }
    expect(new Set(movements.map((movement) => movement.type)).size).toBe(
      Object.values(StockMovementType).length,
    );
    expect(idempotencyCount).toBeGreaterThanOrEqual(PRODUCT_COUNT * OPERATIONS_PER_PRODUCT);
    expect(operationRows.length).toBeGreaterThanOrEqual(PRODUCT_COUNT * OPERATIONS_PER_PRODUCT);
    expect(operationRows.every((row) => row.sourceChannel === "TEST")).toBe(true);
    expect(operationRows.every((row) => row.sourceDeviceCode === "STOCK-STRESS-DEVICE")).toBe(true);
    expect(operationRows.every((row) => row.appVersion === "stock-stress")).toBe(true);
    expect(operationRows.every((row) => Boolean(row.correlationId))).toBe(true);

    const sample = products[0]!;
    const deniedApp = new Hono<{ Variables: { authUser: AuthUser } }>();
    deniedApp.use("*", async (c, next) => {
      c.set("authUser", {
        ...adminUser,
        role: "Cashier",
        permissions: ["pos.sell"],
      });
      await next();
    });
    deniedApp.route("/api/inventory", inventoryRoute);
    const deniedAdjustment = await deniedApp.request(
      "http://localhost/api/inventory/adjustments",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: sample.id,
          warehouseId: warehouseIds[0],
          unitId: sample.units[0]!.id,
          type: "ADJUSTMENT_IN",
          quantity: 1,
          unitCost: 10,
          currencyId: baseCurrencyId,
          ...(sample.hasExpiry ? { expiryDate: testExpiryDate } : {}),
        }),
      },
    );
    expect(deniedAdjustment.status).toBe(403);

    const pageChecks = await Promise.all([
      jsonRequest(`/api/products?search=${sample.barcode}&page=1&limit=20`),
      jsonRequest(`/api/products/lookup?search=${sample.barcode}&limit=20`),
      jsonRequest(`/api/products/pos-search?search=${sample.barcode}&limit=20&offset=0`),
      jsonRequest(`/api/products/barcode-lookup?barcode=${sample.barcode}`),
      jsonRequest(
        `/api/inventory/stock?productId=${sample.id}&sortBy=quantity&sortOrder=desc&page=1&limit=20`,
      ),
      jsonRequest(`/api/inventory/lots?productId=${sample.id}&page=1&limit=20`),
      jsonRequest(`/api/inventory/movements?productId=${sample.id}&page=1&limit=20`),
      jsonRequest(`/api/inventory/transfer-reports?search=${sample.barcode}&page=1&limit=20`),
      jsonRequest(`/api/inventory/damage-reports?page=1&limit=20`),
      jsonRequest(`/api/inventory/product-history/${sample.id}?page=1&limit=20`),
    ]);
    expect(pageChecks.every((check) => check.response.status === 200)).toBe(true);

    const duplicateKey = createOperationReference("DUPLICATE-CHECK");
    const sampleUnit = sample.units[1] ?? sample.units[0]!;
    const duplicateBody = {
      productId: sample.id,
      warehouseId: warehouseIds[0],
      unitId: sampleUnit.id,
      type: "ADJUSTMENT_IN",
      quantity: 1,
      unitCost: 60,
      currencyId: baseCurrencyId,
      ...(sample.hasExpiry ? { expiryDate: testExpiryDate } : {}),
      note: `${marker} concurrent duplicate check ${randomUUID()}`,
    };
    const before = await warehouseStock(sample.id, warehouseIds[0]!);
    const [first, second] = await Promise.all([
      post("/api/inventory/adjustments", duplicateBody, duplicateKey),
      post("/api/inventory/adjustments", duplicateBody, duplicateKey),
    ]);
    const after = await warehouseStock(sample.id, warehouseIds[0]!);
    expect(after - before).toBeCloseTo(sampleUnit.rate, 4);
    changeExpectedStock(sample.id, warehouseIds[0]!, sampleUnit.rate);
    await assertExpectedStock(sample.id, warehouseIds[0]!);
    expect(
      [first, second].filter(
        (result) => result.response.headers.get("Idempotency-Replayed") === "true",
      ),
    ).toHaveLength(1);
    const duplicateOperation = await prisma.inventoryOperation.findUniqueOrThrow({
      where: { clientRequestId: duplicateKey },
      include: { movements: true },
    });
    const duplicateJournal = await prisma.journalEntry.findUniqueOrThrow({
      where: {
        sourceType_sourceId: {
          sourceType: "INVENTORY_ADJUSTMENT_IN",
          sourceId: duplicateOperation.id,
        },
      },
      include: { lines: true },
    });
    expect(duplicateOperation.movements).toHaveLength(1);
    expect(duplicateJournal.lines).toHaveLength(2);
    expect(
      duplicateJournal.lines.reduce((sum, line) => sum + Number(line.baseDebit), 0),
    ).toBeCloseTo(
      duplicateJournal.lines.reduce((sum, line) => sum + Number(line.baseCredit), 0),
      4,
    );

    const cancellable = await addStock(
      sample,
      warehouseIds[0]!,
      sampleUnit,
      1,
      `${marker} concurrent cancellation check`,
    );
    const cancellableMovementId = cancellable.payload.data.movement.id as string;
    const beforeCancellation = await warehouseStock(sample.id, warehouseIds[0]!);
    const cancellationResults = await Promise.allSettled([
      post(
        `/api/inventory/movements/${cancellableMovementId}/cancel`,
        { reason: `${marker} first concurrent cancellation` },
        createOperationReference("CANCEL-A"),
      ),
      post(
        `/api/inventory/movements/${cancellableMovementId}/cancel`,
        { reason: `${marker} second concurrent cancellation` },
        createOperationReference("CANCEL-B"),
      ),
    ]);
    const afterCancellation = await warehouseStock(sample.id, warehouseIds[0]!);
    const cancellationRows = await prisma.stockMovement.count({
      where: {
        referenceType: "ADJUSTMENT_IN_CANCEL",
        referenceId: cancellableMovementId,
      },
    });
    expect(cancellationResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(cancellationResults.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(cancellationRows).toBe(1);
    expect(afterCancellation).toBeCloseTo(beforeCancellation - sampleUnit.rate, 4);
    changeExpectedStock(sample.id, warehouseIds[0]!, -sampleUnit.rate);
    await assertExpectedStock(sample.id, warehouseIds[0]!);
    const cancellableOperationId = cancellable.payload.data.movement.operationId as string;
    const reversalJournal = await prisma.journalEntry.findUniqueOrThrow({
      where: {
        sourceType_sourceId: {
          sourceType: "INVENTORY_ADJUSTMENT_IN_CANCEL",
          sourceId: cancellableOperationId,
        },
      },
      include: { lines: true },
    });
    expect(reversalJournal.lines).toHaveLength(2);
    expect(
      reversalJournal.lines.reduce((sum, line) => sum + Number(line.baseDebit), 0),
    ).toBeCloseTo(
      reversalJournal.lines.reduce((sum, line) => sum + Number(line.baseCredit), 0),
      4,
    );

    const beforeWorker = await prisma.stockLot.aggregate({
      where: { productId: { in: productIds }, warehouseId: { in: warehouseIds } },
      _sum: { remainingQuantity: true },
    });
    const balanceBeforeWorker = await prisma.stockBalance.aggregate({
      where: { productId: { in: productIds }, warehouseId: { in: warehouseIds } },
      _sum: { quantityBase: true, valueBase: true },
    });
    const movementCountBeforeWorker = await prisma.stockMovement.count({
      where: { productId: { in: productIds }, warehouseId: { in: warehouseIds } },
    });
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const reconciliation = await reconcileStockBalances();
      expect(reconciliation.repaired).toBe(0);
    }
    const [afterWorker, balanceAfterWorker, movementCountAfterWorker] = await Promise.all([
      prisma.stockLot.aggregate({
        where: { productId: { in: productIds }, warehouseId: { in: warehouseIds } },
        _sum: { remainingQuantity: true },
      }),
      prisma.stockBalance.aggregate({
        where: { productId: { in: productIds }, warehouseId: { in: warehouseIds } },
        _sum: { quantityBase: true, valueBase: true },
      }),
      prisma.stockMovement.count({
        where: { productId: { in: productIds }, warehouseId: { in: warehouseIds } },
      }),
    ]);
    expect(Number(afterWorker._sum.remainingQuantity || 0)).toBeCloseTo(
      Number(beforeWorker._sum.remainingQuantity || 0),
      4,
    );
    expect(movementCountAfterWorker).toBe(movementCountBeforeWorker);
    expect(Number(balanceAfterWorker._sum.quantityBase || 0)).toBeCloseTo(
      Number(balanceBeforeWorker._sum.quantityBase || 0),
      4,
    );
    expect(Number(balanceAfterWorker._sum.valueBase || 0)).toBeCloseTo(
      Number(balanceBeforeWorker._sum.valueBase || 0),
      4,
    );
  });
});
