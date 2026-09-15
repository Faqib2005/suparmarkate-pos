import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  clearPosCart,
  createPosSession,
  getPosCart,
  handlePosBarcodeScan,
  revalidatePosCart,
  updatePosCartItem,
  updatePosSessionSettings,
} from "../../lib/pos-realtime";
import { prisma } from "../../lib/prisma";
import { productsRoute } from "./routes";

const databaseUrl = process.env.DATABASE_URL || "";

if (!/[/_]supermarket_test(?:\?|$)/.test(databaseUrl)) {
  throw new Error("Product lookup integration tests require the isolated supermarket_test database.");
}

let unitId = "";
let warehouseId = "";
let currencyId = "";
const productIds: string[] = [];
const testUnitIds: string[] = [];

function toPersianDigits(value: string) {
  return value.replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]!);
}

beforeAll(async () => {
  const unit = await prisma.unit.findFirst({
    where: { deletedAt: null, isActive: true },
  });
  const warehouse = await prisma.warehouse.findFirst({
    where: { deletedAt: null, isActive: true },
  });
  const currency = await prisma.currency.findFirst({
    where: { deletedAt: null, isBase: true },
  });

  if (!unit || !warehouse || !currency) {
    throw new Error("Seeded unit, warehouse and base currency are required for product lookup tests.");
  }

  unitId = unit.id;
  warehouseId = warehouse.id;
  currencyId = currency.id;
});

afterAll(async () => {
  await prisma.stockBalance.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.stockLot.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.unit.deleteMany({ where: { id: { in: testUnitIds } } });
  await prisma.$disconnect();
});

describe("normalized product barcode lookup", () => {
  it("keeps one POS row per product and warehouse while aggregating every positive lot", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const barcode = `POS-CART-${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const cartonUnit = await prisma.unit.create({
      data: {
        name: `POS carton ${suffix}`,
        shortName: "کارتن",
      },
    });
    testUnitIds.push(cartonUnit.id);
    const product = await prisma.product.create({
      data: {
        name: `POS multi-lot ${suffix}`,
        sku: `POS-MULTI-LOT-${suffix}`,
        barcode,
        barcodeNormalized: barcode,
        baseUnitId: unitId,
        defaultWarehouseId: warehouseId,
        units: {
          create: [
            {
              unitId,
              conversionRate: 1,
              purchasePrice: 10,
              salePrice: 20,
              isDefaultPurchase: true,
              isDefaultSale: true,
            },
            {
              unitId: cartonUnit.id,
              conversionRate: 10,
              purchasePrice: 100,
              salePrice: 200,
            },
          ],
        },
      },
    });
    productIds.push(product.id);

    await Promise.all(
      [5, 10, 20].map((quantity, index) =>
        prisma.stockLot.create({
          data: {
            productId: product.id,
            warehouseId,
            initialQuantity: quantity,
            remainingQuantity: quantity,
            unitCost: 10 + index,
            currencyId,
            exchangeRate: 1,
            baseUnitCost: 10 + index,
            sourceType: "POS_CART_MULTI_LOT_TEST",
            createdAt: new Date(Date.now() - (3 - index) * 1_000),
          },
        }),
      ),
    );

    const session = createPosSession("POS multi-lot cart integration test");
    updatePosSessionSettings({ sessionId: session.id, warehouseId });

    expect((await handlePosBarcodeScan({ sessionId: session.id, barcode, source: "http" })).ok).toBe(true);
    expect((await handlePosBarcodeScan({ sessionId: session.id, barcode, source: "http" })).ok).toBe(true);

    let cart = getPosCart(session.id);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toMatchObject({
      key: `${product.id}:${warehouseId}`,
      quantity: 2,
      quantityBase: 2,
      availableBaseQuantity: 35,
      lotCount: 3,
    });

    updatePosCartItem({
      sessionId: session.id,
      key: cart.items[0]!.key,
      unitId: cartonUnit.id,
    });
    cart = getPosCart(session.id);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toMatchObject({
      key: `${product.id}:${warehouseId}`,
      unitId: cartonUnit.id,
      quantity: 2,
      quantityBase: 20,
      unitPrice: 200,
    });

    expect((await handlePosBarcodeScan({ sessionId: session.id, barcode, source: "http" })).ok).toBe(true);
    cart = getPosCart(session.id);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toMatchObject({
      unitId: cartonUnit.id,
      quantity: 3,
      quantityBase: 30,
    });

    updatePosCartItem({ sessionId: session.id, key: cart.items[0]!.key, unitId });
    cart = getPosCart(session.id);
    expect(cart.items[0]).toMatchObject({ unitId, quantity: 3, quantityBase: 3 });

    updatePosCartItem({ sessionId: session.id, key: cart.items[0]!.key, quantity: 18 });
    const revalidated = await revalidatePosCart(session.id);
    cart = getPosCart(session.id);
    expect(revalidated.issues).toEqual([]);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toMatchObject({ quantity: 18, quantityBase: 18, availableBaseQuantity: 35 });
    expect(cart.revision).toBeGreaterThan(0);

    expect(() =>
      updatePosSessionSettings({ sessionId: session.id, warehouseId: null }),
    ).toThrow("تغییر گدام");
    clearPosCart(session.id);

    const productWithoutBarcode = await prisma.product.create({
      data: {
        name: `POS direct product ${suffix}`,
        sku: `POS-DIRECT-${suffix}`,
        baseUnitId: unitId,
        defaultWarehouseId: warehouseId,
        units: {
          create: {
            unitId,
            conversionRate: 1,
            purchasePrice: 10,
            salePrice: 20,
            isDefaultPurchase: true,
            isDefaultSale: true,
          },
        },
      },
    });
    productIds.push(productWithoutBarcode.id);
    await prisma.stockLot.create({
      data: {
        productId: productWithoutBarcode.id,
        warehouseId,
        initialQuantity: 1,
        remainingQuantity: 1,
        unitCost: 10,
        currencyId,
        exchangeRate: 1,
        baseUnitCost: 10,
        sourceType: "POS_CARD_WITHOUT_BARCODE_TEST",
      },
    });

    const directAdd = await handlePosBarcodeScan({
      sessionId: session.id,
      barcode: "",
      productId: productWithoutBarcode.id,
      warehouseId,
      source: "http",
    });
    expect(directAdd).toMatchObject({ ok: true, data: { product: { id: productWithoutBarcode.id } } });
    expect(getPosCart(session.id).items).toHaveLength(1);
    clearPosCart(session.id);
  });

  it("finds legacy variants, reports ambiguity, and only adds an explicitly selected product", async () => {
    const digits = `97${Date.now().toString().slice(-9)}${Math.floor(Math.random() * 10)}`;
    const firstRawBarcode = `${digits.slice(0, 6)}-${digits.slice(6)}`;
    const secondRawBarcode = toPersianDigits(`${digits.slice(0, 4)} ${digits.slice(4)}`);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const first = await prisma.product.create({
      data: {
        name: `Legacy barcode first ${suffix}`,
        sku: `LEGACY-BARCODE-A-${suffix}`,
        barcode: firstRawBarcode,
        barcodeNormalized: null,
        baseUnitId: unitId,
        defaultWarehouseId: warehouseId,
        units: {
          create: {
            unitId,
            conversionRate: 1,
            purchasePrice: 5,
            salePrice: 10,
            isDefaultPurchase: true,
            isDefaultSale: true,
          },
        },
      },
    });
    const second = await prisma.product.create({
      data: {
        name: `Legacy barcode second ${suffix}`,
        sku: `LEGACY-BARCODE-B-${suffix}`,
        barcode: secondRawBarcode,
        barcodeNormalized: null,
        baseUnitId: unitId,
        defaultWarehouseId: warehouseId,
        units: {
          create: {
            unitId,
            conversionRate: 1,
            purchasePrice: 6,
            salePrice: 12,
            isDefaultPurchase: true,
            isDefaultSale: true,
          },
        },
      },
    });
    productIds.push(first.id, second.id);

    await prisma.stockLot.create({
      data: {
        productId: first.id,
        warehouseId,
        initialQuantity: 8,
        remainingQuantity: 8,
        unitCost: 5,
        currencyId,
        exchangeRate: 1,
        baseUnitCost: 5,
        sourceType: "BARCODE_LOOKUP_TEST",
      },
    });
    await prisma.stockLot.create({
      data: {
        productId: second.id,
        warehouseId,
        initialQuantity: 3,
        remainingQuantity: 3,
        unitCost: 6,
        currencyId,
        exchangeRate: 1,
        baseUnitCost: 6,
        sourceType: "BARCODE_LOOKUP_TEST",
      },
    });

    const lookupResponse = await productsRoute.request(
      `http://localhost/barcode-lookup?barcode=${encodeURIComponent(toPersianDigits(firstRawBarcode))}&warehouseId=${warehouseId}`,
    );
    expect(lookupResponse.status).toBe(200);
    const lookup = (await lookupResponse.json()) as any;
    expect(lookup.status).toBe("AMBIGUOUS");
    expect(lookup.data).toBeNull();
    expect(new Set(lookup.candidates.map((item: any) => item.id))).toEqual(
      new Set([first.id, second.id]),
    );

    const session = createPosSession("Barcode ambiguity integration test");
    const ambiguousScan = await handlePosBarcodeScan({
      sessionId: session.id,
      barcode: digits,
      warehouseId,
      source: "http",
    });
    expect(ambiguousScan).toMatchObject({
      ok: false,
      statusCode: 409,
      error: { code: "BARCODE_AMBIGUOUS", status: "AMBIGUOUS" },
    });
    expect(getPosCart(session.id).items).toHaveLength(0);

    const selectedScan = await handlePosBarcodeScan({
      sessionId: session.id,
      barcode: firstRawBarcode,
      productId: first.id,
      warehouseId,
      source: "http",
    });
    expect(selectedScan).toMatchObject({
      ok: true,
      data: { product: { id: first.id } },
    });
    expect(getPosCart(session.id).items).toHaveLength(1);
    expect(getPosCart(session.id).items[0]?.productId).toBe(first.id);
    clearPosCart(session.id);
  });

  const scaleIt = process.env.RUN_PRODUCT_SEARCH_SCALE_TESTS === "1" ? it : it.skip;

  scaleIt("meets exact barcode and first-page targets with at least 5,500 products", async () => {
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const skuPrefix = `SCALE-${suffix}-`;
    const barcodePrefix = `88${suffix.slice(-8)}`;
    const rows = Array.from({ length: 5_500 }, (_, index) => {
      const barcode = `${barcodePrefix}${String(index).padStart(5, "0")}`;
      return {
        name: `Scale product ${suffix} ${index}`,
        sku: `${skuPrefix}${index}`,
        barcode,
        barcodeNormalized: barcode,
        baseUnitId: unitId,
        defaultWarehouseId: warehouseId,
      };
    });

    await prisma.product.createMany({ data: rows });
    const targetBarcode = rows.at(-1)!.barcode;

    try {
      await productsRoute.request(
        `http://localhost/barcode-lookup?barcode=${targetBarcode}`,
      );
      const exactDurations: number[] = [];
      for (let index = 0; index < 20; index += 1) {
        const startedAt = performance.now();
        const response = await productsRoute.request(
          `http://localhost/barcode-lookup?barcode=${targetBarcode}`,
        );
        expect(response.status).toBe(200);
        expect((await response.json() as any).status).toBe("FOUND");
        exactDurations.push(performance.now() - startedAt);
      }

      exactDurations.sort((left, right) => left - right);
      const p95 = exactDurations[Math.ceil(exactDurations.length * 0.95) - 1]!;
      expect(p95).toBeLessThan(300);

      const firstPageStartedAt = performance.now();
      const firstPageResponse = await productsRoute.request("http://localhost/?page=1&limit=20");
      expect(firstPageResponse.status).toBe(200);
      expect(performance.now() - firstPageStartedAt).toBeLessThan(700);
    } finally {
      await prisma.product.deleteMany({ where: { sku: { startsWith: skuPrefix } } });
    }
  }, 60_000);
});
