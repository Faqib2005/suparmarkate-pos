import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuthUser } from "../../lib/auth";
import { cacheDeleteByPattern } from "../../lib/cache";
import { prisma } from "../../lib/prisma";
import { dashboardRoute } from "../dashboard/routes";
import { posReceiptsRoute } from "../pos-receipts/routes";
import { reportsRoute } from "../reports/routes";
import { saleReturnsRoute } from "../sale-returns/routes";
import { salesRoute } from "./routes";

const databaseUrl = process.env.DATABASE_URL || "";

if (!/[/_]supermarket_test(?:\?|$)/.test(databaseUrl)) {
  throw new Error("Atomic sale integration tests require the isolated supermarket_test database.");
}

type Fixture = {
  productId: string;
  cashRegisterId: string;
  cashAccountId: string;
  saleCurrencyId: string;
  lotIds: string[];
  clientRequestIds: string[];
  partyIds: string[];
  bankAccountIds: string[];
  currencyIds: string[];
  currencyRateIds: string[];
};

let baseCurrencyId = "";
let warehouseId = "";
let unitId = "";
let adminUserId = "";
const fixtures: Fixture[] = [];
const adminSalesApp = new Hono<{ Variables: { authUser: AuthUser } }>();
const adminReturnsApp = new Hono<{ Variables: { authUser: AuthUser } }>();

const attachAdmin = async (c: any, next: () => Promise<void>) => {
  c.set("authUser", {
    id: adminUserId,
    username: "admin",
    displayName: "Integration Admin",
    role: "Admin",
    permissions: [],
    employee: null
  });
  await next();
};
adminSalesApp.use("*", attachAdmin);
adminSalesApp.route("/", salesRoute);
adminReturnsApp.use("*", attachAdmin);
adminReturnsApp.route("/", saleReturnsRoute);

async function createFixture(
  label: string,
  saleCurrencyId = baseCurrencyId,
  lotQuantities: number[] = [4, 5],
): Promise<Fixture> {
  const suffix = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const product = await prisma.product.create({
    data: {
      name: `Atomic sale ${suffix}`,
      sku: `ATOMIC-${suffix}`,
      barcode: `99${Date.now()}${Math.floor(Math.random() * 10000)}`,
      baseUnitId: unitId,
      defaultWarehouseId: warehouseId
    }
  });
  const cashRegister = await prisma.cashRegister.create({
    data: {
      name: `Atomic register ${suffix}`,
      code: `AR-${suffix}`,
      accounts: {
        create: {
          currencyId: saleCurrencyId,
          balance: 0
        }
      }
    },
    include: { accounts: true }
  });
  const lots = await Promise.all(
    lotQuantities.map((quantity, index) => {
      const unitCost = 10 + index * 2;
      return prisma.stockLot.create({
        data: {
          productId: product.id,
          warehouseId,
          initialQuantity: quantity,
          remainingQuantity: quantity,
          unitCost,
          currencyId: baseCurrencyId,
          exchangeRate: 1,
          baseUnitCost: unitCost,
          sourceType: "ATOMIC_SALE_TEST",
          createdAt: new Date(Date.now() - (lotQuantities.length - index) * 1_000),
        },
      });
    }),
  );

  const fixture = {
    productId: product.id,
    cashRegisterId: cashRegister.id,
    cashAccountId: cashRegister.accounts[0]!.id,
    saleCurrencyId,
    lotIds: lots.map((lot) => lot.id),
    clientRequestIds: [] as string[],
    partyIds: [] as string[],
    bankAccountIds: [] as string[],
    currencyIds: [] as string[],
    currencyRateIds: [] as string[]
  };

  fixtures.push(fixture);
  return fixture;
}

function saleRequest(
  fixture: Fixture,
  clientRequestId: string,
  overrides: {
    customerId?: string | null;
    paidAmount?: number;
    paymentAccountType?: "CASH" | "BANK";
    paymentAccountId?: string;
    paymentLines?: Array<{
      paymentAccountType: "CASH" | "BANK";
      paymentAccountId: string;
      amount: number;
    }>;
    discount?: number;
    itemDiscount?: number;
    quantity?: number;
    unitPrice?: number;
  } = {}
) {
  const paidAmount = overrides.paidAmount ?? 120;

  return salesRoute.request("http://localhost/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientRequestId,
      invoiceNo: `POS-${clientRequestId}`,
      customerId: overrides.customerId ?? null,
      currencyId: fixture.saleCurrencyId,
      discount: overrides.discount ?? 0,
      paidAmount,
      paymentAccountType: overrides.paymentAccountType ?? "CASH",
      paymentAccountId: overrides.paymentAccountId ?? fixture.cashAccountId,
      paymentLines: overrides.paymentLines,
      items: [
        {
          productId: fixture.productId,
          warehouseId,
          unitId,
          quantity: overrides.quantity ?? 6,
          unitPrice: overrides.unitPrice ?? 20,
          discount: overrides.itemDiscount ?? 0
        }
      ]
    })
  });
}

async function cleanupFixture(fixture: Fixture) {
  const sales = await prisma.sale.findMany({
    where: { clientRequestId: { in: fixture.clientRequestIds } },
    select: { id: true }
  });
  const saleIds = sales.map((sale) => sale.id);

  if (saleIds.length > 0) {
    const saleReturns = await prisma.saleReturn.findMany({
      where: { saleId: { in: saleIds } },
      select: { id: true }
    });
    const saleReturnIds = saleReturns.map((saleReturn) => saleReturn.id);
    const referenceIds = [...saleIds, ...saleReturnIds];
    const inventoryOperationIds = (
      await prisma.stockMovement.findMany({
        where: { referenceId: { in: referenceIds }, operationId: { not: null } },
        select: { operationId: true }
      })
    )
      .map((movement) => movement.operationId)
      .filter((operationId): operationId is string => Boolean(operationId));

    await prisma.auditLog.deleteMany({
      where: { entityId: { in: referenceIds } }
    });
    await prisma.journalEntry.deleteMany({ where: { sourceId: { in: referenceIds } } });
    await prisma.moneyTransaction.deleteMany({
      where: { referenceId: { in: referenceIds } }
    });
    await prisma.partyTransaction.deleteMany({
      where: { referenceId: { in: referenceIds } }
    });
    await prisma.stockMovement.deleteMany({
      where: { referenceId: { in: referenceIds } }
    });
    if (inventoryOperationIds.length > 0) {
      await prisma.inventoryOperation.deleteMany({
        where: { id: { in: inventoryOperationIds } }
      });
    }
    await prisma.saleExchange.deleteMany({
      where: {
        OR: [
          { sourceSaleId: { in: saleIds } },
          { replacementSaleId: { in: saleIds } },
          { saleReturnId: { in: saleReturnIds } },
        ],
      },
    });
    await prisma.saleReturn.deleteMany({ where: { id: { in: saleReturnIds } } });
    await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
  }

  await prisma.stockLot.deleteMany({ where: { id: { in: fixture.lotIds } } });
  await prisma.product.delete({ where: { id: fixture.productId } }).catch(() => undefined);
  await prisma.bankAccount.deleteMany({ where: { id: { in: fixture.bankAccountIds } } });
  await prisma.cashRegister.delete({ where: { id: fixture.cashRegisterId } }).catch(() => undefined);
  await prisma.party.deleteMany({ where: { id: { in: fixture.partyIds } } });
  await prisma.currencyRate.deleteMany({ where: { id: { in: fixture.currencyRateIds } } });
  await prisma.currency.deleteMany({ where: { id: { in: fixture.currencyIds } } });
}

beforeAll(async () => {
  const [currency, warehouse, unit, admin] = await Promise.all([
    prisma.currency.findFirst({ where: { isBase: true, deletedAt: null } }),
    prisma.warehouse.findFirst({ where: { deletedAt: null, isActive: true } }),
    prisma.unit.findFirst({ where: { deletedAt: null, isActive: true } }),
    prisma.user.findFirst({ where: { role: { name: "Admin" } } })
  ]);

  if (!currency || !warehouse || !unit || !admin) {
    throw new Error("Seeded Admin, currency, warehouse and unit are required for sale integration tests.");
  }

  const requiredAccounts = await prisma.accountingAccount.count({
    where: { code: { in: ["1000", "1300", "4000", "5000"] }, isActive: true }
  });

  if (requiredAccounts !== 4) {
    throw new Error("Seeded POS accounting accounts are required for sale integration tests.");
  }

  baseCurrencyId = currency.id;
  warehouseId = warehouse.id;
  unitId = unit.id;
  adminUserId = admin.id;
});

afterAll(async () => {
  for (const fixture of fixtures.reverse()) {
    await cleanupFixture(fixture);
  }

  await prisma.accountingAccount.updateMany({
    where: { code: "5000" },
    data: { isActive: true }
  });
  await prisma.$disconnect();
});

describe("atomic POS sale", () => {
  it("records a sale return and replacement sale as one atomic exchange", async () => {
    const fixture = await createFixture("sale-exchange");
    const sourceRequestId = `atomic-${Date.now()}-exchange-source`;
    const exchangeRequestId = `atomic-${Date.now()}-exchange-document`;
    fixture.clientRequestIds.push(sourceRequestId, exchangeRequestId);
    const customer = await prisma.party.create({
      data: {
        type: "CUSTOMER",
        name: `Exchange customer ${Date.now()}`,
        code: `EX-${Date.now()}`,
      },
    });
    fixture.partyIds.push(customer.id);

    const sourceResponse = await saleRequest(fixture, sourceRequestId, {
      customerId: customer.id,
      paidAmount: 120,
    });
    expect(sourceResponse.status).toBe(201);
    const sourcePayload = (await sourceResponse.json()) as any;
    const sourceSaleId = sourcePayload.data.sale.id as string;
    const sourceSale = await prisma.sale.findUniqueOrThrow({
      where: { id: sourceSaleId },
      include: { items: { orderBy: { quantity: "desc" } } },
    });
    const returnItem = sourceSale.items.find((item) => Number(item.quantity) >= 2);
    expect(returnItem).toBeTruthy();

    const exchangeBody = {
      clientRequestId: exchangeRequestId,
      saleId: sourceSale.id,
      refundAmount: 0,
      note: "Atomic exchange integration test",
      returnItems: [{ saleItemId: returnItem!.id, quantity: 2 }],
      replacement: {
        paidAmount: 20,
        paymentAccountType: "CASH",
        paymentAccountId: fixture.cashAccountId,
        items: [
          {
            productId: fixture.productId,
            warehouseId,
            unitId,
            quantity: 3,
            unitPrice: 20,
            discount: 0,
          },
        ],
      },
    };

    const response = await adminReturnsApp.request("http://localhost/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(exchangeBody),
    });
    expect(response.status).toBe(201);
    const payload = (await response.json()) as any;
    const replacementSaleId = payload.data.replacementSale.id as string;
    const saleReturnId = payload.data.saleReturn.id as string;

    const [exchange, replacementSale, saleReturn, lots, partyAccount, journals, cash] =
      await Promise.all([
        prisma.saleExchange.findFirstOrThrow({ where: { replacementSaleId } }),
        prisma.sale.findUniqueOrThrow({ where: { id: replacementSaleId }, include: { items: true } }),
        prisma.saleReturn.findUniqueOrThrow({ where: { id: saleReturnId }, include: { items: true } }),
        prisma.stockLot.findMany({
          where: { id: { in: fixture.lotIds } },
          orderBy: { unitCost: "asc" },
        }),
        prisma.partyAccount.findUniqueOrThrow({
          where: { partyId_currencyId: { partyId: customer.id, currencyId: fixture.saleCurrencyId } },
        }),
        prisma.journalEntry.findMany({
          where: { sourceId: { in: [saleReturnId, replacementSaleId] } },
          include: { lines: true },
        }),
        prisma.cashRegisterAccount.findUniqueOrThrow({ where: { id: fixture.cashAccountId } }),
      ]);

    expect(exchange.sourceSaleId).toBe(sourceSaleId);
    expect(exchange.saleReturnId).toBe(saleReturnId);
    expect(Number(saleReturn.subtotal)).toBe(40);
    expect(Number(replacementSale.total)).toBe(60);
    expect(Number(replacementSale.paidAmount)).toBe(60);
    expect(Number(replacementSale.remainingAmount)).toBe(0);
    expect(Number(exchange.cashPaidAmount)).toBe(20);
    expect(Number(exchange.creditApplied)).toBe(40);
    expect(Number(exchange.outstandingAmount)).toBe(0);
    expect(replacementSale.items.reduce((sum, item) => sum + Number(item.quantity), 0)).toBe(3);
    expect(lots.map((lot) => Number(lot.remainingQuantity))).toEqual([0, 2]);
    expect(Number(partyAccount.debitBalance)).toBe(40);
    expect(Number(partyAccount.creditBalance)).toBe(40);
    expect(Number(cash.balance)).toBe(140);
    expect(journals).toHaveLength(3);
    expect(
      journals.every(
        (journal) =>
          journal.lines.reduce((sum, line) => sum + Number(line.baseDebit), 0) ===
          journal.lines.reduce((sum, line) => sum + Number(line.baseCredit), 0),
      ),
    ).toBe(true);

    const [sourceReceiptTokenResponse, replacementReceiptTokenResponse] = await Promise.all([
      posReceiptsRoute.request(`http://localhost/sales/${sourceSaleId}/token`, { method: "POST" }),
      posReceiptsRoute.request(`http://localhost/sales/${replacementSaleId}/token`, { method: "POST" }),
    ]);
    const [sourceReceiptToken, replacementReceiptToken] = await Promise.all([
      sourceReceiptTokenResponse.json() as Promise<any>,
      replacementReceiptTokenResponse.json() as Promise<any>,
    ]);
    const [sourceReceiptResponse, replacementReceiptResponse] = await Promise.all([
      posReceiptsRoute.request(
        `http://localhost/sales/${sourceSaleId}/html?accessToken=${encodeURIComponent(sourceReceiptToken.data.token)}`,
      ),
      posReceiptsRoute.request(
        `http://localhost/sales/${replacementSaleId}/html?accessToken=${encodeURIComponent(replacementReceiptToken.data.token)}`,
      ),
    ]);
    expect(sourceReceiptResponse.status).toBe(200);
    expect(replacementReceiptResponse.status).toBe(200);
    expect(await sourceReceiptResponse.text()).toContain("اقلام جدید در تعویض فروش");
    expect(await replacementReceiptResponse.text()).toContain("اعتبار برگشتی استفاده‌شده");

    const replay = await adminReturnsApp.request("http://localhost/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(exchangeBody),
    });
    expect(replay.status).toBe(200);
    expect((await replay.json()) as any).toMatchObject({
      idempotentReplay: true,
      data: { replacementSale: { id: replacementSaleId } },
    });
    expect(await prisma.saleExchange.count({ where: { replacementSaleId } })).toBe(1);

    const [returnCancellation, replacementCancellation] = await Promise.all([
      adminReturnsApp.request(`http://localhost/${saleReturnId}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Must not cancel one side of an exchange" }),
      }),
      adminSalesApp.request(`http://localhost/${replacementSaleId}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Must not cancel one side of an exchange" }),
      }),
    ]);
    expect(returnCancellation.status).toBe(409);
    expect(replacementCancellation.status).toBe(409);
  });

  it("uses the system cash customer when exchanging a cash sale", async () => {
    const fixture = await createFixture("cash-sale-exchange");
    const sourceRequestId = `atomic-${Date.now()}-cash-exchange-source`;
    const exchangeRequestId = `atomic-${Date.now()}-cash-exchange-document`;
    fixture.clientRequestIds.push(sourceRequestId, exchangeRequestId);

    const sourceResponse = await saleRequest(fixture, sourceRequestId, { paidAmount: 120 });
    expect(sourceResponse.status).toBe(201);
    const sourceSaleId = ((await sourceResponse.json()) as any).data.sale.id as string;
    const sourceSale = await prisma.sale.findUniqueOrThrow({
      where: { id: sourceSaleId },
      include: { items: true },
    });
    expect(sourceSale.customerId).toBeNull();
    const returnItem = sourceSale.items.find((item) => Number(item.quantity) >= 2)!;

    const response = await adminReturnsApp.request("http://localhost/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientRequestId: exchangeRequestId,
        saleId: sourceSaleId,
        refundAmount: 0,
        returnItems: [{ saleItemId: returnItem.id, quantity: 2 }],
        replacement: {
          paidAmount: 0,
          items: [{
            productId: fixture.productId,
            warehouseId,
            unitId,
            quantity: 1,
            unitPrice: 20,
            discount: 0,
          }],
        },
      }),
    });

    expect(response.status).toBe(201);
    const payload = (await response.json()) as any;
    const [replacementSale, saleReturn, cashCustomer] = await Promise.all([
      prisma.sale.findUniqueOrThrow({ where: { id: payload.data.replacementSale.id } }),
      prisma.saleReturn.findUniqueOrThrow({ where: { id: payload.data.saleReturn.id } }),
      prisma.party.findFirstOrThrow({ where: { code: "SYSTEM-CASH-CUSTOMER", deletedAt: null } }),
    ]);

    expect(cashCustomer.name).toBe("مشتری نقدی");
    expect(replacementSale.customerId).toBe(cashCustomer.id);
    expect(saleReturn.customerId).toBe(cashCustomer.id);
  });

  it("keeps unused return credit on the customer account", async () => {
    const fixture = await createFixture("sale-exchange-credit");
    const sourceRequestId = `atomic-${Date.now()}-exchange-credit-source`;
    const exchangeRequestId = `atomic-${Date.now()}-exchange-credit-document`;
    fixture.clientRequestIds.push(sourceRequestId, exchangeRequestId);
    const customer = await prisma.party.create({
      data: {
        type: "CUSTOMER",
        name: `Exchange credit customer ${Date.now()}`,
        code: `EC-${Date.now()}`,
      },
    });
    fixture.partyIds.push(customer.id);

    const sourceResponse = await saleRequest(fixture, sourceRequestId, {
      customerId: customer.id,
      paidAmount: 120,
    });
    const sourceSaleId = ((await sourceResponse.json()) as any).data.sale.id as string;
    const sourceSale = await prisma.sale.findUniqueOrThrow({
      where: { id: sourceSaleId },
      include: { items: true },
    });
    const returnItem = sourceSale.items.find((item) => Number(item.quantity) >= 2)!;

    const response = await adminReturnsApp.request("http://localhost/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientRequestId: exchangeRequestId,
        saleId: sourceSaleId,
        customerId: customer.id,
        refundAmount: 0,
        returnItems: [{ saleItemId: returnItem.id, quantity: 2 }],
        replacement: {
          paidAmount: 0,
          items: [{
            productId: fixture.productId,
            warehouseId,
            unitId,
            quantity: 1,
            unitPrice: 20,
            discount: 0,
          }],
        },
      }),
    });
    expect(response.status).toBe(201);
    const replacementSaleId = ((await response.json()) as any).data.replacementSale.id as string;
    const [exchange, replacementSale, partyAccount] = await Promise.all([
      prisma.saleExchange.findFirstOrThrow({ where: { replacementSaleId } }),
      prisma.sale.findUniqueOrThrow({ where: { id: replacementSaleId } }),
      prisma.partyAccount.findUniqueOrThrow({
        where: { partyId_currencyId: { partyId: customer.id, currencyId: fixture.saleCurrencyId } },
      }),
    ]);

    expect(Number(exchange.cashPaidAmount)).toBe(0);
    expect(Number(exchange.creditApplied)).toBe(20);
    expect(Number(exchange.outstandingAmount)).toBe(0);
    expect(Number(replacementSale.paidAmount)).toBe(20);
    expect(Number(replacementSale.remainingAmount)).toBe(0);
    expect(Number(partyAccount.debitBalance)).toBe(20);
    expect(Number(partyAccount.creditBalance)).toBe(40);
  });

  it("records only the unpaid exchange remainder as a new receivable", async () => {
    const fixture = await createFixture("sale-exchange-receivable");
    const sourceRequestId = `atomic-${Date.now()}-exchange-receivable-source`;
    const exchangeRequestId = `atomic-${Date.now()}-exchange-receivable-document`;
    fixture.clientRequestIds.push(sourceRequestId, exchangeRequestId);
    const customer = await prisma.party.create({
      data: {
        type: "CUSTOMER",
        name: `Exchange receivable customer ${Date.now()}`,
        code: `ER-${Date.now()}`,
      },
    });
    fixture.partyIds.push(customer.id);

    const sourceResponse = await saleRequest(fixture, sourceRequestId, {
      customerId: customer.id,
      paidAmount: 120,
    });
    const sourceSaleId = ((await sourceResponse.json()) as any).data.sale.id as string;
    const sourceSale = await prisma.sale.findUniqueOrThrow({
      where: { id: sourceSaleId },
      include: { items: true },
    });
    const returnItem = sourceSale.items.find((item) => Number(item.quantity) >= 2)!;

    const response = await adminReturnsApp.request("http://localhost/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientRequestId: exchangeRequestId,
        saleId: sourceSaleId,
        customerId: customer.id,
        refundAmount: 0,
        returnItems: [{ saleItemId: returnItem.id, quantity: 2 }],
        replacement: {
          paidAmount: 5,
          paymentAccountType: "CASH",
          paymentAccountId: fixture.cashAccountId,
          items: [{
            productId: fixture.productId,
            warehouseId,
            unitId,
            quantity: 3,
            unitPrice: 20,
            discount: 0,
          }],
        },
      }),
    });
    expect(response.status).toBe(201);
    const replacementSaleId = ((await response.json()) as any).data.replacementSale.id as string;
    const [exchange, replacementSale, partyAccount] = await Promise.all([
      prisma.saleExchange.findFirstOrThrow({ where: { replacementSaleId } }),
      prisma.sale.findUniqueOrThrow({ where: { id: replacementSaleId } }),
      prisma.partyAccount.findUniqueOrThrow({
        where: { partyId_currencyId: { partyId: customer.id, currencyId: fixture.saleCurrencyId } },
      }),
    ]);

    expect(Number(exchange.cashPaidAmount)).toBe(5);
    expect(Number(exchange.creditApplied)).toBe(40);
    expect(Number(exchange.outstandingAmount)).toBe(15);
    expect(Number(replacementSale.paidAmount)).toBe(45);
    expect(Number(replacementSale.remainingAmount)).toBe(15);
    expect(Number(partyAccount.debitBalance)).toBe(55);
    expect(Number(partyAccount.creditBalance)).toBe(40);
  });

  it("rolls back the entire exchange when the replacement item has insufficient stock", async () => {
    const fixture = await createFixture("sale-exchange-rollback");
    const sourceRequestId = `atomic-${Date.now()}-exchange-rollback-source`;
    const exchangeRequestId = `atomic-${Date.now()}-exchange-rollback-document`;
    fixture.clientRequestIds.push(sourceRequestId, exchangeRequestId);
    const customer = await prisma.party.create({
      data: {
        type: "CUSTOMER",
        name: `Exchange rollback customer ${Date.now()}`,
        code: `ER-${Date.now()}`,
      },
    });
    fixture.partyIds.push(customer.id);

    const sourceResponse = await saleRequest(fixture, sourceRequestId, {
      customerId: customer.id,
      paidAmount: 120,
    });
    expect(sourceResponse.status).toBe(201);
    const sourceSaleId = ((await sourceResponse.json()) as any).data.sale.id as string;
    const sourceSale = await prisma.sale.findUniqueOrThrow({
      where: { id: sourceSaleId },
      include: { items: true },
    });
    const returnItem = sourceSale.items.find((item) => Number(item.quantity) >= 1)!;
    const beforeLots = await prisma.stockLot.findMany({
      where: { id: { in: fixture.lotIds } },
      orderBy: { unitCost: "asc" },
    });
    const beforeReturnCount = await prisma.saleReturn.count({ where: { saleId: sourceSaleId } });

    const response = await adminReturnsApp.request("http://localhost/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientRequestId: exchangeRequestId,
        saleId: sourceSaleId,
        customerId: customer.id,
        refundAmount: 0,
        returnItems: [{ saleItemId: returnItem.id, quantity: 1 }],
        replacement: {
          paidAmount: 0,
          items: [
            {
              productId: fixture.productId,
              warehouseId,
              unitId,
              quantity: 999,
              unitPrice: 20,
              discount: 0,
            },
          ],
        },
      }),
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    const [afterLots, afterReturnCount, replacementCount] = await Promise.all([
      prisma.stockLot.findMany({
        where: { id: { in: fixture.lotIds } },
        orderBy: { unitCost: "asc" },
      }),
      prisma.saleReturn.count({ where: { saleId: sourceSaleId } }),
      prisma.sale.count({ where: { clientRequestId: exchangeRequestId } }),
    ]);
    expect(afterLots.map((lot) => Number(lot.remainingQuantity))).toEqual(
      beforeLots.map((lot) => Number(lot.remainingQuantity)),
    );
    expect(afterReturnCount).toBe(beforeReturnCount);
    expect(replacementCount).toBe(0);
  });

  it("splits an 18-unit POS sale across FIFO lots and keeps one receipt quantity", async () => {
    const fixture = await createFixture("fifo-5-10-20", baseCurrencyId, [5, 10, 20]);
    const clientRequestId = `atomic-${Date.now()}-fifo-18`;
    fixture.clientRequestIds.push(clientRequestId);

    const response = await saleRequest(fixture, clientRequestId, {
      quantity: 18,
      unitPrice: 20,
      paidAmount: 360,
    });
    expect(response.status).toBe(201);
    const payload = await response.json() as any;
    const saleId = payload.data.sale.id as string;
    const sale = await prisma.sale.findUniqueOrThrow({
      where: { id: saleId },
      include: { items: true },
    });
    const lots = await prisma.stockLot.findMany({
      where: { id: { in: fixture.lotIds } },
      orderBy: { createdAt: "asc" },
    });
    const saleQuantityByLotId = new Map(
      sale.items.map((item) => [item.lotId, Number(item.quantity)]),
    );
    expect(lots.map((lot) => saleQuantityByLotId.get(lot.id))).toEqual([5, 10, 3]);
    expect(lots.map((lot) => Number(lot.remainingQuantity))).toEqual([0, 0, 17]);

    const tokenResponse = await posReceiptsRoute.request(
      `http://localhost/sales/${saleId}/token`,
      { method: "POST" },
    );
    const tokenPayload = await tokenResponse.json() as any;
    const receiptResponse = await posReceiptsRoute.request(
      `http://localhost/sales/${saleId}/html?accessToken=${encodeURIComponent(tokenPayload.data.token)}&width=80`,
    );
    expect(receiptResponse.status).toBe(200);
    expect(await receiptResponse.text()).toContain("<td>18 عدد</td>");
  });

  it("serializes ten distinct concurrent sales against the same product stock", async () => {
    const fixture = await createFixture("ten-concurrent-sales");
    const requestIds = Array.from(
      { length: 10 },
      (_, index) => `atomic-${Date.now()}-concurrent-${index}`
    );
    fixture.clientRequestIds.push(...requestIds);

    const responses = await Promise.all(
      requestIds.map((requestId) =>
        saleRequest(fixture, requestId, {
          quantity: 0.4,
          paidAmount: 8,
          unitPrice: 20
        })
      )
    );
    const payloads = await Promise.all(
      responses.map((response) => response.json() as Promise<any>)
    );

    expect(responses.every((response) => response.status === 201)).toBe(true);
    expect(new Set(payloads.map((payload) => payload.data.sale.id)).size).toBe(10);

    const saleIds = payloads.map((payload) => payload.data.sale.id as string);
    const [lots, movements, journals, cashAccount] = await Promise.all([
      prisma.stockLot.findMany({ where: { id: { in: fixture.lotIds } } }),
      prisma.stockMovement.findMany({
        where: { referenceType: "SALE", referenceId: { in: saleIds } }
      }),
      prisma.journalEntry.findMany({ where: { sourceId: { in: saleIds } } }),
      prisma.cashRegisterAccount.findUniqueOrThrow({
        where: { id: fixture.cashAccountId }
      })
    ]);

    expect(lots.reduce((sum, lot) => sum + Number(lot.remainingQuantity), 0)).toBe(5);
    expect(
      movements.reduce(
        (sum, movement) => sum + Math.abs(Number(movement.quantity)),
        0
      )
    ).toBeCloseTo(4, 4);
    expect(journals.filter((journal) => journal.sourceType === "POS_SALE")).toHaveLength(10);
    expect(journals.filter((journal) => journal.sourceType === "POS_SALE_COGS")).toHaveLength(10);
    expect(Number(cashAccount.balance)).toBe(80);
  });

  it("creates stock, money, revenue and COGS exactly once for concurrent retries", async () => {
    const fixture = await createFixture("idempotent");
    const clientRequestId = `atomic-${Date.now()}-same-request`;
    fixture.clientRequestIds.push(clientRequestId);

    const responses = await Promise.all([
      saleRequest(fixture, clientRequestId),
      saleRequest(fixture, clientRequestId)
    ]);
    const payloads = await Promise.all(responses.map((response) => response.json() as Promise<any>));

    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    expect(new Set(payloads.map((payload) => payload.data.sale.id)).size).toBe(1);

    const sale = await prisma.sale.findUniqueOrThrow({
      where: { clientRequestId },
      include: { items: true }
    });
    const [lots, movements, transactions, journals, cashAccount] = await Promise.all([
      prisma.stockLot.findMany({
        where: { id: { in: fixture.lotIds } },
        orderBy: { unitCost: "asc" }
      }),
      prisma.stockMovement.findMany({
        where: { referenceType: "SALE", referenceId: sale.id }
      }),
      prisma.moneyTransaction.findMany({
        where: { referenceType: "SALE", referenceId: sale.id }
      }),
      prisma.journalEntry.findMany({
        where: { sourceId: sale.id },
        include: { lines: true }
      }),
      prisma.cashRegisterAccount.findUniqueOrThrow({ where: { id: fixture.cashAccountId } })
    ]);

    expect(sale.items).toHaveLength(2);
    expect(lots.map((lot) => Number(lot.remainingQuantity))).toEqual([0, 3]);
    expect(movements).toHaveLength(2);
    expect(transactions).toHaveLength(1);
    expect(Number(cashAccount.balance)).toBe(120);
    expect(journals.map((journal) => journal.sourceType).sort()).toEqual([
      "POS_SALE",
      "POS_SALE_COGS"
    ]);

    const cogsJournal = journals.find((journal) => journal.sourceType === "POS_SALE_COGS");
    expect(cogsJournal?.lines.reduce((sum, line) => sum + Number(line.baseDebit), 0)).toBe(64);
    expect(cogsJournal?.lines.reduce((sum, line) => sum + Number(line.baseCredit), 0)).toBe(64);

    const replay = await saleRequest(fixture, clientRequestId);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      idempotentReplay: true,
      data: { sale: { id: sale.id } }
    });
    expect(await prisma.sale.count({ where: { clientRequestId } })).toBe(1);

    const cancellation = await salesRoute.request(
      `http://localhost/${sale.id}/cancel`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Atomic integration cancellation" })
      }
    );
    expect(cancellation.status).toBe(200);

    const [cancelledSale, restoredLots, restoredCash, cancellationJournals] =
      await Promise.all([
        prisma.sale.findUniqueOrThrow({ where: { id: sale.id } }),
        prisma.stockLot.findMany({
          where: { id: { in: fixture.lotIds } },
          orderBy: { unitCost: "asc" }
        }),
        prisma.cashRegisterAccount.findUniqueOrThrow({
          where: { id: fixture.cashAccountId }
        }),
        prisma.journalEntry.findMany({
          where: {
            sourceId: sale.id,
            sourceType: { in: ["SALE_CANCEL", "POS_SALE_COGS_CANCEL"] }
          },
          include: { lines: true }
        })
      ]);

    expect(cancelledSale.status).toBe("CANCELLED");
    expect(restoredLots.map((lot) => Number(lot.remainingQuantity))).toEqual([4, 5]);
    expect(Number(restoredCash.balance)).toBe(0);
    expect(cancellationJournals.map((journal) => journal.sourceType).sort()).toEqual([
      "POS_SALE_COGS_CANCEL",
      "SALE_CANCEL"
    ]);

    const cogsReversal = cancellationJournals.find(
      (journal) => journal.sourceType === "POS_SALE_COGS_CANCEL"
    );
    expect(cogsReversal?.lines.reduce((sum, line) => sum + Number(line.baseDebit), 0)).toBe(64);
    expect(cogsReversal?.lines.reduce((sum, line) => sum + Number(line.baseCredit), 0)).toBe(64);
  });

  it("rolls back stock and cash if COGS posting fails inside the transaction", async () => {
    const fixture = await createFixture("rollback");
    const clientRequestId = `atomic-${Date.now()}-rollback`;
    fixture.clientRequestIds.push(clientRequestId);

    await prisma.accountingAccount.update({
      where: { code: "5000" },
      data: { isActive: false }
    });

    try {
      const response = await saleRequest(fixture, clientRequestId);
      expect(response.status).toBeGreaterThanOrEqual(400);
    } finally {
      await prisma.accountingAccount.update({
        where: { code: "5000" },
        data: { isActive: true }
      });
    }

    const [saleCount, lots, movementCount, cashAccount] = await Promise.all([
      prisma.sale.count({ where: { clientRequestId } }),
      prisma.stockLot.findMany({
        where: { id: { in: fixture.lotIds } },
        orderBy: { unitCost: "asc" }
      }),
      prisma.stockMovement.count({
        where: { productId: fixture.productId, referenceType: "SALE" }
      }),
      prisma.cashRegisterAccount.findUniqueOrThrow({ where: { id: fixture.cashAccountId } })
    ]);

    expect(saleCount).toBe(0);
    expect(lots.map((lot) => Number(lot.remainingQuantity))).toEqual([4, 5]);
    expect(movementCount).toBe(0);
    expect(Number(cashAccount.balance)).toBe(0);
  });

  it("posts a partial cash sale and customer receivable in one transaction", async () => {
    const fixture = await createFixture("credit");
    const clientRequestId = `atomic-${Date.now()}-credit`;
    fixture.clientRequestIds.push(clientRequestId);
    const customer = await prisma.party.create({
      data: {
        type: "CUSTOMER",
        name: `Atomic customer ${Date.now()}`,
        code: `AC-${Date.now()}`
      }
    });
    fixture.partyIds.push(customer.id);

    const response = await saleRequest(fixture, clientRequestId, {
      customerId: customer.id,
      paidAmount: 20
    });
    expect(response.status).toBe(201);
    const payload = await response.json() as any;
    const saleId = payload.data.sale.id as string;

    const [sale, partyAccount, partyTransactions, saleJournal, cashAccount] =
      await Promise.all([
        prisma.sale.findUniqueOrThrow({ where: { id: saleId } }),
        prisma.partyAccount.findUniqueOrThrow({
          where: {
            partyId_currencyId: {
              partyId: customer.id,
              currencyId: baseCurrencyId
            }
          }
        }),
        prisma.partyTransaction.findMany({
          where: { referenceType: "SALE", referenceId: saleId }
        }),
        prisma.journalEntry.findUniqueOrThrow({
          where: {
            sourceType_sourceId: { sourceType: "POS_SALE", sourceId: saleId }
          },
          include: { lines: { include: { account: true } } }
        }),
        prisma.cashRegisterAccount.findUniqueOrThrow({
          where: { id: fixture.cashAccountId }
        })
      ]);

    expect(sale.paymentStatus).toBe("PARTIAL");
    expect(Number(sale.paidAmount)).toBe(20);
    expect(Number(sale.remainingAmount)).toBe(100);
    expect(Number(cashAccount.balance)).toBe(20);
    expect(Number(partyAccount.debitBalance)).toBe(100);
    expect(partyTransactions).toHaveLength(1);
    expect(
      saleJournal.lines
        .filter((line) => line.account.code === "1200")
        .reduce((sum, line) => sum + Number(line.debit), 0)
    ).toBe(100);
    expect(saleJournal.lines.reduce((sum, line) => sum + Number(line.baseDebit), 0)).toBe(120);
    expect(saleJournal.lines.reduce((sum, line) => sum + Number(line.baseCredit), 0)).toBe(120);

    const receiptTokenResponse = await posReceiptsRoute.request(
      `http://localhost/sales/${saleId}/token`,
      { method: "POST" },
    );
    expect(receiptTokenResponse.status).toBe(200);
    const receiptToken = (await receiptTokenResponse.json()) as any;
    const receiptResponse = await posReceiptsRoute.request(
      `http://localhost/sales/${saleId}/html?accessToken=${encodeURIComponent(receiptToken.data.token)}&width=80`,
    );
    expect(receiptResponse.status).toBe(200);
    const receiptHtml = await receiptResponse.text();
    expect(receiptHtml).toContain("مبلغ قرض مشتری:");
    expect(receiptHtml).toContain("100 AFN");
  });

  it("snapshots a foreign-currency rate across split cash and bank payment", async () => {
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const currency = await prisma.currency.create({
      data: {
        code: `T${suffix}`,
        name: `Test currency ${suffix}`,
        isBase: false,
        isActive: true
      }
    });
    const rate = await prisma.currencyRate.create({
      data: {
        currencyId: currency.id,
        rateToBase: 70,
        effectiveAt: new Date(Date.now() - 60_000)
      }
    });
    const fixture = await createFixture("multicurrency", currency.id);
    fixture.currencyIds.push(currency.id);
    fixture.currencyRateIds.push(rate.id);
    const bankAccount = await prisma.bankAccount.create({
      data: {
        name: `Atomic bank ${suffix}`,
        currencyId: currency.id,
        balance: 0,
        isActive: true
      }
    });
    fixture.bankAccountIds.push(bankAccount.id);
    const clientRequestId = `atomic-${Date.now()}-multicurrency`;
    fixture.clientRequestIds.push(clientRequestId);

    const response = await saleRequest(fixture, clientRequestId, {
      paidAmount: 120,
      paymentLines: [
        {
          paymentAccountType: "CASH",
          paymentAccountId: fixture.cashAccountId,
          amount: 50
        },
        {
          paymentAccountType: "BANK",
          paymentAccountId: bankAccount.id,
          amount: 70
        }
      ]
    });
    expect(response.status).toBe(201);
    const payload = await response.json() as any;
    const saleId = payload.data.sale.id as string;

    const [sale, transactions, saleJournal, cogsJournal, cash, bank] =
      await Promise.all([
        prisma.sale.findUniqueOrThrow({ where: { id: saleId } }),
        prisma.moneyTransaction.findMany({
          where: { referenceType: "SALE", referenceId: saleId },
          orderBy: { amount: "asc" }
        }),
        prisma.journalEntry.findUniqueOrThrow({
          where: {
            sourceType_sourceId: { sourceType: "POS_SALE", sourceId: saleId }
          },
          include: { lines: true }
        }),
        prisma.journalEntry.findUniqueOrThrow({
          where: {
            sourceType_sourceId: {
              sourceType: "POS_SALE_COGS",
              sourceId: saleId
            }
          },
          include: { lines: true }
        }),
        prisma.cashRegisterAccount.findUniqueOrThrow({
          where: { id: fixture.cashAccountId }
        }),
        prisma.bankAccount.findUniqueOrThrow({ where: { id: bankAccount.id } })
      ]);

    expect(Number(sale.exchangeRate)).toBe(70);
    expect(Number(sale.baseTotal)).toBe(8400);
    expect(transactions.map((item) => Number(item.amount))).toEqual([50, 70]);
    expect(transactions.map((item) => Number(item.baseAmount))).toEqual([3500, 4900]);
    expect(Number(cash.balance)).toBe(50);
    expect(Number(bank.balance)).toBe(70);
    expect(saleJournal.lines.reduce((sum, line) => sum + Number(line.baseDebit), 0)).toBe(8400);
    expect(saleJournal.lines.reduce((sum, line) => sum + Number(line.baseCredit), 0)).toBe(8400);
    expect(cogsJournal.lines.reduce((sum, line) => sum + Number(line.baseDebit), 0)).toBe(64);
    expect(cogsJournal.lines.reduce((sum, line) => sum + Number(line.baseCredit), 0)).toBe(64);
  });

  it("allocates item and document discounts exactly across lots and refunds the same net total", async () => {
    const fixture = await createFixture("net-return");
    const clientRequestId = `atomic-${Date.now()}-net-return`;
    fixture.clientRequestIds.push(clientRequestId);

    const created = await saleRequest(fixture, clientRequestId, {
      paidAmount: 101,
      itemDiscount: 12,
      discount: 7
    });
    expect(created.status).toBe(201);
    const createdPayload = await created.json() as any;
    const saleId = createdPayload.data.sale.id as string;
    const sale = await prisma.sale.findUniqueOrThrow({
      where: { id: saleId },
      include: { items: { orderBy: { quantity: "desc" } } }
    });

    expect(Number(sale.subtotal)).toBe(108);
    expect(Number(sale.discount)).toBe(7);
    expect(Number(sale.total)).toBe(101);
    expect(
      sale.items.reduce((sum, item) => sum + Number(item.discount), 0)
    ).toBe(12);
    expect(
      sale.items.reduce(
        (sum, item) => sum + Number(item.documentDiscountAllocated),
        0
      )
    ).toBe(7);
    expect(
      sale.items.reduce((sum, item) => sum + Number(item.netTotalPrice), 0)
    ).toBe(101);

    await Promise.all([
      cacheDeleteByPattern("dashboard:summary:*"),
      cacheDeleteByPattern("reports:management:*")
    ]);
    const receiptTokenResponse = await posReceiptsRoute.request(
      `http://localhost/sales/${saleId}/token`,
      { method: "POST" }
    );
    expect(receiptTokenResponse.status).toBe(200);
    const receiptTokenPayload = await receiptTokenResponse.json() as any;
    const [dashboardResponse, managementResponse, receiptResponse] = await Promise.all([
      dashboardRoute.request("http://localhost/summary?period=today"),
      reportsRoute.request("http://localhost/management"),
      posReceiptsRoute.request(
        `http://localhost/sales/${saleId}/html?accessToken=${encodeURIComponent(receiptTokenPayload.data.token)}&width=80`
      )
    ]);
    expect(dashboardResponse.status).toBe(200);
    expect(managementResponse.status).toBe(200);
    expect(receiptResponse.status).toBe(200);
    const dashboardPayload = await dashboardResponse.json() as any;
    const managementPayload = await managementResponse.json() as any;
    const receiptHtml = await receiptResponse.text();
    expect(
      dashboardPayload.data.topProducts.find(
        (item: any) => item.id === fixture.productId
      )?.sales
    ).toBe(101);
    expect(
      managementPayload.data.topProducts.find(
        (item: any) => item.id === fixture.productId
      )?.totalSales
    ).toBe(101);
    expect(receiptHtml).toContain("<td>101</td>");
    expect(receiptHtml).toContain("<strong>19 AFN</strong>");

    const returned = await adminReturnsApp.request("http://localhost/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        saleId,
        refundAccountType: "CASH",
        refundAccountId: fixture.cashAccountId,
        refundAmount: 101,
        note: "Full discounted integration return",
        items: sale.items.map((item) => ({
          saleItemId: item.id,
          quantity: Number(item.quantity)
        }))
      })
    });
    expect(returned.status).toBe(201);
    const returnedPayload = await returned.json() as any;
    const saleReturnId = returnedPayload.data.saleReturn.id as string;

    const [saleReturn, cash, lots, journal] = await Promise.all([
      prisma.saleReturn.findUniqueOrThrow({
        where: { id: saleReturnId },
        include: { items: true }
      }),
      prisma.cashRegisterAccount.findUniqueOrThrow({
        where: { id: fixture.cashAccountId }
      }),
      prisma.stockLot.findMany({
        where: { id: { in: fixture.lotIds } },
        orderBy: { unitCost: "asc" }
      }),
      prisma.journalEntry.findUniqueOrThrow({
        where: {
          sourceType_sourceId: {
            sourceType: "SALE_RETURN",
            sourceId: saleReturnId
          }
        },
        include: { lines: true }
      })
    ]);

    expect(Number(saleReturn.subtotal)).toBe(101);
    expect(Number(saleReturn.refundAmount)).toBe(101);
    expect(
      saleReturn.items.reduce((sum, item) => sum + Number(item.totalPrice), 0)
    ).toBe(101);
    expect(Number(cash.balance)).toBe(0);
    expect(lots.map((lot) => Number(lot.remainingQuantity))).toEqual([4, 5]);
    expect(journal.lines.reduce((sum, line) => sum + Number(line.baseDebit), 0)).toBe(165);
    expect(journal.lines.reduce((sum, line) => sum + Number(line.baseCredit), 0)).toBe(165);
    await Promise.all([
      cacheDeleteByPattern("dashboard:summary:*"),
      cacheDeleteByPattern("reports:management:*")
    ]);
  });

  it("computes legacy returns in memory, preserves rounding, and reports only suspicious old amounts", async () => {
    const fixture = await createFixture("legacy-return");
    const clientRequestId = `atomic-${Date.now()}-legacy-return`;
    fixture.clientRequestIds.push(clientRequestId);
    const customer = await prisma.party.create({
      data: {
        type: "CUSTOMER",
        name: `Legacy return customer ${Date.now()}`,
        code: `LRC-${Date.now()}`
      }
    });
    fixture.partyIds.push(customer.id);

    const created = await saleRequest(fixture, clientRequestId, {
      customerId: customer.id,
      paidAmount: 0,
      discount: 10
    });
    expect(created.status).toBe(201);
    const createdPayload = await created.json() as any;
    const saleId = createdPayload.data.sale.id as string;

    await prisma.saleItem.updateMany({
      where: { saleId },
      data: {
        documentDiscountAllocated: null,
        netTotalPrice: null
      }
    });

    const detailResponse = await salesRoute.request(`http://localhost/${saleId}`);
    expect(detailResponse.status).toBe(200);
    const detail = (await detailResponse.json() as any).data;
    const targetItem = [...detail.items].sort(
      (left: any, right: any) => Number(right.quantity) - Number(left.quantity)
    )[0];
    const effectiveLineNet = Number(targetItem.effectiveNetTotalPrice);

    const firstReturn = await adminReturnsApp.request("http://localhost/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        saleId,
        refundAmount: 0,
        items: [{ saleItemId: targetItem.id, quantity: 1 }]
      })
    });
    expect(firstReturn.status).toBe(201);
    const firstPayload = await firstReturn.json() as any;

    const secondReturn = await adminReturnsApp.request("http://localhost/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        saleId,
        refundAmount: 0,
        items: [
          {
            saleItemId: targetItem.id,
            quantity: Number(targetItem.quantity) - 1
          }
        ]
      })
    });
    expect(secondReturn.status).toBe(201);
    const secondPayload = await secondReturn.json() as any;

    const [legacyItem, returnRows, partyAccount] = await Promise.all([
      prisma.saleItem.findUniqueOrThrow({ where: { id: targetItem.id } }),
      prisma.saleReturn.findMany({
        where: {
          id: {
            in: [
              firstPayload.data.saleReturn.id,
              secondPayload.data.saleReturn.id
            ]
          }
        },
        include: { items: true }
      }),
      prisma.partyAccount.findUniqueOrThrow({
        where: {
          partyId_currencyId: {
            partyId: customer.id,
            currencyId: baseCurrencyId
          }
        }
      })
    ]);

    expect(legacyItem.netTotalPrice).toBeNull();
    expect(legacyItem.documentDiscountAllocated).toBeNull();
    expect(
      Number(
        returnRows
          .reduce((sum, row) => sum + Number(row.subtotal), 0)
          .toFixed(4)
      )
    ).toBe(effectiveLineNet);
    expect(Number(partyAccount.creditBalance)).toBe(effectiveLineNet);

    const cleanQuality = await adminReturnsApp.request(
      "http://localhost/quality?page=1&limit=100"
    );
    expect(cleanQuality.status).toBe(200);
    const cleanQualityPayload = await cleanQuality.json() as any;
    expect(
      cleanQualityPayload.data.some(
        (row: any) => row.saleId === saleId
      )
    ).toBe(false);

    const firstReturnItem = returnRows.find(
      (row) => row.id === firstPayload.data.saleReturn.id
    )!.items[0]!;
    const suspiciousAmount = Number(
      (
        Number(targetItem.totalPrice) /
        Number(targetItem.quantity)
      ).toFixed(4)
    );
    await prisma.saleReturnItem.update({
      where: { id: firstReturnItem.id },
      data: { totalPrice: suspiciousAmount }
    });

    const suspiciousQuality = await adminReturnsApp.request(
      "http://localhost/quality?page=1&limit=100"
    );
    expect(suspiciousQuality.status).toBe(200);
    const suspiciousPayload = await suspiciousQuality.json() as any;
    expect(suspiciousPayload.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          saleId,
          returnItemId: firstReturnItem.id
        })
      ])
    );
    expect(suspiciousPayload.remediation).toBe("REVIEW_AND_CANCEL_RECREATE");
  });

  it("reports and repairs one historical sale without COGS only after Admin confirmation", async () => {
    const fixture = await createFixture("repair");
    const clientRequestId = `atomic-${Date.now()}-repair`;
    fixture.clientRequestIds.push(clientRequestId);

    const createdResponse = await saleRequest(fixture, clientRequestId);
    expect(createdResponse.status).toBe(201);
    const createdPayload = await createdResponse.json() as any;
    const saleId = createdPayload.data.sale.id as string;

    await prisma.journalEntry.delete({
      where: {
        sourceType_sourceId: {
          sourceType: "POS_SALE_COGS",
          sourceId: saleId
        }
      }
    });

    const qualityResponse = await salesRoute.request(
      "http://localhost/cogs-quality?page=1&limit=100"
    );
    expect(qualityResponse.status).toBe(200);
    const qualityPayload = await qualityResponse.json() as any;
    expect(qualityPayload.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: saleId, cogsTotal: 64 })
      ])
    );

    const denied = await salesRoute.request(
      `http://localhost/${saleId}/repair-cogs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true })
      }
    );
    expect(denied.status).toBe(403);

    const repaired = await adminSalesApp.request(
      `http://localhost/${saleId}/repair-cogs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true })
      }
    );
    expect(repaired.status).toBe(201);
    expect(await repaired.json()).toMatchObject({
      cogs: { total: 64 },
      idempotentReplay: false,
      zeroCost: false
    });

    const replay = await adminSalesApp.request(
      `http://localhost/${saleId}/repair-cogs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true })
      }
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ idempotentReplay: true });
    expect(
      await prisma.journalEntry.count({
        where: { sourceType: "POS_SALE_COGS", sourceId: saleId }
      })
    ).toBe(1);
  });
});
