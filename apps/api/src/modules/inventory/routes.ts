import { Hono } from "hono";
import { z } from "zod";
import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import { getAuthUser, hasPermission, writeAudit } from "../../lib/auth";
import { resolveCurrencySnapshot, roundMoney } from "../../lib/currency-rates";
import { StockMovementType } from "../../generated/prisma/enums";
import { createPaginationMeta, getPagePagination } from "../../lib/pagination";
import { getRecentDateRange } from "../../lib/recent-date-range";
import { normalizeBarcodeText } from "../../lib/barcode";
import { findProductIdsByBarcode } from "../../lib/product-barcode-lookup";
import { acquireTransactionLock } from "../../lib/db-lock";
import { roundStockQuantity, stockDecimal } from "../../lib/stock-quantity";
import {
  InventoryMutationService,
  requestOperationId
} from "../../lib/inventory-mutation";
import { inventoryOperationEvidence } from "../../lib/request-evidence";
import { createPostedJournal, createReversalJournal } from "../../lib/journal";
import {
  kabulDateKey,
  kabulDateRange,
  kabulNow,
  parseKabulDateInput
} from "../../lib/kabul-date";

export const inventoryRoute = new Hono();

const openingStockSchema = z.object({
  productId: z.string().min(1),
  warehouseId: z.string().min(1),
  unitId: z.string().trim().optional().nullable(),
  quantity: z.coerce.number().positive(),
  unitCost: z.coerce.number().nonnegative(),
  currencyId: z.string().optional().nullable(),
  expiryDate: z.string().trim().optional().nullable(),
  note: z.string().trim().max(500).optional().nullable()
});

function inventoryRequestId(c: Parameters<typeof getAuthUser>[0], prefix: string) {
  return requestOperationId(
    c.req.header("Idempotency-Key") || c.req.header("x-idempotency-key"),
    prefix
  );
}

const adjustmentSchema = z.object({
  productId: z.string().min(1),
  warehouseId: z.string().min(1),
  lotId: z.string().trim().optional().nullable(),
  unitId: z.string().trim().optional().nullable(),
  type: z.enum(["ADJUSTMENT_IN", "ADJUSTMENT_OUT", "DAMAGE"]),
  quantity: z.coerce.number().positive(),
  unitCost: z.coerce.number().nonnegative().optional().nullable(),
  currencyId: z.string().optional().nullable(),
  expiryDate: z.string().trim().optional().nullable(),
  note: z.string().trim().max(500).optional().nullable()
});

const transferSchema = z.object({
  productId: z.string().min(1),
  fromWarehouseId: z.string().min(1),
  toWarehouseId: z.string().min(1),
  lotId: z.string().trim().optional().nullable(),
  unitId: z.string().trim().optional().nullable(),
  quantity: z.coerce.number().positive(),
  note: z.string().trim().max(500).optional().nullable()
});

const cancelMovementSchema = z.object({
  reason: z.string().trim().max(500).optional().nullable()
});

const updateOpeningStockSchema = z.object({
  quantity: z.coerce.number().positive(),
  unitCost: z.coerce.number().nonnegative(),
  currencyId: z.string().optional().nullable(),
  expiryDate: z.string().trim().optional().nullable(),
  note: z.string().trim().max(500).optional().nullable()
});

const inboundMovementTypes = [
  StockMovementType.OPENING_STOCK,
  StockMovementType.PURCHASE,
  StockMovementType.SALE_RETURN,
  StockMovementType.ADJUSTMENT_IN,
  StockMovementType.TRANSFER_IN
] as const;

const outboundMovementTypes = [
  StockMovementType.SALE,
  StockMovementType.PURCHASE_RETURN,
  StockMovementType.ADJUSTMENT_OUT,
  StockMovementType.DAMAGE,
  StockMovementType.TRANSFER_OUT
] as const;

function movementDirection(type: StockMovementType) {
  if (inboundMovementTypes.includes(type as (typeof inboundMovementTypes)[number])) {
    return "IN" as const;
  }

  if (outboundMovementTypes.includes(type as (typeof outboundMovementTypes)[number])) {
    return "OUT" as const;
  }

  throw new Error(`Unsupported stock movement type: ${type}`);
}

function movementNetTotal(
  rows: Array<{ type: StockMovementType; _sum: { quantity: unknown } }>
) {
  return rows.reduce((total, row) => {
    const quantity = Number(row._sum.quantity || 0);
    return total + (movementDirection(row.type) === "IN" ? quantity : -quantity);
  }, 0);
}

function parseExpiryDate(value: string | null | undefined) {
  if (!value) return null;
  const date = parseKabulDateInput(value);
  return !date || date === "INVALID_DATE" ? "INVALID_DATE" : date;
}

async function ensureProductAndWarehouse(productId: string, warehouseId: string) {
  const [product, warehouse] = await Promise.all([
    prisma.product.findUnique({
      where: { id: productId },
      include: { units: true, baseUnit: true }
    }),
    prisma.warehouse.findUnique({ where: { id: warehouseId } })
  ]);

  return {
    product,
    warehouse
  };
}

function resolveProductUnitConversion(
  product: NonNullable<Awaited<ReturnType<typeof ensureProductAndWarehouse>>["product"]>,
  unitId: string | null | undefined
) {
  const selectedUnitId = unitId || product.baseUnitId;
  const productUnit = product.units.find((item) => item.unitId === selectedUnitId);

  if (selectedUnitId === product.baseUnitId) {
    return {
      unitId: selectedUnitId,
      conversionRate: 1,
      unitName: product.baseUnit?.shortName || product.baseUnit?.name || "base"
    };
  }

  if (!productUnit) {
    throw new Error("Selected unit is not configured for this product");
  }

  return {
    unitId: selectedUnitId,
    conversionRate: Number(productUnit.conversionRate || 1),
    unitName: product.baseUnit?.shortName || product.baseUnit?.name || "base"
  };
}

function buildStockMovementSearchWhere(
  search: string | null | undefined,
  exactProductIds: string[] = [],
) {
  const rawSearch = (search || "").trim();
  const barcodeSearch = normalizeBarcodeText(rawSearch);

  if (!rawSearch) return {};

  return {
    OR: [
      ...(exactProductIds.length ? [{ productId: { in: exactProductIds } }] : []),
      { referenceId: { contains: rawSearch, mode: "insensitive" as const } },
      { referenceType: { contains: rawSearch, mode: "insensitive" as const } },
      { note: { contains: rawSearch, mode: "insensitive" as const } },
      { product: { name: { contains: rawSearch, mode: "insensitive" as const } } },
      { product: { sku: { contains: rawSearch, mode: "insensitive" as const } } },
      { product: { barcode: rawSearch } },
      { product: { barcode: { contains: rawSearch, mode: "insensitive" as const } } },
      { warehouse: { name: { contains: rawSearch, mode: "insensitive" as const } } },
      { lot: { id: { contains: rawSearch, mode: "insensitive" as const } } },
      ...(barcodeSearch
        ? [
            { product: { barcode: barcodeSearch } },
            { product: { barcodeNormalized: barcodeSearch } },
            { product: { barcode: { contains: barcodeSearch, mode: "insensitive" as const } } },
            { product: { barcodeNormalized: { contains: barcodeSearch, mode: "insensitive" as const } } },
            { product: { sku: { contains: barcodeSearch, mode: "insensitive" as const } } }
          ]
        : [])
    ]
  };
}

function buildStockBalanceSearchWhere(
  search: string | null | undefined,
  exactProductIds: string[] = [],
) {
  const rawSearch = (search || "").trim();
  const barcodeSearch = normalizeBarcodeText(rawSearch);

  if (!rawSearch) return {};

  return {
    OR: [
      ...(exactProductIds.length ? [{ productId: { in: exactProductIds } }] : []),
      { product: { name: { contains: rawSearch, mode: "insensitive" as const } } },
      { product: { sku: { contains: rawSearch, mode: "insensitive" as const } } },
      { product: { barcode: rawSearch } },
      { product: { barcode: { contains: rawSearch, mode: "insensitive" as const } } },
      { warehouse: { name: { contains: rawSearch, mode: "insensitive" as const } } },
      ...(barcodeSearch
        ? [
            { product: { barcode: barcodeSearch } },
            { product: { barcodeNormalized: barcodeSearch } },
            { product: { barcode: { contains: barcodeSearch, mode: "insensitive" as const } } },
            { product: { barcodeNormalized: { contains: barcodeSearch, mode: "insensitive" as const } } },
            { product: { sku: { contains: barcodeSearch, mode: "insensitive" as const } } }
          ]
        : [])
    ]
  };
}

inventoryRoute.get("/stock", async (c) => {
  const productId = c.req.query("productId");
  const categoryId = c.req.query("categoryId");
  const warehouseId = c.req.query("warehouseId");
  const search = c.req.query("search");
  const sortBy = c.req.query("sortBy");
  const sortOrder = c.req.query("sortOrder") === "asc" ? "asc" : "desc";
  const requestedCostFilter = c.req.query("costFilter");
  const costFilter =
    requestedCostFilter === "costBelowHalfSale"
      ? "costBelowHalfSale"
      : requestedCostFilter === "costAboveSale" ||
          c.req.query("costAboveSale") === "true"
        ? "costAboveSale"
        : null;
  const pagination = getPagePagination(c, { defaultLimit: 20, maxLimit: 100 });
  const exactProductIds = search
    ? await findProductIdsByBarcode(search)
    : [];
  const where = {
    quantityBase: { gt: 0 },
    ...(productId ? { productId } : {}),
    ...(categoryId ? { product: { categoryId } } : {}),
    ...(warehouseId ? { warehouseId } : {}),
    ...buildStockBalanceSearchWhere(search, exactProductIds)
  };
  const orderBy: Prisma.StockBalanceOrderByWithRelationInput[] =
    sortBy === "quantity"
      ? [{ quantityBase: sortOrder }, { product: { name: "asc" } }]
      : sortBy === "value"
        ? [{ valueBase: sortOrder }, { product: { name: "asc" } }]
        : [{ product: { name: "asc" } }, { warehouse: { name: "asc" } }];

  if (costFilter) {
    const rawSearch = (search || "").trim();
    const barcodeSearch = normalizeBarcodeText(rawSearch);
    const rawSearchLike = `%${rawSearch}%`;
    const barcodeSearchLike = `%${barcodeSearch}%`;
    const productFilter = productId
      ? Prisma.sql`AND sb."productId" = ${productId}`
      : Prisma.empty;
    const warehouseFilter = warehouseId
      ? Prisma.sql`AND sb."warehouseId" = ${warehouseId}`
      : Prisma.empty;
    const categoryFilter = categoryId
      ? Prisma.sql`AND p."categoryId" = ${categoryId}`
      : Prisma.empty;
    const searchFilter = rawSearch
      ? Prisma.sql`
          AND (
            p."name" ILIKE ${rawSearchLike}
            OR p."sku" ILIKE ${rawSearchLike}
            ${
              exactProductIds.length
                ? Prisma.sql`OR p.id IN (${Prisma.join(exactProductIds)})`
                : Prisma.empty
            }
            OR p."barcode" = ${rawSearch}
            OR p."barcode" ILIKE ${rawSearchLike}
            OR w."name" ILIKE ${rawSearchLike}
            ${
              barcodeSearch
                ? Prisma.sql`
                    OR p."barcode" = ${barcodeSearch}
                    OR p."barcodeNormalized" = ${barcodeSearch}
                    OR p."barcode" ILIKE ${barcodeSearchLike}
                    OR p."barcodeNormalized" ILIKE ${barcodeSearchLike}
                    OR p."sku" ILIKE ${barcodeSearchLike}
                  `
                : Prisma.empty
            }
          )
        `
      : Prisma.empty;
    const orderBySql =
      sortBy === "quantity"
        ? Prisma.raw(`sb."quantityBase" ${sortOrder.toUpperCase()}, p."name" ASC`)
        : sortBy === "value"
          ? Prisma.raw(`sb."valueBase" ${sortOrder.toUpperCase()}, p."name" ASC`)
          : Prisma.raw(`p."name" ASC, w."name" ASC`);
    const costFilterSql =
      costFilter === "costAboveSale"
        ? Prisma.sql`
            AND (sb."valueBase" / NULLIF(sb."quantityBase", 0)) > COALESCE(pu."salePrice", 0)
          `
        : Prisma.sql`
            AND (sb."valueBase" / NULLIF(sb."quantityBase", 0)) < (COALESCE(pu."salePrice", 0) * 0.5)
          `;
    const baseWhere = Prisma.sql`
      FROM "StockBalance" sb
      JOIN "Product" p ON p.id = sb."productId"
      JOIN "Warehouse" w ON w.id = sb."warehouseId"
      LEFT JOIN "Unit" bu ON bu.id = p."baseUnitId"
      LEFT JOIN "ProductUnit" pu ON pu."productId" = p.id AND pu."unitId" = p."baseUnitId"
      WHERE sb."quantityBase" > 0
        ${productFilter}
        ${categoryFilter}
        ${warehouseFilter}
        ${searchFilter}
        AND COALESCE(pu."salePrice", 0) > 0
        ${costFilterSql}
    `;

    const [balances, totalRows] = await Promise.all([
      prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT
          sb."productId",
          p."name" AS "productName",
          p."barcode",
          sb."warehouseId",
          w."name" AS "warehouseName",
          bu."name" AS "baseUnitName",
          bu."shortName" AS "baseUnitShortName",
          sb."quantityBase" AS "totalQuantity",
          sb."valueBase",
          sb."earliestExpiryAt",
          COALESCE(sb."valueBase" / NULLIF(sb."quantityBase", 0), 0) AS "baseUnitCost",
          COALESCE(pu."purchasePrice", 0) AS "basePurchasePrice",
          COALESCE(pu."salePrice", 0) AS "baseSalePrice",
          (
            COALESCE(sb."valueBase" / NULLIF(sb."quantityBase", 0), 0) >
            COALESCE(pu."salePrice", 0)
          ) AS "isCostAboveSale",
          (
            COALESCE(pu."salePrice", 0) > 0 AND
            COALESCE(sb."valueBase" / NULLIF(sb."quantityBase", 0), 0) <
              (COALESCE(pu."salePrice", 0) * 0.5)
          ) AS "isCostBelowHalfSale"
        ${baseWhere}
        ORDER BY ${orderBySql}
        OFFSET ${pagination.skip}
        LIMIT ${pagination.limit}
      `),
      prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS count
        ${baseWhere}
      `)
    ]);

    const total = Number(totalRows[0]?.count || 0);
    return c.json({
      data: balances.map((balance) => ({
        productId: balance.productId,
        productName: balance.productName,
        barcode: balance.barcode,
        warehouseId: balance.warehouseId,
        warehouseName: balance.warehouseName,
        baseUnitName:
          balance.baseUnitShortName || balance.baseUnitName || "base",
        totalQuantity: Number(balance.totalQuantity),
        valueBase: Number(balance.valueBase),
        earliestExpiryAt: balance.earliestExpiryAt,
        baseUnitCost: Number(balance.baseUnitCost),
        basePurchasePrice: Number(balance.basePurchasePrice),
        baseSalePrice: Number(balance.baseSalePrice),
        isCostAboveSale: Boolean(balance.isCostAboveSale),
        isCostBelowHalfSale: Boolean(balance.isCostBelowHalfSale),
        lots: balance.earliestExpiryAt ? [{ expiryDate: balance.earliestExpiryAt }] : []
      })),
      pagination: createPaginationMeta({ ...pagination, total })
    });
  }

  const [balances, total] = await Promise.all([
    prisma.stockBalance.findMany({
    where,
    include: {
      product: {
        include: {
          baseUnit: true,
          units: true
        }
      },
      warehouse: true
    },
    orderBy,
    skip: pagination.skip,
    take: pagination.limit
  }),
    prisma.stockBalance.count({ where })
  ]);

  return c.json({
    data: balances.map((balance) => {
      const baseProductUnit = balance.product.units.find(
        (unit) => unit.unitId === balance.product.baseUnitId
      );
      const totalQuantity = Number(balance.quantityBase);
      const valueBase = Number(balance.valueBase);
      const baseUnitCost = totalQuantity > 0 ? valueBase / totalQuantity : 0;
      const baseSalePrice = Number(baseProductUnit?.salePrice || 0);

      return {
        productId: balance.productId,
        productName: balance.product.name,
        barcode: balance.product.barcode,
        warehouseId: balance.warehouseId,
        warehouseName: balance.warehouse.name,
        baseUnitName:
          balance.product.baseUnit.shortName || balance.product.baseUnit.name,
        totalQuantity,
        valueBase,
        earliestExpiryAt: balance.earliestExpiryAt,
        baseUnitCost,
        basePurchasePrice: Number(baseProductUnit?.purchasePrice || 0),
        baseSalePrice,
        isCostAboveSale: baseSalePrice > 0 && baseUnitCost > baseSalePrice,
        isCostBelowHalfSale:
          baseSalePrice > 0 && baseUnitCost < baseSalePrice * 0.5,
        // Kept for compatibility with the existing inventory table. Full lot detail
        // is loaded only when the user opens the lot view.
        lots: balance.earliestExpiryAt ? [{ expiryDate: balance.earliestExpiryAt }] : []
      };
    }),
    pagination: createPaginationMeta({ ...pagination, total })
  });
});

inventoryRoute.get("/lots", async (c) => {
  const productId = c.req.query("productId");
  const warehouseId = c.req.query("warehouseId");

  const pagination = getPagePagination(c);
  const where = {
    ...(productId ? { productId } : {}),
    ...(warehouseId ? { warehouseId } : {})
  };
  const [lots, total] = await Promise.all([
    prisma.stockLot.findMany({
    where,
    include: {
      product: true,
      warehouse: true,
      movements: {
        orderBy: {
          createdAt: "desc"
        }
      }
    },
    orderBy: [
      {
        expiryDate: "asc"
      },
      {
        createdAt: "asc"
      }
    ],
    skip: pagination.skip,
    take: pagination.limit
  }),
    prisma.stockLot.count({ where })
  ]);

  return c.json({ data: lots, pagination: createPaginationMeta({ ...pagination, total }) });
});

inventoryRoute.get("/movements", async (c) => {
  const type = c.req.query("type");
  const productId = c.req.query("productId");
  const warehouseId = c.req.query("warehouseId");
  const referenceId = c.req.query("referenceId");
  const search = c.req.query("search");
  const exactProductIds = search
    ? await findProductIdsByBarcode(search)
    : [];
  const pagination = getPagePagination(c, { defaultLimit: 100, maxLimit: 200 });
  const allowedTypes = Object.values(StockMovementType);
  const movementType = allowedTypes.includes(type as StockMovementType)
    ? (type as StockMovementType)
    : undefined;

  const where = {
      createdAt: getRecentDateRange(c),
      ...(movementType ? { type: movementType } : {}),
      ...(productId ? { productId } : {}),
      ...(warehouseId ? { warehouseId } : {}),
      ...(referenceId ? { referenceId } : {}),
      ...buildStockMovementSearchWhere(search, exactProductIds)
  };
  const [movements, total] = await Promise.all([
    prisma.stockMovement.findMany({
    where,
    include: {
      product: {
        include: {
          baseUnit: true
        }
      },
      warehouse: true,
      lot: true,
      createdByUser: true
    },
    orderBy: {
      createdAt: "desc"
    },
    skip: pagination.skip,
    take: pagination.limit
  }),
    prisma.stockMovement.count({ where })
  ]);
  const movementIds = movements.map((movement) => movement.id);
  const cancellationTypes = Array.from(
    new Set(movements.map((movement) => `${movement.type}_CANCEL`)),
  );
  const cancellationRows = movementIds.length
    ? await prisma.stockMovement.findMany({
        where: {
          referenceId: { in: movementIds },
          referenceType: { in: cancellationTypes },
        },
        select: { referenceId: true },
      })
    : [];
  const cancelledMovementIds = new Set(
    cancellationRows
      .map((movement) => movement.referenceId)
      .filter((id): id is string => Boolean(id)),
  );
  const decoratedMovements = movements.map((movement) => ({
    ...movement,
    isCancelled:
      Boolean(movement.referenceType?.endsWith("_CANCEL")) ||
      cancelledMovementIds.has(movement.id),
  }));

  return c.json({ data: decoratedMovements, pagination: createPaginationMeta({ ...pagination, total }) });
});

inventoryRoute.get("/product-history/:productId", async (c) => {
  const productId = c.req.param("productId");
  const today = kabulDateKey();
  const selectedRange = kabulDateRange(
    c.req.query("from") || `${today.slice(0, 7)}-01`,
    c.req.query("to") || today
  );
  const range = { gte: selectedRange.start, lt: selectedRange.end };
  const pagination = getPagePagination(c, { defaultLimit: 20, maxLimit: 1000 });

  if (range.gte >= range.lt) {
    return c.json({ message: "From date must be before to date" }, 400);
  }

  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    include: { baseUnit: true, category: true }
  });

  if (!product) {
    return c.json({ message: "Product not found" }, 404);
  }

  const periodWhere = {
    productId,
    OR: [
      { occurredAt: { gte: range.gte, lt: range.lt } },
      { occurredAt: null, createdAt: { gte: range.gte, lt: range.lt } }
    ]
  };
  const openingWhere = {
    productId,
    OR: [
      { occurredAt: { lt: range.gte } },
      { occurredAt: null, createdAt: { lt: range.gte } }
    ]
  };

  const [openingGroups, periodGroups, movementIdRows, total] = await Promise.all([
    prisma.stockMovement.groupBy({
      by: ["type"],
      where: openingWhere,
      _sum: { quantity: true }
    }),
    prisma.stockMovement.groupBy({
      by: ["type"],
      where: periodWhere,
      _sum: { quantity: true }
    }),
    prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM "StockMovement"
      WHERE "productId" = ${productId}
        AND COALESCE("occurredAt", "createdAt") >= ${range.gte}
        AND COALESCE("occurredAt", "createdAt") < ${range.lt}
      ORDER BY COALESCE("occurredAt", "createdAt") DESC, id DESC
      LIMIT ${pagination.limit}
      OFFSET ${pagination.skip}
    `),
    prisma.stockMovement.count({ where: periodWhere })
  ]);

  const movementIdsInOrder = movementIdRows.map((row) => row.id);
  const movementRows = movementIdsInOrder.length
    ? await prisma.stockMovement.findMany({
        where: { id: { in: movementIdsInOrder } },
        include: {
          warehouse: true,
          lot: true,
          createdByUser: true
        }
      })
    : [];
  const movementById = new Map(movementRows.map((movement) => [movement.id, movement]));
  const movements = movementIdsInOrder
    .map((id) => movementById.get(id))
    .filter((movement): movement is NonNullable<typeof movement> => Boolean(movement));

  const currencyIds = Array.from(
    new Set(
      movements
        .map((movement) => movement.currencyId)
        .filter((id): id is string => Boolean(id))
    )
  );
  const currencies = currencyIds.length
    ? await prisma.currency.findMany({
        where: { id: { in: currencyIds } },
        select: { id: true, code: true, symbol: true }
      })
    : [];
  const currencyById = new Map(currencies.map((currency) => [currency.id, currency]));

  const opening = movementNetTotal(openingGroups);
  const totalIn = periodGroups
    .filter((row) => movementDirection(row.type) === "IN")
    .reduce((sum, row) => sum + Number(row._sum.quantity || 0), 0);
  const totalOut = periodGroups
    .filter((row) => movementDirection(row.type) === "OUT")
    .reduce((sum, row) => sum + Number(row._sum.quantity || 0), 0);

  const movementIds = movements.map((movement) => movement.id);
  const cancellationRows = movementIds.length
    ? await prisma.stockMovement.findMany({
        where: {
          referenceId: { in: movementIds },
          referenceType: { endsWith: "_CANCEL" }
        },
        select: { referenceId: true }
      })
    : [];
  const cancelledMovementIds = new Set(
    cancellationRows
      .map((movement) => movement.referenceId)
      .filter((id): id is string => Boolean(id))
  );

  return c.json({
    data: {
      product: {
        id: product.id,
        name: product.name,
        barcode: product.barcode,
        sku: product.sku,
        categoryName: product.category?.name || null,
        baseUnitName: product.baseUnit.shortName || product.baseUnit.name
      },
      range: { from: range.gte, toExclusive: range.lt },
      summary: {
        opening,
        totalIn,
        totalOut,
        closing: opening + totalIn - totalOut
      },
      movements: movements.map((movement) => {
        const direction = movementDirection(movement.type);
        const quantity = Number(movement.quantity);
        const baseUnitCost = Number(movement.baseUnitCost ?? movement.unitCost ?? 0);
        const currency = movement.currencyId
          ? currencyById.get(movement.currencyId)
          : null;

        return {
          id: movement.id,
          type: movement.type,
          direction,
          quantity,
          signedQuantity: direction === "IN" ? quantity : -quantity,
          unitCost: movement.unitCost == null ? null : Number(movement.unitCost),
          baseUnitCost:
            movement.baseUnitCost == null ? null : Number(movement.baseUnitCost),
          totalBaseCost: quantity * baseUnitCost,
          exchangeRate: Number(movement.exchangeRate || 1),
          currencyCode: currency?.code || currency?.symbol || null,
          createdAt: movement.occurredAt ?? movement.createdAt,
          registeredAt: movement.createdAt,
          occurredAt: movement.occurredAt,
          warehouseName: movement.warehouse.name,
          lotId: movement.lotId,
          expiryDate: movement.lot?.expiryDate || null,
          referenceType: movement.referenceType,
          referenceId: movement.referenceId,
          note: movement.note,
          createdBy:
            movement.createdByUser?.displayName ||
            movement.createdByUser?.username ||
            null,
          isCancelled:
            Boolean(movement.referenceType?.endsWith("_CANCEL")) ||
            cancelledMovementIds.has(movement.id)
        };
      })
    },
    pagination: createPaginationMeta({ ...pagination, total })
  });
});

inventoryRoute.get("/transfer-reports", async (c) => {
  const pagination = getPagePagination(c, { defaultLimit: 100, maxLimit: 200 });
  const search = c.req.query("search");
  const exactProductIds = search
    ? await findProductIdsByBarcode(search)
    : [];
  const where = {
      createdAt: getRecentDateRange(c),
      type: {
        in: [StockMovementType.TRANSFER_OUT, StockMovementType.TRANSFER_IN]
      },
      ...buildStockMovementSearchWhere(search, exactProductIds)
  };
  const [movements, total] = await Promise.all([
    prisma.stockMovement.findMany({
    where,
    include: {
      product: {
        include: {
          baseUnit: true
        }
      },
      warehouse: true,
      lot: true,
      createdByUser: true
    },
    orderBy: {
      createdAt: "desc"
    },
    skip: pagination.skip,
    take: pagination.limit
  }),
    prisma.stockMovement.count({ where })
  ]);
  const transferReferenceIds = Array.from(
    new Set(
      movements
        .map((movement) => movement.referenceId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const cancellationRows = transferReferenceIds.length
    ? await prisma.stockMovement.findMany({
        where: {
          referenceType: "TRANSFER_CANCEL",
          referenceId: { in: transferReferenceIds },
        },
        select: { referenceId: true },
      })
    : [];
  const cancelledTransferIds = new Set(
    cancellationRows
      .map((movement) => movement.referenceId)
      .filter((id): id is string => Boolean(id)),
  );
  const decoratedMovements = movements.map((movement) => ({
    ...movement,
    isCancelled:
      movement.referenceType === "TRANSFER_CANCEL" ||
      Boolean(
        movement.referenceId && cancelledTransferIds.has(movement.referenceId),
      ),
  }));

  return c.json({ data: decoratedMovements, pagination: createPaginationMeta({ ...pagination, total }) });
});

inventoryRoute.get("/damage-reports", async (c) => {
  const pagination = getPagePagination(c, { defaultLimit: 100, maxLimit: 200 });
  const where = {
      createdAt: getRecentDateRange(c),
      type: StockMovementType.DAMAGE
  };
  const [movements, total] = await Promise.all([
    prisma.stockMovement.findMany({
    where,
    include: {
      product: {
        include: {
          baseUnit: true
        }
      },
      warehouse: true,
      lot: true,
      createdByUser: true
    },
    orderBy: {
      createdAt: "desc"
    },
    skip: pagination.skip,
    take: pagination.limit
  }),
    prisma.stockMovement.count({ where })
  ]);

  return c.json({ data: movements, pagination: createPaginationMeta({ ...pagination, total }) });
});

inventoryRoute.post("/movements/:id/cancel", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = cancelMovementSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const movement = await prisma.stockMovement.findUnique({
    where: { id },
    include: {
      lot: true
    }
  });

  if (!movement) {
    return c.json({ message: "Stock movement not found" }, 404);
  }

  if (movement.referenceType?.endsWith("_CANCEL")) {
    return c.json({ message: "Cancellation movement cannot be cancelled again" }, 400);
  }

  if (
    movement.type !== StockMovementType.OPENING_STOCK &&
    movement.type !== StockMovementType.ADJUSTMENT_IN &&
    movement.type !== StockMovementType.ADJUSTMENT_OUT &&
    movement.type !== StockMovementType.DAMAGE
  ) {
    return c.json(
      {
        message:
          "This movement must be cancelled from its source document or transfer reference"
      },
      400
    );
  }

  const existingCancel = await prisma.stockMovement.findFirst({
    where: {
      referenceType: `${movement.type}_CANCEL`,
      referenceId: movement.id
    }
  });

  if (existingCancel) {
    return c.json({ message: "Stock movement is already cancelled" }, 400);
  }

  if (!movement.lotId) {
    return c.json({ message: "Stock movement has no lot to reverse" }, 400);
  }

  const amount = Number(movement.quantity);
  const addedStock =
    movement.type === StockMovementType.OPENING_STOCK ||
    movement.type === StockMovementType.ADJUSTMENT_IN;

  if (addedStock && (!movement.lot || Number(movement.lot.remainingQuantity) < amount)) {
    return c.json(
      {
        message:
          "Stock movement cannot be cancelled because this lot was already used or transferred"
      },
      400
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    await acquireTransactionLock(tx, "stock-movement-cancel", movement.id);
    const current = await tx.stockMovement.findUnique({
      where: { id: movement.id },
      include: { lot: true }
    });
    if (!current || !current.lotId || !current.lot) {
      throw new Error("حرکت موجودی یا لات آن پیدا نشد.");
    }
    const inventory = new InventoryMutationService(tx);
    if (current.operationId) {
      const cancelled = await inventory.cancelOperation({
        operationId: current.operationId,
        reason: parsed.data.reason,
        cancelledByUserId: authUser?.id,
        occurredAt: kabulNow()
      });
      const journalEntry =
        current.type === StockMovementType.ADJUSTMENT_IN
          ? await createReversalJournal(tx, {
              sourceType: "INVENTORY_ADJUSTMENT_IN",
              sourceId: current.operationId,
              reversalSourceType: "INVENTORY_ADJUSTMENT_IN_CANCEL",
              reversalSourceId: current.operationId,
              entryNoPrefix: "JE-INV-IN-CANCEL",
              description: `Inventory adjustment cancellation ${current.operationId}`,
              createdByUserId: authUser?.id || null
            })
          : null;
      return {
        operation: cancelled,
        journalEntry
      };
    }

    await inventory.lock([
      {
        productId: current.productId,
        warehouseId: current.warehouseId
      }
    ]);

    const duplicateCancel = await tx.stockMovement.findFirst({
      where: {
        referenceType: `${current.type}_CANCEL`,
        referenceId: current.id
      }
    });
    if (duplicateCancel) {
      throw new Error("این حرکت موجودی قبلاً ابطال شده است.");
    }

    const currentAmount = roundStockQuantity(Number(current.quantity));
    if (addedStock) {
      const changed = await tx.stockLot.updateMany({
        where: {
          id: current.lotId,
          remainingQuantity: { gte: stockDecimal(currentAmount) }
        },
        data: { remainingQuantity: { decrement: stockDecimal(currentAmount) } }
      });
      if (changed.count !== 1) {
        throw new Error("این لات مصرف شده و ابطال حرکت ممکن نیست.");
      }
    } else {
      await tx.stockLot.update({
        where: { id: current.lotId },
        data: { remainingQuantity: { increment: stockDecimal(currentAmount) } }
      });
    }

    const cancelMovement = await tx.stockMovement.create({
      data: {
        productId: current.productId,
        warehouseId: current.warehouseId,
        lotId: current.lotId,
        type: addedStock
          ? StockMovementType.ADJUSTMENT_OUT
          : StockMovementType.ADJUSTMENT_IN,
        quantity: currentAmount,
        occurredAt: kabulNow(),
        unitCost: current.unitCost,
        currencyId: current.currencyId,
        exchangeRate: current.exchangeRate,
        baseUnitCost: current.baseUnitCost,
        referenceType: `${current.type}_CANCEL`,
        referenceId: current.id,
        note: parsed.data.reason ?? "Stock movement cancellation",
        createdByUserId: authUser?.id || null
      }
    });

    return {
      movement: cancelMovement
    };
  });

  await writeAudit(c, {
    action: "INVENTORY_MOVEMENT_CANCELLED",
    entityType: "StockMovement",
    entityId: movement.id,
    metadata: {
      reason: parsed.data.reason ?? null
    }
  });

  return c.json({ data: result });
});

inventoryRoute.post("/transfers/:referenceId/cancel", async (c) => {
  const authUser = getAuthUser(c);
  const referenceId = c.req.param("referenceId");
  const body = await c.req.json().catch(() => ({}));
  const parsed = cancelMovementSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const movements = await prisma.stockMovement.findMany({
    where: {
      referenceType: "TRANSFER",
      referenceId,
      type: {
        in: [StockMovementType.TRANSFER_OUT, StockMovementType.TRANSFER_IN]
      }
    },
    include: {
      lot: true
    }
  });

  if (movements.length === 0) {
    return c.json({ message: "Inventory transfer not found" }, 404);
  }

  const existingCancel = await prisma.stockMovement.findFirst({
    where: {
      referenceType: "TRANSFER_CANCEL",
      referenceId
    }
  });

  if (existingCancel) {
    return c.json({ message: "Inventory transfer is already cancelled" }, 400);
  }

  const transferIns = movements.filter(
    (movement) => movement.type === StockMovementType.TRANSFER_IN
  );

  for (const movement of transferIns) {
    if (!movement.lot || Number(movement.lot.remainingQuantity) < Number(movement.quantity)) {
      return c.json(
        {
          message:
            "Inventory transfer cannot be cancelled because destination stock was already used"
        },
        400
      );
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    await acquireTransactionLock(tx, "stock-transfer-cancel", referenceId);
    const currentMovements = await tx.stockMovement.findMany({
      where: {
        referenceType: "TRANSFER",
        referenceId,
        type: {
          in: [StockMovementType.TRANSFER_OUT, StockMovementType.TRANSFER_IN]
        }
      },
      include: { lot: true }
    });
    if (currentMovements.length === 0) {
      throw new Error("انتقال موجودی پیدا نشد.");
    }
    const inventory = new InventoryMutationService(tx);
    await inventory.lock(
      currentMovements.map((movement) => ({
        productId: movement.productId,
        warehouseId: movement.warehouseId
      }))
    );
    const operation = await tx.inventoryOperation.findUnique({
      where: { id: referenceId }
    });
    if (operation?.status === "CANCELLED" || operation?.cancelledAt) {
      throw new Error("این انتقال قبلاً ابطال شده است.");
    }

    const duplicateCancel = await tx.stockMovement.findFirst({
      where: { referenceType: "TRANSFER_CANCEL", referenceId }
    });
    if (duplicateCancel) {
      throw new Error("این انتقال قبلاً ابطال شده است.");
    }

    const cancelMovements = [];

    for (const movement of currentMovements) {
      const amount = roundStockQuantity(Number(movement.quantity));
      const wasTransferIn = movement.type === StockMovementType.TRANSFER_IN;

      if (!movement.lotId) {
        throw new Error("Transfer movement has no lot to reverse");
      }

      if (wasTransferIn) {
        const changed = await tx.stockLot.updateMany({
          where: {
            id: movement.lotId,
            remainingQuantity: { gte: stockDecimal(amount) }
          },
          data: { remainingQuantity: { decrement: stockDecimal(amount) } }
        });
        if (changed.count !== 1) {
          throw new Error(
            "موجودی مقصد مصرف شده و ابطال انتقال ممکن نیست."
          );
        }
      } else {
        await tx.stockLot.update({
          where: { id: movement.lotId },
          data: { remainingQuantity: { increment: stockDecimal(amount) } }
        });
      }

      const cancelMovement = await tx.stockMovement.create({
        data: {
          productId: movement.productId,
          warehouseId: movement.warehouseId,
          lotId: movement.lotId,
          operationId: operation?.id ?? null,
          occurredAt: kabulNow(),
          type: wasTransferIn
            ? StockMovementType.TRANSFER_OUT
            : StockMovementType.TRANSFER_IN,
          quantity: amount,
          unitCost: movement.unitCost,
          currencyId: movement.currencyId,
          exchangeRate: movement.exchangeRate,
          baseUnitCost: movement.baseUnitCost,
          referenceType: "TRANSFER_CANCEL",
          referenceId,
          note: parsed.data.reason ?? "Inventory transfer cancellation",
          createdByUserId: authUser?.id || null
        }
      });

      cancelMovements.push(cancelMovement);
    }

    if (operation) {
      const changed = await tx.inventoryOperation.updateMany({
        where: { id: operation.id, status: "COMPLETED", cancelledAt: null },
        data: {
          status: "CANCELLED",
          cancelledAt: kabulNow(),
          cancelReason: parsed.data.reason ?? null,
          cancelledByUserId: authUser?.id ?? null
        }
      });
      if (changed.count !== 1) {
        throw new Error("این انتقال هم‌زمان ابطال شده است.");
      }
    }

    return {
      referenceId,
      movements: cancelMovements
    };
  });

  await writeAudit(c, {
    action: "INVENTORY_TRANSFER_CANCELLED",
    entityType: "StockMovement",
    entityId: referenceId,
    metadata: {
      reason: parsed.data.reason ?? null
    }
  });

  return c.json({ data: result });
});

inventoryRoute.post("/opening-stock", async (c) => {
  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => null);
  const parsed = openingStockSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const { product, warehouse } = await ensureProductAndWarehouse(
    parsed.data.productId,
    parsed.data.warehouseId
  );

  if (!product) {
    return c.json({ message: "Product not found" }, 404);
  }

  if (!warehouse) {
    return c.json({ message: "Warehouse not found" }, 404);
  }

  let unitConversion;
  try {
    unitConversion = resolveProductUnitConversion(product, parsed.data.unitId);
  } catch (error) {
    return c.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Selected unit is not configured for this product"
      },
      400
    );
  }

  const quantityBase = roundStockQuantity(
    parsed.data.quantity * unitConversion.conversionRate
  );
  const unitCostBase = roundMoney(
    parsed.data.unitCost / unitConversion.conversionRate
  );

  const expiryDate = parseExpiryDate(parsed.data.expiryDate);

  if (expiryDate === "INVALID_DATE") {
    return c.json({ message: "Invalid expiryDate" }, 400);
  }

  if (product.hasExpiry && !expiryDate) {
    return c.json(
      {
        message: "Expiry date is required for this product"
      },
      400
    );
  }

  let stockSnapshot;
  try {
    stockSnapshot = parsed.data.currencyId
      ? await resolveCurrencySnapshot(prisma, parsed.data.currencyId)
      : { exchangeRate: 1, baseCurrencyId: null };
  } catch (error) {
    return c.json(
      { message: error instanceof Error ? error.message : "Currency rate could not be resolved" },
      400
    );
  }

  const occurredAt = kabulNow();
  const clientRequestId = inventoryRequestId(c, "OPENING-STOCK");

  const result = await prisma.$transaction(async (tx) => {
    const inventory = new InventoryMutationService(tx);
    await inventory.prepare([
      {
        productId: parsed.data.productId,
        warehouseId: parsed.data.warehouseId
      }
    ]);
    const operation = await inventory.startOperation({
      ...inventoryOperationEvidence(c),
      type: "OPENING_STOCK",
      clientRequestId,
      occurredAt,
      createdByUserId: authUser?.id
    });
    const lot = await tx.stockLot.create({
      data: {
        productId: parsed.data.productId,
        warehouseId: parsed.data.warehouseId,
        expiryDate,
        initialQuantity: quantityBase,
        remainingQuantity: quantityBase,
        unitCost: unitCostBase,
        currencyId: parsed.data.currencyId ?? null,
        exchangeRate: stockSnapshot.exchangeRate,
        baseUnitCost: roundMoney(unitCostBase * stockSnapshot.exchangeRate),
        sourceType: "OPENING_STOCK",
        note: [
          parsed.data.note ?? null,
          `واحد ثبت: ${parsed.data.quantity} x ${unitConversion.conversionRate}`
        ].filter(Boolean).join(" | ") || null
      }
    });

    const movement = await tx.stockMovement.create({
      data: {
        productId: parsed.data.productId,
        warehouseId: parsed.data.warehouseId,
        lotId: lot.id,
        type: StockMovementType.OPENING_STOCK,
        operationId: operation.id,
        occurredAt,
        quantity: quantityBase,
        unitCost: unitCostBase,
        currencyId: parsed.data.currencyId ?? null,
        exchangeRate: stockSnapshot.exchangeRate,
        baseUnitCost: roundMoney(unitCostBase * stockSnapshot.exchangeRate),
        referenceType: "OPENING_STOCK",
        referenceId: lot.id,
        note: [
          parsed.data.note ?? null,
          `واحد ثبت: ${parsed.data.quantity} x ${unitConversion.conversionRate}`
        ].filter(Boolean).join(" | ") || null,
        createdByUserId: authUser?.id || null
      }
    });

    return {
      lot,
      movement
    };
  });

  await writeAudit(c, {
    action: "INVENTORY_OPENING_STOCK",
    entityType: "StockLot",
    entityId: result.lot.id,
    metadata: {
      productId: parsed.data.productId,
      warehouseId: parsed.data.warehouseId,
      quantity: quantityBase,
      enteredQuantity: parsed.data.quantity,
      enteredUnitId: unitConversion.unitId,
      conversionRate: unitConversion.conversionRate
    }
  });

  return c.json({ data: result }, 201);
});

inventoryRoute.patch("/opening-stock/:movementId", async (c) => {
  const authUser = getAuthUser(c);
  const movementId = c.req.param("movementId");
  const body = await c.req.json().catch(() => null);
  const parsed = updateOpeningStockSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const movement = await prisma.stockMovement.findUnique({
    where: { id: movementId },
    include: {
      product: true,
      lot: true
    }
  });

  if (!movement || movement.type !== StockMovementType.OPENING_STOCK || !movement.lot) {
    return c.json({ message: "Opening stock movement not found" }, 404);
  }

  const expiryDate = parseExpiryDate(parsed.data.expiryDate);
  if (expiryDate === "INVALID_DATE") {
    return c.json({ message: "Invalid expiryDate" }, 400);
  }

  if (movement.product.hasExpiry && !expiryDate) {
    return c.json({ message: "Expiry date is required for this product" }, 400);
  }

  const newQuantity = roundStockQuantity(parsed.data.quantity);
  const newUnitCost = roundMoney(parsed.data.unitCost);
  let stockSnapshot;
  try {
    stockSnapshot = parsed.data.currencyId
      ? await resolveCurrencySnapshot(prisma, parsed.data.currencyId)
      : { exchangeRate: 1, baseCurrencyId: null };
  } catch (error) {
    return c.json(
      { message: error instanceof Error ? error.message : "Currency rate could not be resolved" },
      400
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    await acquireTransactionLock(tx, "opening-stock-edit", movementId);
    const current = await tx.stockMovement.findUnique({
      where: { id: movementId },
      include: { lot: true }
    });
    if (!current || current.type !== StockMovementType.OPENING_STOCK || !current.lot) {
      throw new Error("موجودی اولیه پیدا نشد.");
    }

    const inventory = new InventoryMutationService(tx);
    await inventory.prepare([
      {
        productId: current.productId,
        warehouseId: current.warehouseId
      }
    ]);

    const existingCancel = await tx.stockMovement.findFirst({
      where: {
        referenceType: "OPENING_STOCK_CANCEL",
        referenceId: current.id
      }
    });
    if (existingCancel) {
      throw new Error("موجودی اولیه ابطال‌شده قابل ویرایش نیست.");
    }

    const laterMovement = await tx.stockMovement.findFirst({
      where: {
        lotId: current.lotId,
        id: { not: current.id }
      },
      select: { id: true, type: true }
    });
    if (laterMovement) {
      throw new Error(
        "پس از ایجاد حرکت روی این لات، موجودی اولیه قابل ویرایش نیست؛ از افزایش یا کاهش موجودی استفاده کنید."
      );
    }

    const oldInitial = roundStockQuantity(Number(current.lot.initialQuantity));
    const oldRemaining = roundStockQuantity(Number(current.lot.remainingQuantity));
    if (oldInitial !== oldRemaining) {
      throw new Error(
        "موجودی این لات تغییر کرده است؛ اصلاح باید با Adjustment ثبت شود."
      );
    }
    const usedQuantity = 0;
    const newRemaining = newQuantity;

    const lot = await tx.stockLot.update({
      where: { id: current.lotId! },
      data: {
        initialQuantity: newQuantity,
        remainingQuantity: newRemaining,
        unitCost: newUnitCost,
        currencyId: parsed.data.currencyId ?? null,
        exchangeRate: stockSnapshot.exchangeRate,
        baseUnitCost: roundMoney(newUnitCost * stockSnapshot.exchangeRate),
        expiryDate,
        note: parsed.data.note ?? null
      }
    });

    const updatedMovement = await tx.stockMovement.update({
      where: { id: current.id },
      data: {
        quantity: newQuantity,
        unitCost: newUnitCost,
        currencyId: parsed.data.currencyId ?? null,
        exchangeRate: stockSnapshot.exchangeRate,
        baseUnitCost: roundMoney(newUnitCost * stockSnapshot.exchangeRate),
        note: parsed.data.note ?? null
      },
      include: {
        product: {
          include: {
            baseUnit: true
          }
        },
        warehouse: true,
        lot: true,
        createdByUser: true
      }
    });

    return {
      lot,
      movement: updatedMovement,
      oldInitial,
      usedQuantity
    };
  });

  await writeAudit(c, {
    action: "INVENTORY_OPENING_STOCK_UPDATED",
    entityType: "StockMovement",
    entityId: movement.id,
    metadata: {
      oldQuantity: result.oldInitial,
      newQuantity,
      usedQuantity: result.usedQuantity,
      updatedByUserId: authUser?.id || null
    }
  });

  return c.json({ data: result });
});

inventoryRoute.post("/adjustments", async (c) => {
  const authUser = getAuthUser(c);
  if (!hasPermission(authUser, "inventory.manage")) {
    return c.json({ message: "Permission required: inventory.manage" }, 403);
  }
  const body = await c.req.json().catch(() => null);
  const parsed = adjustmentSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const { product, warehouse } = await ensureProductAndWarehouse(
    parsed.data.productId,
    parsed.data.warehouseId
  );

  if (!product) {
    return c.json({ message: "Product not found" }, 404);
  }

  if (!warehouse) {
    return c.json({ message: "Warehouse not found" }, 404);
  }

  let unitConversion;
  try {
    unitConversion = resolveProductUnitConversion(product, parsed.data.unitId);
  } catch (error) {
    return c.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Selected unit is not configured for this product"
      },

      400
    );
  }

  const quantityBase = roundStockQuantity(
    parsed.data.quantity * unitConversion.conversionRate
  );
  const unitCostBase =
    parsed.data.unitCost !== null && parsed.data.unitCost !== undefined
      ? roundMoney(Number(parsed.data.unitCost) / unitConversion.conversionRate)
      : 0;

  const expiryDate = parseExpiryDate(parsed.data.expiryDate);


  if (expiryDate === "INVALID_DATE") {
    return c.json({ message: "Invalid expiryDate" }, 400);
  }

  if (parsed.data.type === "ADJUSTMENT_IN" && product.hasExpiry && !expiryDate) {
    return c.json(
      { message: "Expiry date is required for this product" },
      400
    );
  }

  const occurredAt = kabulNow();
  const clientRequestId = inventoryRequestId(c, parsed.data.type);
  if (parsed.data.type === "ADJUSTMENT_IN") {
    let stockSnapshot;
    try {
      stockSnapshot = parsed.data.currencyId
        ? await resolveCurrencySnapshot(prisma, parsed.data.currencyId)
        : { exchangeRate: 1, baseCurrencyId: null };
    } catch (error) {
      return c.json(
        { message: error instanceof Error ? error.message : "Currency rate could not be resolved" },
        400
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      await acquireTransactionLock(tx, "product-definition", parsed.data.productId);
      const lockedProduct = await tx.product.findUnique({
        where: { id: parsed.data.productId },
        include: { units: true, baseUnit: true }
      });
      if (!lockedProduct) {
        throw new Error("Product not found");
      }
      const lockedUnitConversion = resolveProductUnitConversion(
        lockedProduct,
        parsed.data.unitId
      );
      const lockedQuantityBase = roundStockQuantity(
        parsed.data.quantity * lockedUnitConversion.conversionRate
      );
      const lockedUnitCostBase = roundMoney(
        Number(parsed.data.unitCost || 0) / lockedUnitConversion.conversionRate
      );
      const inventory = new InventoryMutationService(tx);
      await inventory.prepare([
        {
          productId: parsed.data.productId,
          warehouseId: parsed.data.warehouseId
        }
      ]);
      const operation = await inventory.startOperation({
        ...inventoryOperationEvidence(c),
        type: "ADJUSTMENT_IN",
        clientRequestId,
        occurredAt,
        createdByUserId: authUser?.id
      });
      const lot = await tx.stockLot.create({
        data: {
          productId: parsed.data.productId,
          warehouseId: parsed.data.warehouseId,
          expiryDate,
          initialQuantity: lockedQuantityBase,
          remainingQuantity: lockedQuantityBase,
          unitCost: lockedUnitCostBase,
          currencyId: parsed.data.currencyId ?? null,
          exchangeRate: stockSnapshot.exchangeRate,
          baseUnitCost: roundMoney(lockedUnitCostBase * stockSnapshot.exchangeRate),
          sourceType: "ADJUSTMENT_IN",
          note: [
            parsed.data.note ?? null,
            `واحد ثبت: ${parsed.data.quantity} x ${lockedUnitConversion.conversionRate}`
          ].filter(Boolean).join(" | ") || null
        }
      });

      const movement = await tx.stockMovement.create({
        data: {
          productId: parsed.data.productId,
          warehouseId: parsed.data.warehouseId,
          lotId: lot.id,
          type: StockMovementType.ADJUSTMENT_IN,
          operationId: operation.id,
          occurredAt,
          quantity: lockedQuantityBase,
          unitCost: lockedUnitCostBase,
          currencyId: parsed.data.currencyId ?? null,
          exchangeRate: stockSnapshot.exchangeRate,
          baseUnitCost: roundMoney(lockedUnitCostBase * stockSnapshot.exchangeRate),
          referenceType: "ADJUSTMENT",
          referenceId: lot.id,
          note: [
            parsed.data.note ?? null,
            `واحد ثبت: ${parsed.data.quantity} x ${lockedUnitConversion.conversionRate}`
          ].filter(Boolean).join(" | ") || null,
          createdByUserId: authUser?.id || null
        }
      });

      const inventoryValue = roundMoney(lockedQuantityBase * lockedUnitCostBase);
      let journalEntry = null;
      if (inventoryValue > 0) {
        await tx.accountingAccount.upsert({
          where: { code: "7000" },
          update: {},
          create: {
            code: "7000",
            name: "Other Income / عواید سایر",
            type: "INCOME",
            isCash: false,
            isBank: false,
            isActive: true
          }
        });
        journalEntry = await createPostedJournal(tx, {
          entryNoPrefix: "JE-INV-IN",
          sourceType: "INVENTORY_ADJUSTMENT_IN",
          sourceId: operation.id,
          description: `Inventory adjustment in ${operation.id}`,
          createdByUserId: authUser?.id || null,
          lines: [
            {
              accountCode: "1300",
              debit: inventoryValue,
              exchangeRate: stockSnapshot.exchangeRate,
              baseCurrencyId: stockSnapshot.baseCurrencyId,
              note: parsed.data.note ?? "Inventory adjustment in"
            },
            {
              accountCode: "7000",
              credit: inventoryValue,
              exchangeRate: stockSnapshot.exchangeRate,
              baseCurrencyId: stockSnapshot.baseCurrencyId,
              note: parsed.data.note ?? "Inventory adjustment gain"
            }
          ]
        });
      }

      return {
        lot,
        movement,
        journalEntry,
        quantityBase: lockedQuantityBase,
        unitConversion: lockedUnitConversion
      };
    });

    await writeAudit(c, {
      action: "INVENTORY_ADJUSTMENT_IN",
      entityType: "StockLot",
      entityId: result.lot.id,
      metadata: {
        productId: parsed.data.productId,
        warehouseId: parsed.data.warehouseId,
        quantity: result.quantityBase,
        enteredQuantity: parsed.data.quantity,
        enteredUnitId: result.unitConversion.unitId,
        conversionRate: result.unitConversion.conversionRate
      }
    });

    return c.json({ data: result }, 201);
  }

  const movementType =
    parsed.data.type === "DAMAGE"
      ? StockMovementType.DAMAGE
      : StockMovementType.ADJUSTMENT_OUT;

  const result = await prisma.$transaction(async (tx) => {
    const inventory = new InventoryMutationService(tx);
    await inventory.prepare([
      {
        productId: parsed.data.productId,
        warehouseId: parsed.data.warehouseId
      }
    ]);
    const operation = await inventory.startOperation({
      ...inventoryOperationEvidence(c),
      type: parsed.data.type,
      clientRequestId,
      occurredAt,
      createdByUserId: authUser?.id
    });
    const lots = await tx.stockLot.findMany({
      where: {
        productId: parsed.data.productId,
        warehouseId: parsed.data.warehouseId,
        remainingQuantity: { gt: 0 },
        ...(parsed.data.lotId ? { id: parsed.data.lotId } : {})
      },
      orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }]
    });
    let remaining = quantityBase;
    const allocations: Array<{ lot: (typeof lots)[number]; quantity: number }> = [];
    for (const lot of lots) {
      if (remaining <= 0) break;
      const available = roundStockQuantity(Number(lot.remainingQuantity));
      const quantity = roundStockQuantity(Math.min(available, remaining));
      if (quantity <= 0) continue;
      allocations.push({ lot, quantity });
      remaining = roundStockQuantity(remaining - quantity);
    }
    if (remaining > 0) {
      throw new Error(
        `موجودی کافی نیست؛ ${remaining} واحد پایه کمبود است.`
      );
    }

    const movements = [];
    const referenceId = operation.id;

    for (const allocation of allocations) {
      const changed = await tx.stockLot.updateMany({
        where: {
          id: allocation.lot.id,
          remainingQuantity: { gte: stockDecimal(allocation.quantity) }
        },
        data: {
          remainingQuantity: {
            decrement: stockDecimal(allocation.quantity)
          }
        }
      });
      if (changed.count !== 1) {
        throw new Error("موجودی هم‌زمان تغییر کرد؛ عملیات دوباره بررسی شود.");
      }

      const movement = await tx.stockMovement.create({
        data: {
          productId: parsed.data.productId,
          warehouseId: parsed.data.warehouseId,
          lotId: allocation.lot.id,
          type: movementType,
          quantity: allocation.quantity,
          unitCost: allocation.lot.unitCost,
          operationId: operation.id,
          occurredAt,
          currencyId: allocation.lot.currencyId,
          exchangeRate: allocation.lot.exchangeRate,
          baseUnitCost: allocation.lot.baseUnitCost,
          referenceType: parsed.data.type,
          referenceId,
          note: [
            parsed.data.note ?? null,
            `واحد ثبت: ${parsed.data.quantity} x ${unitConversion.conversionRate}`
          ].filter(Boolean).join(" | ") || null,
          createdByUserId: authUser?.id || null
        }
      });

      movements.push(movement);
    }

    return { movements };
  });

  await writeAudit(c, {
    action: parsed.data.type === "DAMAGE" ? "INVENTORY_DAMAGE" : "INVENTORY_ADJUSTMENT_OUT",
    entityType: "StockMovement",
    metadata: {
      productId: parsed.data.productId,
      warehouseId: parsed.data.warehouseId,
      quantity: quantityBase,
      enteredQuantity: parsed.data.quantity,
      enteredUnitId: unitConversion.unitId,
      conversionRate: unitConversion.conversionRate
    }
  });

  return c.json({ data: result }, 201);
});

inventoryRoute.post("/transfers", async (c) => {
  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => null);
  const parsed = transferSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  if (parsed.data.fromWarehouseId === parsed.data.toWarehouseId) {
    return c.json({ message: "Source and destination warehouses must be different" }, 400);
  }

  const [product, fromWarehouse, toWarehouse] = await Promise.all([
    prisma.product.findUnique({
      where: { id: parsed.data.productId },
      include: { units: true, baseUnit: true }
    }),
    prisma.warehouse.findUnique({ where: { id: parsed.data.fromWarehouseId } }),
    prisma.warehouse.findUnique({ where: { id: parsed.data.toWarehouseId } })
  ]);

  if (!product) {
    return c.json({ message: "Product not found" }, 404);
  }

  if (!fromWarehouse || !toWarehouse) {
    return c.json({ message: "Warehouse not found" }, 404);
  }

  let unitConversion;
  try {
    unitConversion = resolveProductUnitConversion(product, parsed.data.unitId);
  } catch (error) {
    return c.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Selected unit is not configured for this product"
      },
      400
    );
  }
  const quantityBase = roundStockQuantity(
    parsed.data.quantity * unitConversion.conversionRate
  );
  const occurredAt = kabulNow();
  const clientRequestId = inventoryRequestId(c, "TRANSFER");

  const result = await prisma.$transaction(async (tx) => {
    const inventory = new InventoryMutationService(tx);
    await inventory.prepare([
      {
        productId: parsed.data.productId,
        warehouseId: parsed.data.fromWarehouseId
      },
      {
        productId: parsed.data.productId,
        warehouseId: parsed.data.toWarehouseId
      }
    ]);
    const operation = await inventory.startOperation({
      ...inventoryOperationEvidence(c),
      type: "TRANSFER",
      clientRequestId,
      occurredAt,
      createdByUserId: authUser?.id
    });
    const referenceId = operation.id;

    const lots = await tx.stockLot.findMany({
      where: {
        productId: parsed.data.productId,
        warehouseId: parsed.data.fromWarehouseId,
        remainingQuantity: { gt: 0 },
        ...(parsed.data.lotId ? { id: parsed.data.lotId } : {})
      },
      orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }]
    });
    let remaining = quantityBase;
    const allocations: Array<{ lot: (typeof lots)[number]; quantity: number }> = [];
    for (const lot of lots) {
      if (remaining <= 0) break;
      const available = roundStockQuantity(Number(lot.remainingQuantity));
      const quantity = roundStockQuantity(Math.min(available, remaining));
      if (quantity <= 0) continue;
      allocations.push({ lot, quantity });
      remaining = roundStockQuantity(remaining - quantity);
    }
    if (remaining > 0) {
      throw new Error(
        `موجودی کافی برای انتقال نیست؛ ${remaining} واحد پایه کمبود است.`
      );
    }

    const movements = [];
    const destinationLots = [];

    for (const allocation of allocations) {
      const changed = await tx.stockLot.updateMany({
        where: {
          id: allocation.lot.id,
          remainingQuantity: { gte: stockDecimal(allocation.quantity) }
        },
        data: {
          remainingQuantity: {
            decrement: stockDecimal(allocation.quantity)
          }
        }
      });
      if (changed.count !== 1) {
        throw new Error("موجودی هم‌زمان تغییر کرد؛ انتقال دوباره بررسی شود.");
      }

      const operationNote = [
        parsed.data.note ?? null,
        `واحد ثبت: ${parsed.data.quantity} x ${unitConversion.conversionRate}`
      ].filter(Boolean).join(" | ") || null;

      const destinationLot = await tx.stockLot.create({
        data: {
          productId: parsed.data.productId,
          warehouseId: parsed.data.toWarehouseId,
          expiryDate: allocation.lot.expiryDate,
          initialQuantity: allocation.quantity,
          remainingQuantity: allocation.quantity,
          unitCost: allocation.lot.unitCost,
          currencyId: allocation.lot.currencyId,
          exchangeRate: allocation.lot.exchangeRate,
          baseUnitCost: allocation.lot.baseUnitCost,
          sourceType: "TRANSFER",
          sourceId: allocation.lot.id,
          note: operationNote
        }
      });

      const transferOut = await tx.stockMovement.create({
        data: {
          productId: parsed.data.productId,
          warehouseId: parsed.data.fromWarehouseId,
          lotId: allocation.lot.id,
          type: StockMovementType.TRANSFER_OUT,
          operationId: operation.id,
          occurredAt,
          quantity: allocation.quantity,
          unitCost: allocation.lot.unitCost,
          currencyId: allocation.lot.currencyId,
          exchangeRate: allocation.lot.exchangeRate,
          baseUnitCost: allocation.lot.baseUnitCost,
          referenceType: "TRANSFER",
          referenceId,
          note: operationNote,
          createdByUserId: authUser?.id || null
        }
      });

      const transferIn = await tx.stockMovement.create({
        data: {
          productId: parsed.data.productId,
          warehouseId: parsed.data.toWarehouseId,
          lotId: destinationLot.id,
          type: StockMovementType.TRANSFER_IN,
          quantity: allocation.quantity,
          operationId: operation.id,
          occurredAt,
          unitCost: allocation.lot.unitCost,
          currencyId: allocation.lot.currencyId,
          exchangeRate: allocation.lot.exchangeRate,
          baseUnitCost: allocation.lot.baseUnitCost,
          referenceType: "TRANSFER",
          referenceId,
          note: operationNote,
          createdByUserId: authUser?.id || null
        }
      });

      destinationLots.push(destinationLot);
      movements.push(transferOut, transferIn);
    }

    return {
      referenceId,
      destinationLots,
      movements
    };
  });

  await writeAudit(c, {
    action: "INVENTORY_TRANSFER",
    entityType: "StockMovement",
    entityId: result.referenceId,
    metadata: {
      productId: parsed.data.productId,
      fromWarehouseId: parsed.data.fromWarehouseId,
      toWarehouseId: parsed.data.toWarehouseId,
      quantity: quantityBase,
      enteredQuantity: parsed.data.quantity,
      enteredUnitId: unitConversion.unitId,
      conversionRate: unitConversion.conversionRate
    }
  });

  return c.json({ data: result }, 201);
});
