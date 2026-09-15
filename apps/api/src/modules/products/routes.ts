import { Hono } from "hono";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import {
  attachAuditUsers,
  auditCreateData,
  auditDeleteData,
  auditUpdateData,
} from "../../lib/audit-meta";
import { getAuthUser, writeAudit } from "../../lib/auth";
import {
  cacheDeleteByPattern,
} from "../../lib/cache";
import { createPaginationMeta, getPagePagination } from "../../lib/pagination";
import {
  generateProductBarcodeCandidate,
  normalizeBarcodeText,
} from "../../lib/barcode";
import {
  barcodeLookupStatus,
  findProductIdsByBarcode,
} from "../../lib/product-barcode-lookup";
import { acquireTransactionLock } from "../../lib/db-lock";
import { InventoryMutationService } from "../../lib/inventory-mutation";

export const productsRoute = new Hono();

const productUnitSchema = z.object({
  unitId: z.string().min(1),
  conversionRate: z.coerce.number().positive(),
  purchasePrice: z.coerce.number().nonnegative().optional().nullable(),
  salePrice: z.coerce.number().nonnegative().optional().nullable(),
  isDefaultPurchase: z.boolean().optional(),
  isDefaultSale: z.boolean().optional(),
});

const createProductSchema = z.object({
  name: z.string().trim().min(2).max(160),
  sku: z.string().trim().max(80).optional().nullable(),
  barcode: z.string().trim().max(80).optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
  imageUrl: z.string().trim().max(500).optional().nullable(),
  categoryId: z.string().optional().nullable(),
  baseUnitId: z.string().min(1),
  defaultWarehouseId: z.string().optional().nullable(),
  hasExpiry: z.boolean().default(false),
  minStock: z.coerce.number().nonnegative().default(0),
  isActive: z.boolean().optional(),
  units: z.array(productUnitSchema).optional().default([]),
});

const updateProductSchema = createProductSchema.partial().extend({
  units: z.array(productUnitSchema).optional(),
});

const mergeProductSchema = z.object({
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  confirm: z.literal(true),
});

function defaultSaleUnitValidationMessage(
  units: Array<{ unitId: string; isDefaultSale?: boolean }>,
) {
  const defaultSaleUnits = units.filter((unit) => unit.isDefaultSale);
  if (defaultSaleUnits.length > 1) {
    return "برای هر محصول فقط یک واحد فروش پیش‌فرض قابل ثبت است";
  }
  return null;
}

const imageMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

async function generateUniqueProductBarcode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const barcode = generateProductBarcodeCandidate();
    const existing = await prisma.product.findFirst({
      where: {
        OR: [{ barcode }, { barcodeNormalized: normalizeBarcodeText(barcode) }],
      },
    });

    if (!existing) return barcode;
  }

  throw new Error("Could not generate a unique product barcode");
}

async function resolveProductBarcode(value: string | null | undefined) {
  const raw = (value || "").trim();
  return raw || generateUniqueProductBarcode();
}

function duplicateBarcodeMessage(barcode: string) {
  return `بارکود ${barcode} قبلا برای محصول دیگری ثبت شده است. لطفا بارکود دیگر وارد کنید یا فیلد بارکود را خالی بگذارید تا سیستم بارکود جدید بسازد.`;
}

function isUniqueConstraintError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  return "code" in error && (error as { code?: string }).code === "P2002";
}

async function ensureBarcodeIsAvailable(
  barcode: string,
  excludeProductId?: string,
) {
  const normalized = normalizeBarcodeText(barcode);
  if (!normalized) return;

  const existing = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM "Product"
    WHERE "deletedAt" IS NULL
      ${excludeProductId ? Prisma.sql`AND id <> ${excludeProductId}` : Prisma.empty}
      AND (
        barcode = ${barcode}
        OR "barcodeNormalized" = ${normalized}
        OR NULLIF(
          replace(
            replace(
              replace(
                replace(
                  regexp_replace(
                    translate(
                      COALESCE(barcode, ''),
                      '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩',
                      '01234567890123456789'
                    ),
                    '[-[:space:]]+',
                    '',
                    'g'
                  ),
                  chr(8203),
                  ''
                ),
                chr(8204),
                ''
              ),
              chr(8205),
              ''
            ),
            chr(8288),
            ''
          ),
          ''
        ) = ${normalized}
      )
    LIMIT 1
  `);

  if (existing.length) {
    throw new Error(duplicateBarcodeMessage(barcode));
  }
}

function buildProductSearchWhere(search: string | null | undefined) {
  const rawSearch = (search || "").trim();
  const barcodeSearch = normalizeBarcodeText(rawSearch);

  if (!rawSearch) return {};

  return {
    OR: [
      { name: { contains: rawSearch, mode: "insensitive" as const } },
      { sku: { contains: rawSearch, mode: "insensitive" as const } },
      { barcode: rawSearch },
      { barcode: { contains: rawSearch, mode: "insensitive" as const } },
      ...(barcodeSearch
        ? [
            { barcode: barcodeSearch },
            { barcodeNormalized: barcodeSearch },
            {
              barcode: {
                contains: barcodeSearch,
                mode: "insensitive" as const,
              },
            },
            {
              barcodeNormalized: {
                contains: barcodeSearch,
                mode: "insensitive" as const,
              },
            },
            { sku: { contains: barcodeSearch, mode: "insensitive" as const } },
          ]
        : []),
    ],
  };
}

function buildBarcodeFilterWhere(filter: string | null | undefined) {
  switch ((filter || "all").trim()) {
    case "has":
      return { barcode: { not: null } };
    case "missing":
      return { barcode: null };
    case "system":
      return { barcode: { startsWith: "20" } };
    case "manual":
      return {
        AND: [
          { barcode: { not: null } },
          { NOT: { barcode: { startsWith: "20" } } }
        ]
      };
    default:
      return {};
  }
}

function productImageExtension(mimeType: string, originalName: string) {
  const ext = path.extname(originalName).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)) return ext;
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  return ".png";
}

const productLookupInclude = {
  category: true,
  baseUnit: true,
  defaultWarehouse: true,
  units: {
    include: {
      unit: true,
    },
    orderBy: { createdAt: "asc" as const },
  },
};

const productMergeInclude = {
  units: {
    include: { unit: true },
    orderBy: { unitId: "asc" as const },
  },
  stockBalances: {
    include: { warehouse: true },
    orderBy: { warehouseId: "asc" as const },
  },
  _count: {
    select: {
      stockLots: true,
      stockMovements: true,
      purchaseItems: true,
      purchaseReturnItems: true,
      saleItems: true,
      saleReturnItems: true,
    },
  },
} satisfies Prisma.ProductInclude;

type ProductMergeCandidate = Prisma.ProductGetPayload<{
  include: typeof productMergeInclude;
}>;

function productUnitSignature(product: ProductMergeCandidate) {
  return product.units
    .map(
      (unit) =>
        `${unit.unitId}:${Number(unit.conversionRate).toFixed(4)}`,
    )
    .sort();
}

function productMergeCounts(product: ProductMergeCandidate) {
  return {
    stockBalances: product.stockBalances.length,
    stockLots: product._count.stockLots,
    stockMovements: product._count.stockMovements,
    purchaseItems: product._count.purchaseItems,
    purchaseReturnItems: product._count.purchaseReturnItems,
    saleItems: product._count.saleItems,
    saleReturnItems: product._count.saleReturnItems,
  };
}

function productMergeSummary(product: ProductMergeCandidate) {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    barcode: product.barcode,
    barcodeNormalized: product.barcodeNormalized,
    baseUnitId: product.baseUnitId,
    categoryId: product.categoryId,
    defaultWarehouseId: product.defaultWarehouseId,
    hasExpiry: product.hasExpiry,
    isActive: product.isActive,
    deletedAt: product.deletedAt,
    units: product.units.map((unit) => ({
      unitId: unit.unitId,
      unitName: unit.unit.shortName || unit.unit.name,
      conversionRate: Number(unit.conversionRate),
      purchasePrice:
        unit.purchasePrice === null ? null : Number(unit.purchasePrice),
      salePrice: unit.salePrice === null ? null : Number(unit.salePrice),
    })),
    stock: product.stockBalances.map((balance) => ({
      warehouseId: balance.warehouseId,
      warehouseName: balance.warehouse.name,
      quantityBase: Number(balance.quantityBase),
      valueBase: Number(balance.valueBase),
      earliestExpiryAt: balance.earliestExpiryAt,
    })),
    counts: productMergeCounts(product),
  };
}

function buildProductMergePreview(
  source: ProductMergeCandidate,
  target: ProductMergeCandidate,
  normalizedOwner: { id: string; name: string } | null,
) {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const sourceNormalized = normalizeBarcodeText(source.barcode || "");
  const targetNormalized = normalizeBarcodeText(target.barcode || "");

  if (source.id === target.id) {
    blockers.push("محصول مبدا و مقصد نمی‌تواند یک محصول باشد");
  }
  if (source.deletedAt || target.deletedAt) {
    blockers.push("محصول حذف‌شده قابل ادغام نیست");
  }
  if (!sourceNormalized || sourceNormalized !== targetNormalized) {
    blockers.push("بارکد نرمال‌شده دو محصول یکسان نیست");
  }
  if (source.baseUnitId !== target.baseUnitId) {
    blockers.push("واحد پایه دو محصول یکسان نیست");
  }
  if (
    JSON.stringify(productUnitSignature(source)) !==
    JSON.stringify(productUnitSignature(target))
  ) {
    blockers.push("واحدها یا نسبت تبدیل دو محصول یکسان نیست");
  }
  if (normalizedOwner) {
    blockers.push(
      `محصول «${normalizedOwner.name}» مالک فعلی بارکد نرمال‌شده است؛ آن را به‌عنوان مقصد انتخاب کنید`,
    );
  }

  if (source.name !== target.name) warnings.push("نام دو محصول متفاوت است؛ نام مقصد حفظ می‌شود");
  if (source.categoryId !== target.categoryId) {
    warnings.push("کتگوری دو محصول متفاوت است؛ کتگوری مقصد حفظ می‌شود");
  }
  if (source.hasExpiry !== target.hasExpiry) {
    warnings.push("تنظیم تاریخ انقضای دو محصول متفاوت است؛ تنظیم مقصد حفظ می‌شود");
  }
  if (!source.isActive || !target.isActive) {
    warnings.push("حداقل یکی از محصولات غیرفعال است");
  }

  const sourcePrices = source.units.map((unit) => [
    unit.unitId,
    Number(unit.purchasePrice || 0),
    Number(unit.salePrice || 0),
  ]);
  const targetPrices = target.units.map((unit) => [
    unit.unitId,
    Number(unit.purchasePrice || 0),
    Number(unit.salePrice || 0),
  ]);
  if (JSON.stringify(sourcePrices) !== JSON.stringify(targetPrices)) {
    warnings.push("قیمت واحدها متفاوت است؛ قیمت‌های محصول مقصد حفظ می‌شود");
  }

  const sourceSummary = productMergeSummary(source);
  const targetSummary = productMergeSummary(target);

  return {
    canMerge: blockers.length === 0,
    normalizedBarcode: sourceNormalized || targetNormalized,
    blockers,
    warnings,
    source: sourceSummary,
    target: targetSummary,
    combined: {
      quantityBase:
        sourceSummary.stock.reduce((sum, row) => sum + row.quantityBase, 0) +
        targetSummary.stock.reduce((sum, row) => sum + row.quantityBase, 0),
      valueBase:
        sourceSummary.stock.reduce((sum, row) => sum + row.valueBase, 0) +
        targetSummary.stock.reduce((sum, row) => sum + row.valueBase, 0),
      counts: Object.fromEntries(
        Object.keys(sourceSummary.counts).map((key) => [
          key,
          sourceSummary.counts[key as keyof typeof sourceSummary.counts] +
            targetSummary.counts[key as keyof typeof targetSummary.counts],
        ]),
      ),
    },
    policy: {
      retainedProductId: target.id,
      retainedName: target.name,
      retainedPrices: "TARGET",
      historicalRelations: "MOVE_TO_TARGET",
      sourceProduct: "SOFT_DELETE_AND_CLEAR_IDENTIFIERS",
    },
  };
}

async function loadProductMergeCandidates(
  tx: Prisma.TransactionClient,
  sourceId: string,
  targetId: string,
) {
  const source = await tx.product.findUnique({
    where: { id: sourceId },
    include: productMergeInclude,
  });
  const target = await tx.product.findUnique({
    where: { id: targetId },
    include: productMergeInclude,
  });

  if (!source || !target) return { source, target, normalizedOwner: null };

  const normalized = normalizeBarcodeText(source.barcode || "");
  const normalizedOwner = normalized
    ? await tx.product.findFirst({
        where: {
          id: { notIn: [sourceId, targetId] },
          deletedAt: null,
          barcodeNormalized: normalized,
        },
        select: { id: true, name: true },
      })
    : null;

  return { source, target, normalizedOwner };
}

function isAdminUser(c: Parameters<typeof getAuthUser>[0]) {
  return getAuthUser(c)?.role === "Admin";
}

productsRoute.get("/", async (c) => {
  const pagination = getPagePagination(c, {
    defaultLimit: 100,
    maxLimit: 200,
  });
  const search = c.req.query("search");
  const barcodeFilter = c.req.query("barcodeFilter");
  const categoryId = c.req.query("categoryId")?.trim();
  const exactBarcodeIds = search
    ? await findProductIdsByBarcode(search)
    : [];
  const searchWhere = search
    ? {
        OR: [
          ...(exactBarcodeIds.length
            ? [{ id: { in: exactBarcodeIds } }]
            : []),
          buildProductSearchWhere(search),
        ],
      }
    : null;
  const where = {
    AND: [
      {
        OR: [
          {
            deletedAt: null,
          },
          {
            stockLots: { some: {} },
          },
          {
            stockMovements: { some: {} },
          },
          {
            purchaseItems: { some: {} },
          },
          {
            purchaseReturnItems: { some: {} },
          },
          {
            saleItems: { some: {} },
          },
          {
            saleReturnItems: { some: {} },
          },
        ],
      },
      ...(searchWhere ? [searchWhere] : []),
      buildBarcodeFilterWhere(barcodeFilter),
      ...(categoryId ? [{ categoryId }] : []),
    ],
  };
  const [items, total, active, barcodeCount] = await Promise.all([
    prisma.product.findMany({
      where,
      include: {
        category: true,
        baseUnit: true,
        defaultWarehouse: true,
        units: {
          include: {
            unit: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.limit,
    }),
    prisma.product.count({ where }),
    prisma.product.count({ where: { deletedAt: null, isActive: true } }),
    prisma.product.count({
      where: { deletedAt: null, barcode: { not: null } },
    }),
  ]);

  return c.json({
    data: await attachAuditUsers(items),
    pagination: createPaginationMeta({ ...pagination, total }),
    summary: { total, active, barcodeCount },
  });
});

productsRoute.get("/lookup", async (c) => {
  const search = (c.req.query("search") || "").trim();
  const requestedLimit = Number.parseInt(c.req.query("limit") || "50", 10);
  const limit = Math.min(
    Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 50, 1),
    100,
  );
  const baseWhere = { deletedAt: null, isActive: true };

  if (!search) {
    const items = await prisma.product.findMany({
      where: baseWhere,
      include: productLookupInclude,
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: limit,
    });

    return c.json({ data: items, pagination: { limit, total: items.length } });
  }

  const exactBarcodeIds = await findProductIdsByBarcode(search);
  const exactBarcodeRows = exactBarcodeIds.length
    ? await prisma.product.findMany({
        where: {
          ...baseWhere,
          id: { in: exactBarcodeIds },
        },
        include: productLookupInclude,
        take: limit,
      })
    : [];
  const exactIds = new Set(exactBarcodeRows.map((item) => item.id));
  const remainingLimit = Math.max(0, limit - exactBarcodeRows.length);
  const fuzzyRows = remainingLimit
    ? await prisma.product.findMany({
        where: {
          ...baseWhere,
          ...(exactIds.size ? { id: { notIn: Array.from(exactIds) } } : {}),
          ...buildProductSearchWhere(search),
        },
        include: productLookupInclude,
        orderBy: [{ name: "asc" }, { updatedAt: "desc" }],
        take: remainingLimit,
      })
    : [];
  const exactRowById = new Map(exactBarcodeRows.map((item) => [item.id, item]));
  const orderedExactRows = exactBarcodeIds
    .map((id) => exactRowById.get(id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const data = [...orderedExactRows, ...fuzzyRows];

  return c.json({ data, pagination: { limit, total: data.length } });
});

productsRoute.get("/pos-search", async (c) => {
  const search = (c.req.query("search") || "").trim();
  const categoryId = (c.req.query("categoryId") || "").trim();
  const warehouseId = (c.req.query("warehouseId") || "").trim();
  const requestedLimit = Number.parseInt(c.req.query("limit") || "60", 10);
  const requestedOffset = Number.parseInt(c.req.query("offset") || "0", 10);
  const limit = Math.min(
    Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 60, 1),
    100,
  );
  const offset = Math.max(
    Number.isFinite(requestedOffset) ? requestedOffset : 0,
    0,
  );

  const searchWhere = buildProductSearchWhere(search);
  const baseWhere = {
    deletedAt: null,
    isActive: true,
    ...(categoryId ? { categoryId } : {}),
  };
  const exactIds = search
    ? await findProductIdsByBarcode(search)
    : [];
  const exactBarcodeWhere =
    search && exactIds.length
      ? {
          ...baseWhere,
          id: { in: exactIds },
        }
      : null;
  const fuzzyWhere = {
    ...baseWhere,
    ...searchWhere,
    ...(exactIds.length ? { id: { notIn: exactIds } } : {}),
  };
  const where = search ? fuzzyWhere : baseWhere;
  const facetWhere = {
    deletedAt: null,
    isActive: true,
    ...searchWhere,
  };

  const exactCount = exactIds.length;
  const exactSkip = Math.min(offset, exactCount);
  const exactTake = Math.max(0, Math.min(limit, exactCount - exactSkip));
  const fuzzySkip = Math.max(0, offset - exactCount);
  const fuzzyTake = Math.max(0, limit - exactTake);

  const [exactRows, fuzzyRows, fuzzyTotal, categoryRows] = await Promise.all([
    exactBarcodeWhere && exactTake > 0
      ? prisma.product.findMany({
          where: exactBarcodeWhere,
          include: {
            category: true,
            baseUnit: true,
            defaultWarehouse: true,
            units: {
              include: {
                unit: true,
              },
            },
          },
          orderBy: [{ barcodeNormalized: "asc" }, { name: "asc" }],
          skip: exactSkip,
          take: exactTake,
        })
      : [],
    fuzzyTake > 0
      ? prisma.product.findMany({
          where,
          include: {
            category: true,
            baseUnit: true,
            defaultWarehouse: true,
            units: {
              include: {
                unit: true,
              },
            },
          },
          orderBy: [{ name: "asc" }, { createdAt: "desc" }],
          skip: fuzzySkip,
          take: fuzzyTake,
        })
      : [],
    prisma.product.count({ where }),
    prisma.product.groupBy({
      by: ["categoryId"],
      where: facetWhere,
      _count: { _all: true },
    }),
  ]);
  const items = [...exactRows, ...fuzzyRows];
  const total = exactCount + fuzzyTotal;
  const productIds = items.map((item) => item.id);
  const stockRows = productIds.length
    ? await prisma.stockBalance.groupBy({
        by: ["productId"],
        where: {
          productId: { in: productIds },
          ...(warehouseId ? { warehouseId } : {}),
        },
        _sum: { quantityBase: true },
      })
    : [];
  const stockByProductId = new Map(
    stockRows.map((row) => [row.productId, Number(row._sum.quantityBase || 0)]),
  );
  const categoryIds = categoryRows
    .map((row) => row.categoryId)
    .filter((id): id is string => Boolean(id));
  const categories = categoryIds.length
    ? await prisma.productCategory.findMany({
        where: { id: { in: categoryIds }, deletedAt: null, isActive: true },
        select: { id: true, name: true },
      })
    : [];
  const categoryNameById = new Map(
    categories.map((item) => [item.id, item.name]),
  );
  const facets = categoryRows
    .filter((row) => row.categoryId && categoryNameById.has(row.categoryId))
    .map((row) => ({
      id: row.categoryId as string,
      name: categoryNameById.get(row.categoryId as string) || "",
      count: row._count._all,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const payload = {
    data: items.map((item) => ({
      ...item,
      totalStock: stockByProductId.get(item.id) || 0,
    })),
    pagination: {
      offset,
      limit,
      total,
      hasMore: offset + items.length < total,
      nextOffset: offset + items.length,
    },
    facets: {
      categories: facets,
    },
  };

  return c.json({ ...payload, cache: "miss" });
});

productsRoute.get("/barcode-lookup", async (c) => {
  const barcode = (c.req.query("barcode") || "").trim();
  const warehouseId = (c.req.query("warehouseId") || "").trim();

  if (!barcode) {
    return c.json({ message: "Barcode is required" }, 400);
  }

  const normalizedBarcode = normalizeBarcodeText(barcode);
  const productIds = await findProductIdsByBarcode(barcode);
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        include: productLookupInclude,
      })
    : [];
  const productById = new Map(products.map((product) => [product.id, product]));
  const orderedProducts = productIds
    .map((id) => productById.get(id))
    .filter((product): product is NonNullable<typeof product> => Boolean(product));
  const stockRows = orderedProducts.length
    ? await prisma.stockBalance.groupBy({
        by: ["productId"],
        where: {
          productId: { in: orderedProducts.map((product) => product.id) },
          ...(warehouseId ? { warehouseId } : {}),
        },
        _sum: { quantityBase: true },
      })
    : [];
  const stockByProductId = new Map(
    stockRows.map((row) => [row.productId, Number(row._sum.quantityBase || 0)]),
  );
  const candidates = orderedProducts.map((product) => ({
    ...product,
    totalStock: stockByProductId.get(product.id) || 0,
  }));
  const status = barcodeLookupStatus(candidates.length);

  return c.json({
    status,
    normalizedBarcode,
    data: status === "FOUND" ? candidates[0] : null,
    candidates,
  });
});

productsRoute.get("/barcode-duplicates", async (c) => {
  if (!isAdminUser(c)) {
    return c.json({ message: "این ابزار فقط برای مدیر سیستم قابل استفاده است" }, 403);
  }

  const rows = await prisma.$queryRaw<
    Array<{
      normalized: string;
      count: number;
      products: Array<{ id: string; name: string; barcode: string | null }>;
    }>
  >`
    WITH normalized AS (
      SELECT
        id,
        name,
        barcode,
        NULLIF(
          replace(
            replace(
              replace(
                replace(
                  regexp_replace(
                    translate(
                      COALESCE(barcode, ''),
                      '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩',
                      '01234567890123456789'
                    ),
                    '[-[:space:]]+',
                    '',
                    'g'
                  ),
                  chr(8203),
                  ''
                ),
                chr(8204),
                ''
              ),
              chr(8205),
              ''
            ),
            chr(8288),
            ''
          ),
          ''
        ) AS normalized
      FROM "Product"
      WHERE barcode IS NOT NULL AND "deletedAt" IS NULL
    )
    SELECT
      normalized,
      COUNT(*)::int AS count,
      json_agg(
        json_build_object('id', id, 'name', name, 'barcode', barcode)
        ORDER BY name
      ) AS products
    FROM normalized
    WHERE normalized IS NOT NULL
    GROUP BY normalized
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, normalized ASC
  `;

  return c.json({ data: rows });
});

productsRoute.get("/pos-data-quality", async (c) => {
  if (!isAdminUser(c)) {
    return c.json({ message: "این گزارش فقط برای مدیر سیستم قابل استفاده است" }, 403);
  }

  const limit = Math.min(Math.max(Number(c.req.query("limit") || 200), 1), 1000);
  const products = await prisma.product.findMany({
    where: { deletedAt: null, isActive: true },
    select: {
      id: true,
      name: true,
      barcode: true,
      baseUnitId: true,
      units: {
        select: {
          unitId: true,
          salePrice: true,
          isDefaultSale: true,
          unit: { select: { name: true, shortName: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const saleUnitIssues = products.flatMap((product) => {
    const defaultUnits = product.units.filter((unit) => unit.isDefaultSale);
    const baseUnit = product.units.find((unit) => unit.unitId === product.baseUnitId) || null;
    const defaultUnit = defaultUnits.length === 1 ? defaultUnits[0] : null;
    const defaultPriceIsValid = Number(defaultUnit?.salePrice || 0) > 0;
    const basePriceIsValid = Number(baseUnit?.salePrice || 0) > 0;
    const reason =
      defaultUnits.length > 1
        ? "چند واحد فروش پیش‌فرض دارد"
        : defaultUnits.length === 0
          ? "واحد فروش پیش‌فرض ندارد"
          : !defaultPriceIsValid
            ? "قیمت واحد فروش پیش‌فرض معتبر نیست"
            : null;

    if (!reason) return [];
    return [{
      id: product.id,
      name: product.name,
      barcode: product.barcode,
      reason,
      fallbackToBaseUnitIsSafe: basePriceIsValid,
      baseUnit: baseUnit
        ? {
            unitId: baseUnit.unitId,
            unitName: baseUnit.unit.shortName || baseUnit.unit.name,
            salePrice: Number(baseUnit.salePrice || 0),
          }
        : null,
      defaultSaleUnitCount: defaultUnits.length,
    }];
  });

  return c.json({
    data: saleUnitIssues.slice(0, limit),
    summary: {
      saleUnitIssues: saleUnitIssues.length,
      returned: Math.min(saleUnitIssues.length, limit),
      truncated: saleUnitIssues.length > limit,
    },
  });
});

productsRoute.get("/merge-preview", async (c) => {
  if (!isAdminUser(c)) {
    return c.json({ message: "این ابزار فقط برای مدیر سیستم قابل استفاده است" }, 403);
  }

  const sourceId = (c.req.query("sourceId") || "").trim();
  const targetId = (c.req.query("targetId") || "").trim();
  if (!sourceId || !targetId) {
    return c.json({ message: "محصول مبدا و مقصد ضروری است" }, 400);
  }

  const candidates = await prisma.$transaction((tx) =>
    loadProductMergeCandidates(tx, sourceId, targetId),
  );
  if (!candidates.source || !candidates.target) {
    return c.json({ message: "یکی از محصولات پیدا نشد" }, 404);
  }

  return c.json({
    data: buildProductMergePreview(
      candidates.source,
      candidates.target,
      candidates.normalizedOwner,
    ),
  });
});

productsRoute.post("/merge", async (c) => {
  const authUser = getAuthUser(c);
  if (authUser?.role !== "Admin") {
    return c.json({ message: "این ابزار فقط برای مدیر سیستم قابل استفاده است" }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = mergeProductSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const { sourceId, targetId } = parsed.data;
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(Prisma.sql`
          SELECT id
          FROM "Product"
          WHERE id IN (${Prisma.join([sourceId, targetId])})
          ORDER BY id
          FOR UPDATE
        `);

        const candidates = await loadProductMergeCandidates(tx, sourceId, targetId);
        if (!candidates.source || !candidates.target) {
          return { status: "NOT_FOUND" as const };
        }

        const preview = buildProductMergePreview(
          candidates.source,
          candidates.target,
          candidates.normalizedOwner,
        );
        if (!preview.canMerge) {
          return { status: "BLOCKED" as const, preview };
        }

        const affectedWarehouses = await tx.stockLot.findMany({
          where: { productId: { in: [sourceId, targetId] } },
          distinct: ["warehouseId"],
          select: { warehouseId: true },
        });
        const inventory = new InventoryMutationService(tx);
        await inventory.lock(
          affectedWarehouses.flatMap(({ warehouseId }) => [
            { productId: sourceId, warehouseId },
            { productId: targetId, warehouseId },
          ]),
        );

        // StockBalance is a database-maintained projection of StockLot. Moving
        // the lots lets the stock trigger rebuild both products atomically.
        await tx.stockLot.updateMany({
          where: { productId: sourceId },
          data: { productId: targetId },
        });
        await tx.stockMovement.updateMany({
          where: { productId: sourceId },
          data: { productId: targetId },
        });
        await tx.purchaseItem.updateMany({
          where: { productId: sourceId },
          data: { productId: targetId },
        });
        await tx.purchaseReturnItem.updateMany({
          where: { productId: sourceId },
          data: { productId: targetId },
        });
        await tx.saleItem.updateMany({
          where: { productId: sourceId },
          data: { productId: targetId },
        });
        await tx.saleReturnItem.updateMany({
          where: { productId: sourceId },
          data: { productId: targetId },
        });
        await tx.productUnit.deleteMany({ where: { productId: sourceId } });

        await tx.product.update({
          where: { id: sourceId },
          data: {
            barcode: null,
            barcodeNormalized: null,
            sku: null,
            ...auditDeleteData(authUser.id),
          },
        });
        await tx.product.update({
          where: { id: targetId },
          data: {
            barcodeNormalized: preview.normalizedBarcode,
            ...auditUpdateData(authUser.id),
          },
        });
        await tx.auditLog.create({
          data: {
            userId: authUser.id,
            action: "PRODUCT_MERGED",
            entityType: "Product",
            entityId: targetId,
            description: `Product ${sourceId} merged into ${targetId}`,
            metadata: {
              sourceId,
              targetId,
              normalizedBarcode: preview.normalizedBarcode,
              sourceCounts: preview.source.counts,
              combined: preview.combined,
              warnings: preview.warnings,
            },
            ipAddress: c.req.header("x-forwarded-for") || null,
            userAgent: c.req.header("user-agent") || null,
          },
        });

        return { status: "MERGED" as const, preview };
      },
      { isolationLevel: "Serializable" },
    );

    if (result.status === "NOT_FOUND") {
      return c.json({ message: "یکی از محصولات پیدا نشد" }, 404);
    }
    if (result.status === "BLOCKED") {
      return c.json(
        {
          message: "این دو محصول با شرایط امن قابل ادغام نیست",
          data: result.preview,
        },
        409,
      );
    }

    await cacheDeleteByPattern("pos:products:*");
    return c.json({
      message: "محصولات با موفقیت ادغام شدند",
      data: {
        sourceId,
        targetId,
        preview: result.preview,
      },
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      ["P2002", "P2034"].includes(String((error as { code?: string }).code))
    ) {
      return c.json(
        {
          message:
            "اطلاعات هم‌زمان تغییر کرده است؛ صفحه را تازه کنید و preview را دوباره بررسی کنید",
        },
        409,
      );
    }
    throw error;
  }
});

productsRoute.get("/:id", async (c) => {
  const id = c.req.param("id");

  const item = await prisma.product.findUnique({
    where: { id },
    include: {
      category: true,
      baseUnit: true,
      defaultWarehouse: true,
      units: {
        include: {
          unit: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!item || item.deletedAt) {
    return c.json({ message: "Product not found" }, 404);
  }

  return c.json({ data: await attachAuditUsers(item) });
});

productsRoute.post("/", async (c) => {
  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => null);
  const parsed = createProductSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const { units, ...productData } = parsed.data;
  const unitValidationMessage = defaultSaleUnitValidationMessage(units);
  if (unitValidationMessage) {
    return c.json({ message: unitValidationMessage }, 400);
  }
  const barcode = await resolveProductBarcode(productData.barcode);
  const barcodeNormalized = normalizeBarcodeText(barcode);
  await ensureBarcodeIsAvailable(barcode);

  let item;
  try {
    item = await prisma.product.create({
      data: {
        ...productData,
        barcode,
        barcodeNormalized,
        ...auditCreateData(authUser?.id),
        units: {
          create: units.map((unit) => ({
            unitId: unit.unitId,
            conversionRate: unit.conversionRate,
            purchasePrice: unit.purchasePrice ?? null,
            salePrice: unit.salePrice ?? null,
            isDefaultPurchase: unit.isDefaultPurchase ?? false,
            isDefaultSale: unit.isDefaultSale ?? false,
          })),
        },
      },
      include: {
        category: true,
        baseUnit: true,
        defaultWarehouse: true,
        units: {
          include: {
            unit: true,
          },
        },
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return c.json({ message: duplicateBarcodeMessage(barcode) }, 409);
    }
    throw error;
  }

  await writeAudit(c, {
    action: "PRODUCT_CREATED",
    entityType: "Product",
    entityId: item.id,
    metadata: { name: item.name, barcode: item.barcode, sku: item.sku },
  });
  await cacheDeleteByPattern("pos:products:*");

  return c.json({ data: item }, 201);
});

productsRoute.patch("/:id", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = updateProductSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const { units, ...productData } = parsed.data;
  if (units) {
    const unitValidationMessage = defaultSaleUnitValidationMessage(units);
    if (unitValidationMessage) {
      return c.json({ message: unitValidationMessage }, 400);
    }
  }
  const nextBarcode = Object.prototype.hasOwnProperty.call(productData, "barcode")
    ? await resolveProductBarcode(productData.barcode)
    : undefined;
  const nextProductData = {
    ...productData,
    ...(nextBarcode
      ? {
          barcode: nextBarcode,
          barcodeNormalized: normalizeBarcodeText(nextBarcode),
        }
      : {}),
  };

  if (nextProductData.barcode) {
    await ensureBarcodeIsAvailable(nextProductData.barcode, id);
  }

  let item;
  try {
    item = await prisma.$transaction(async (tx) => {
      await acquireTransactionLock(tx, "product-definition", id);
      const existing = await tx.product.findUnique({
        where: { id },
        include: { units: true }
      });
      if (!existing || existing.deletedAt) {
        throw new Error("محصول پیدا نشد.");
      }

      const history = await tx.stockLot.findFirst({
        where: { productId: id },
        select: { id: true }
      });
      if (
        history &&
        nextProductData.baseUnitId &&
        nextProductData.baseUnitId !== existing.baseUnitId
      ) {
        throw new Error(
          "واحد پایه محصول دارای سابقه موجودی قابل تغییر نیست؛ بسته‌بندی تازه را به‌عنوان واحد جدید اضافه کنید."
        );
      }

      if (units && history) {
        const purchaseUnits = await tx.purchaseItem.findMany({
          where: { productId: id },
          distinct: ["unitId"],
          select: { unitId: true }
        });
        const saleUnits = await tx.saleItem.findMany({
          where: { productId: id },
          distinct: ["unitId"],
          select: { unitId: true }
        });
        const usedUnitIds = new Set([
          existing.baseUnitId,
          ...purchaseUnits.map((item) => item.unitId),
          ...saleUnits.map((item) => item.unitId)
        ]);
        const existingRates = new Map(
          existing.units.map((unit) => [
            unit.unitId,
            Number(unit.conversionRate)
          ])
        );
        const nextRates = new Map(
          units.map((unit) => [unit.unitId, Number(unit.conversionRate)])
        );
        for (const unitId of usedUnitIds) {
          if (unitId === existing.baseUnitId) continue;
          const previousRate = existingRates.get(unitId);
          const nextRate = nextRates.get(unitId);
          if (previousRate === undefined || nextRate === undefined || previousRate !== nextRate) {
            throw new Error(
              "نرخ تبدیل واحد استفاده‌شده در معاملات قابل تغییر یا حذف نیست؛ واحد بسته‌بندی جدید بسازید."
            );
          }
        }
      }

      if (units) {
        await tx.productUnit.deleteMany({
          where: { productId: id },
        });
      }

      return tx.product.update({
        where: { id },
        data: {
          ...nextProductData,
          ...auditUpdateData(authUser?.id),
          ...(units
            ? {
                units: {
                  create: units.map((unit) => ({
                    unitId: unit.unitId,
                    conversionRate: unit.conversionRate,
                    purchasePrice: unit.purchasePrice ?? null,
                    salePrice: unit.salePrice ?? null,
                    isDefaultPurchase: unit.isDefaultPurchase ?? false,
                    isDefaultSale: unit.isDefaultSale ?? false,
                  })),
                },
              }
            : {}),
        },
        include: {
          category: true,
          baseUnit: true,
          defaultWarehouse: true,
          units: {
            include: {
              unit: true,
            },
          },
        },
      });
    });
  } catch (error) {
    if (isUniqueConstraintError(error) && nextProductData.barcode) {
      return c.json(
        { message: duplicateBarcodeMessage(nextProductData.barcode) },
        409,
      );
    }
    throw error;
  }

  await writeAudit(c, {
    action: "PRODUCT_UPDATED",
    entityType: "Product",
    entityId: item.id,
    metadata: { name: item.name, barcode: item.barcode, sku: item.sku },
  });
  await cacheDeleteByPattern("pos:products:*");

  return c.json({ data: item });
});

productsRoute.post("/:id/image", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");
  const body = await c.req.parseBody();
  const file = body.file as any;

  if (
    !file ||
    typeof file === "string" ||
    typeof file.arrayBuffer !== "function"
  ) {
    return c.json({ message: "عکس محصول ضروری است" }, 400);
  }

  const mimeType = String(file.type || "");
  if (!imageMimeTypes.has(mimeType)) {
    return c.json({ message: "فقط فایل عکس قابل آپلود است" }, 400);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const maxSize = 5 * 1024 * 1024;
  if (buffer.byteLength > maxSize) {
    return c.json({ message: "حجم عکس باید کمتر از ۵MB باشد" }, 400);
  }

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product || product.deletedAt) {
    return c.json({ message: "Product not found" }, 404);
  }

  const uploadDir = path.join(process.cwd(), "uploads", "products");
  await mkdir(uploadDir, { recursive: true });

  const originalName = String(file.name || "product-image.png");
  const ext = productImageExtension(mimeType, originalName);
  const fileName = `${id}-${Date.now()}${ext}`;
  await writeFile(path.join(uploadDir, fileName), buffer);

  const imageUrl = `/uploads/products/${fileName}`;
  const updated = await prisma.product.update({
    where: { id },
    data: {
      imageUrl,
      ...auditUpdateData(authUser?.id),
    },
    include: {
      category: true,
      baseUnit: true,
      defaultWarehouse: true,
      units: {
        include: {
          unit: true,
        },
      },
    },
  });

  await writeAudit(c, {
    action: "PRODUCT_IMAGE_UPLOADED",
    entityType: "Product",
    entityId: id,
    metadata: { imageUrl },
  });
  await cacheDeleteByPattern("pos:products:*");

  return c.json({ data: updated });
});

productsRoute.delete("/:id", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");

  const [
    stockLots,
    stockMovements,
    purchaseItems,
    purchaseReturnItems,
    saleItems,
    saleReturnItems,
  ] = await Promise.all([
    prisma.stockLot.count({ where: { productId: id } }),
    prisma.stockMovement.count({ where: { productId: id } }),
    prisma.purchaseItem.count({ where: { productId: id } }),
    prisma.purchaseReturnItem.count({ where: { productId: id } }),
    prisma.saleItem.count({ where: { productId: id } }),
    prisma.saleReturnItem.count({ where: { productId: id } }),
  ]);
  const usageCount =
    stockLots +
    stockMovements +
    purchaseItems +
    purchaseReturnItems +
    saleItems +
    saleReturnItems;

  if (usageCount > 0) {
    return c.json(
      {
        message:
          "این محصول در موجودی، خرید یا فروش استفاده شده است و قابل حذف نیست. اگر لازم است، آن را غیرفعال کنید.",
        usage: {
          stockLots,
          stockMovements,
          purchaseItems,
          purchaseReturnItems,
          saleItems,
          saleReturnItems,
        },
      },
      400,
    );
  }

  const item = await prisma.product.update({
    where: { id },
    data: auditDeleteData(authUser?.id),
  });

  await writeAudit(c, {
    action: "PRODUCT_DELETED",
    entityType: "Product",
    entityId: item.id,
    metadata: { name: item.name, barcode: item.barcode, sku: item.sku },
  });
  await cacheDeleteByPattern("pos:products:*");

  return c.json({ message: "Product deactivated", data: item });
});
