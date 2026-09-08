import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import { getAuthUser, writeAudit } from "../../lib/auth";
import { normalizeBarcodeText } from "../../lib/barcode";
import { resolveCurrencySnapshot, snapshotBaseFields, toBaseAmount } from "../../lib/currency-rates";
import { createPostedJournal, createReversalJournal, treasuryAccountCode } from "../../lib/journal";
import { getRequestPosDevice } from "../../lib/pos-device";
import { createPaginationMeta, getPagePagination } from "../../lib/pagination";
import { getRecentDateRange } from "../../lib/recent-date-range";
import { kabulNow, parseKabulDateInput } from "../../lib/kabul-date";
import { ensureSaleCogsJournal, isUniqueConstraintError } from "../../lib/sale-cogs";
import {
  allocateMoneyByWeight,
  decorateSaleItemsWithPricing,
  roundMoney4,
} from "../../lib/sale-pricing";
import { findProductIdsByBarcode } from "../../lib/product-barcode-lookup";
import { Prisma } from "../../generated/prisma/client";
import {
  MoneyDirection,
  MoneyTransactionType,
  PartyAccountSide,
  PartyTransactionType,
  PartyType,
  SalePaymentStatus,
  SaleStatus,
  StockMovementType
} from "../../generated/prisma/enums";
import { acquireTransactionLock } from "../../lib/db-lock";
import {
  InventoryMutationService,
  requestOperationId
} from "../../lib/inventory-mutation";
import { inventoryOperationEvidence } from "../../lib/request-evidence";
import { roundStockQuantity, stockDecimal } from "../../lib/stock-quantity";

export const salesRoute = new Hono();

const paymentAccountTypeSchema = z.enum(["CASH", "BANK"]);

const paymentLineSchema = z.object({
  paymentAccountType: paymentAccountTypeSchema,
  paymentAccountId: z.string().trim().min(1),
  amount: z.coerce.number().positive()
});

const saleItemSchema = z.object({
  productId: z.string().min(1),
  warehouseId: z.string().min(1),
  unitId: z.string().min(1),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().nonnegative(),
  discount: z.coerce.number().nonnegative().default(0),
  lotId: z.string().trim().optional().nullable()
});

const createSaleSchema = z.object({
  clientRequestId: z.string().trim().min(8).max(100).optional().nullable(),
  invoiceNo: z.string().trim().max(120).optional().nullable(),
  customerId: z.string().trim().optional().nullable(),
  currencyId: z.string().min(1),
  saleDate: z.string().trim().optional().nullable(),
  discount: z.coerce.number().nonnegative().default(0),
  paidAmount: z.coerce.number().nonnegative().default(0),
  paymentAccountType: paymentAccountTypeSchema.optional().nullable(),
  paymentAccountId: z.string().trim().optional().nullable(),
  paymentLines: z.array(paymentLineSchema).optional().default([]),
  note: z.string().trim().max(500).optional().nullable(),
  items: z.array(saleItemSchema).min(1)
});

const saleResponseInclude = {
  customer: true,
  currency: true,
  cashier: true,
  posDevice: true,
  items: {
    include: {
      product: true,
      warehouse: true,
      unit: true,
      lot: true
    }
  }
} as const;

class SaleRequestOwnershipError extends Error {}
class SaleIdempotentReplayError extends Error {}

async function loadIdempotentSaleResult(
  clientRequestId: string,
  requestingUserId: string | null
) {
  const sale = await prisma.sale.findUnique({
    where: { clientRequestId },
    include: saleResponseInclude
  });

  if (!sale) return null;

  if (sale.cashierId && sale.cashierId !== requestingUserId) {
    throw new SaleRequestOwnershipError("This sale request ID belongs to another user");
  }

  const [moneyTransactions, customerTransaction, journalEntry, cogsJournal] =
    await Promise.all([
      prisma.moneyTransaction.findMany({
        where: {
          referenceType: "SALE",
          referenceId: sale.id,
          direction: MoneyDirection.IN
        }
      }),
      prisma.partyTransaction.findFirst({
        where: {
          referenceType: "SALE",
          referenceId: sale.id,
          type: PartyTransactionType.SALE_CREDIT
        }
      }),
      prisma.journalEntry.findFirst({
        where: { sourceType: "POS_SALE", sourceId: sale.id },
        include: {
          lines: {
            include: { account: true, party: true }
          }
        }
      }),
      prisma.journalEntry.findFirst({
        where: { sourceType: "POS_SALE_COGS", sourceId: sale.id },
        include: {
          lines: {
            include: { account: true, party: true }
          }
        }
      })
    ]);

  return {
    sale: {
      ...sale,
      items: decorateSaleItemsWithPricing(sale.discount, sale.items),
    },
    items: decorateSaleItemsWithPricing(sale.discount, sale.items),
    moneyTransactions,
    customerTransaction,
    journalEntry,
    cogsJournal,
    idempotentReplay: true
  };
}

const salePaymentSchema = z.object({
  amount: z.coerce.number().positive(),
  paymentAccountType: paymentAccountTypeSchema,
  paymentAccountId: z.string().trim().min(1),
  note: z.string().trim().max(500).optional().nullable()
});

const cancelSaleSchema = z.object({
  reason: z.string().trim().max(500).optional().nullable()
});

const repairSaleCogsSchema = z.object({
  confirm: z.literal(true)
});

function parseDate(value: string | null | undefined) {
  if (!value) return null;

  const date = parseKabulDateInput(value);

  if (!date || date === "INVALID_DATE" || Number.isNaN(date.getTime())) {
    return "INVALID_DATE";
  }

  return date;
}

salesRoute.get("/", async (c) => {
  const customerId = c.req.query("customerId");
  const search = c.req.query("search")?.trim();
  const pagination = getPagePagination(c);
  const saleDate = getRecentDateRange(c);
  const where = {
    ...(customerId ? { customerId } : {}),
    saleDate,
    ...(search
      ? {
          OR: [
            { invoiceNo: { contains: search, mode: "insensitive" as const } },
            { note: { contains: search, mode: "insensitive" as const } },
            { customer: { name: { contains: search, mode: "insensitive" as const } } },
            { customer: { phone: { contains: search, mode: "insensitive" as const } } },
            { customer: { code: { contains: search, mode: "insensitive" as const } } },
            { items: { some: { product: { name: { contains: search, mode: "insensitive" as const } } } } },
            { items: { some: { product: { barcode: { contains: search, mode: "insensitive" as const } } } } },
            { items: { some: { product: { barcodeNormalized: { contains: normalizeBarcodeText(search), mode: "insensitive" as const } } } } },
          ],
        }
      : {})
  };

  const [items, total, summary] = await Promise.all([
    prisma.sale.findMany({
    where,
    include: {
      customer: true,
      currency: true,
      items: {
        include: {
          product: true,
          warehouse: true,
          unit: true,
          lot: true,
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    skip: pagination.skip,
    take: pagination.limit
  }),
    prisma.sale.count({ where }),
    prisma.sale.aggregate({
      where: { ...where, status: { not: SaleStatus.CANCELLED } },
      _count: true,
      _sum: { baseTotal: true, basePaidAmount: true, baseRemainingAmount: true }
    })
  ]);

  const cogsEntries = items.length
    ? await prisma.journalEntry.findMany({
        where: {
          sourceType: "POS_SALE_COGS",
          sourceId: { in: items.map((item) => item.id) }
        },
        select: {
          sourceId: true,
          _count: { select: { lines: true } }
        }
      })
    : [];
  const cogsBySaleId = new Map(
    cogsEntries.map((entry) => [entry.sourceId, entry._count.lines])
  );

  return c.json({
    data: items.map((item) => ({
      ...item,
      items: decorateSaleItemsWithPricing(item.discount, item.items),
      cogsStatus: !cogsBySaleId.has(item.id)
        ? "MISSING"
        : Number(cogsBySaleId.get(item.id) || 0) === 0
          ? "ZERO_COST"
          : "POSTED"
    })),
    pagination: createPaginationMeta({ ...pagination, total }),
    summary: {
      count: summary._count,
      total: Number(summary._sum.baseTotal || 0),
      paid: Number(summary._sum.basePaidAmount || 0),
      remaining: Number(summary._sum.baseRemainingAmount || 0)
    }
  });
});

salesRoute.get("/cogs-quality", async (c) => {
  const pagination = getPagePagination(c);
  const fromValue = c.req.query("from")?.trim();
  const toValue = c.req.query("to")?.trim();
  const fromDate = fromValue ? parseDate(fromValue) : null;
  const toDate = toValue ? parseDate(toValue) : null;
  const toExclusive = toValue ? parseKabulDateInput(toValue, true) : null;

  if (
    fromDate === "INVALID_DATE" ||
    toDate === "INVALID_DATE" ||
    toExclusive === "INVALID_DATE"
  ) {
    return c.json({ message: "Invalid COGS quality date range" }, 400);
  }

  const filters: Prisma.Sql[] = [
    Prisma.sql`s."status"::text <> 'CANCELLED'`,
    Prisma.sql`NOT EXISTS (
      SELECT 1
      FROM "JournalEntry" j
      WHERE j."sourceType" = 'POS_SALE_COGS'
        AND j."sourceId" = s."id"
    )`
  ];

  if (fromDate instanceof Date) {
    filters.push(Prisma.sql`s."saleDate" >= ${fromDate}`);
  }

  if (toExclusive instanceof Date) {
    filters.push(Prisma.sql`s."saleDate" < ${toExclusive}`);
  }

  const whereSql = Prisma.join(filters, " AND ");
  const [summaryRows, rows] = await Promise.all([
    prisma.$queryRaw<Array<{ count: number; baseTotal: unknown }>>(Prisma.sql`
      SELECT
        COUNT(*)::int AS "count",
        COALESCE(SUM(s."baseTotal"), 0) AS "baseTotal"
      FROM "Sale" s
      WHERE ${whereSql}
    `),
    prisma.$queryRaw<Array<{
      id: string;
      invoiceNo: string | null;
      saleDate: Date;
      createdAt: Date;
      customerName: string | null;
      currencyCode: string;
      total: unknown;
      baseTotal: unknown;
      cogsTotal: unknown;
    }>>(Prisma.sql`
      SELECT
        s."id",
        s."invoiceNo",
        s."saleDate",
        s."createdAt",
        p."name" AS "customerName",
        c."code" AS "currencyCode",
        s."total",
        s."baseTotal",
        COALESCE(SUM(COALESCE(si."baseTotalCost", si."totalCost", 0)), 0) AS "cogsTotal"
      FROM "Sale" s
      LEFT JOIN "SaleItem" si ON si."saleId" = s."id"
      LEFT JOIN "Party" p ON p."id" = s."customerId"
      JOIN "Currency" c ON c."id" = s."currencyId"
      WHERE ${whereSql}
      GROUP BY s."id", p."name", c."code"
      ORDER BY s."saleDate" DESC, s."createdAt" DESC, s."id" DESC
      LIMIT ${pagination.limit}
      OFFSET ${pagination.skip}
    `)
  ]);
  const total = Number(summaryRows[0]?.count || 0);

  return c.json({
    data: rows.map((row) => ({
      ...row,
      total: Number(row.total || 0),
      baseTotal: Number(row.baseTotal || 0),
      cogsTotal: Number(row.cogsTotal || 0)
    })),
    pagination: createPaginationMeta({ ...pagination, total }),
    summary: {
      missingCount: total,
      baseSalesTotal: Number(summaryRows[0]?.baseTotal || 0)
    }
  });
});

salesRoute.get("/scan/:barcode", async (c) => {
  const barcode = normalizeBarcodeText(c.req.param("barcode"));
  const warehouseId = c.req.query("warehouseId");
  const productIds = await findProductIdsByBarcode(c.req.param("barcode"));

  if (productIds.length > 1) {
    const candidateRows = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, barcode: true, sku: true, isActive: true },
    });
    const candidateById = new Map(candidateRows.map((candidate) => [candidate.id, candidate]));
    const candidates = productIds
      .map((id) => candidateById.get(id))
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));

    return c.json(
      {
        status: "AMBIGUOUS",
        message: "این بارکود به چند محصول مربوط است؛ محصول درست را انتخاب کنید",
        candidates,
      },
      409,
    );
  }

  const product = productIds[0]
    ? await prisma.product.findUnique({
        where: { id: productIds[0] },
        include: {
          baseUnit: true,
          units: {
            include: {
              unit: true,
            },
          },
        },
      })
    : null;

  if (!product) {
    return c.json({ message: "محصولی با این بارکود ثبت نشده است" }, 404);
  }

  if (product.deletedAt || !product.isActive) {
    return c.json(
      {
        message: product.deletedAt
          ? "این محصول حذف شده و قابل فروش نیست"
          : "این محصول غیرفعال است و قابل فروش نیست",
      },
      409,
    );
  }

  const lots = await prisma.stockLot.findMany({
    where: {
      productId: product.id,
      remainingQuantity: {
        gt: 0
      },
      ...(warehouseId ? { warehouseId } : {})
    },
    include: {
      warehouse: true
    },
    orderBy: [
      { expiryDate: "asc" },
      { createdAt: "asc" },
      { id: "asc" }
    ]
  });

  const totalStock = lots.reduce((sum, lot) => sum + Number(lot.remainingQuantity), 0);

  if (totalStock <= 0) {
    return c.json(
      {
        message: warehouseId
          ? "این محصول در گدام انتخاب‌شده موجودی قابل فروش ندارد"
          : "موجودی این محصول تمام شده است",
        data: {
          product,
          totalStock,
          lots,
        },
      },
      409,
    );
  }

  return c.json({
    data: {
      product,
      totalStock,
      lots
    }
  });
});

salesRoute.get("/:id", async (c) => {
  const id = c.req.param("id");

  const item = await prisma.sale.findUnique({
    where: { id },
    include: {
      customer: true,
      currency: true,
      items: {
        include: {
          product: true,
          warehouse: true,
          unit: true,
          lot: true,
          returnItems: {
            include: {
              saleReturn: true,
            },
          },
        }
      }
    }
  });

  if (!item) {
    return c.json({ message: "Sale not found" }, 404);
  }

  const pricedItems = decorateSaleItemsWithPricing(item.discount, item.items).map(
    (saleItem) => {
      const activeReturns = saleItem.returnItems.filter(
        (returnItem) => !returnItem.saleReturn.cancelledAt,
      );
      const returnedQuantity = roundMoney4(
        activeReturns.reduce(
          (sum, returnItem) => sum + Number(returnItem.quantity || 0),
          0,
        ),
      );
      const returnedNetTotal = roundMoney4(
        activeReturns.reduce(
          (sum, returnItem) => sum + Number(returnItem.totalPrice || 0),
          0,
        ),
      );

      return {
        ...saleItem,
        returnedQuantity,
        returnableQuantity: Math.max(
          0,
          roundMoney4(Number(saleItem.quantity) - returnedQuantity),
        ),
        returnedNetTotal,
        returnableNetTotal: Math.max(
          0,
          roundMoney4(saleItem.effectiveNetTotalPrice - returnedNetTotal),
        ),
      };
    },
  );

  return c.json({ data: { ...item, items: pricedItems } });
});

salesRoute.post("/:id/repair-cogs", async (c) => {
  const authUser = getAuthUser(c);

  if (authUser?.role !== "Admin") {
    return c.json({ message: "Only Admin can repair historical COGS" }, 403);
  }

  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = repairSaleCogsSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      {
        message: "Explicit confirmation is required to repair this sale COGS",
        issues: zodError(parsed.error).issues
      },
      400
    );
  }

  const sale = await prisma.sale.findUnique({
    where: { id },
    select: { id: true, invoiceNo: true, status: true }
  });

  if (!sale) {
    return c.json({ message: "Sale not found" }, 404);
  }

  if (sale.status === SaleStatus.CANCELLED) {
    return c.json({ message: "COGS cannot be repaired for a cancelled sale" }, 409);
  }

  const repair = () =>
    prisma.$transaction((tx) =>
      ensureSaleCogsJournal(tx, {
        saleId: sale.id,
        invoiceNo: sale.invoiceNo,
        createdByUserId: authUser.id
      })
    );

  let result;

  try {
    result = await repair();
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    result = await repair();
  }

  if (!result.idempotentReplay) {
    await writeAudit(c, {
      action: "SALE_COGS_REPAIRED",
      entityType: "Sale",
      entityId: sale.id,
      metadata: {
        invoiceNo: sale.invoiceNo,
        cogsTotal: result.cogs.total,
        zeroCost: result.zeroCost
      }
    });
  }

  return c.json(
    {
      data: result.journalEntry,
      cogs: result.cogs,
      zeroCost: result.zeroCost,
      idempotentReplay: result.idempotentReplay,
      message: result.idempotentReplay
        ? "COGS journal already exists for this sale"
        : result.zeroCost
          ? "Sale was reviewed and marked as zero-cost"
          : "Historical sale COGS repaired"
    },
    result.idempotentReplay ? 200 : 201
  );
});

salesRoute.post("/:id/cancel", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = cancelSaleSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      items: true,
      returns: true
    }
  });

  if (!sale) {
    return c.json({ message: "Sale not found" }, 404);
  }

  if (sale.status === SaleStatus.CANCELLED) {
    return c.json({ message: "Sale is already cancelled" }, 400);
  }

  if (sale.returns.some((item) => !item.cancelledAt)) {
    return c.json({ message: "Sale has returns. Cancel the return workflow manually instead." }, 400);
  }

  const moneyTransactions = await prisma.moneyTransaction.findMany({
    where: {
      referenceId: sale.id,
      direction: MoneyDirection.IN
    }
  });

  const result = await prisma.$transaction(async (tx) => {
    await acquireTransactionLock(tx, "sale-document", sale.id);
    const currentSale = await tx.sale.findUnique({
      where: { id: sale.id },
      include: {
        returns: true,
        items: {
          include: { lot: true }
        }
      }
    });
    if (!currentSale || currentSale.status === SaleStatus.CANCELLED) {
      throw new Error("این فروش قبلاً ابطال شده است.");
    }
    if (currentSale.returns.some((item) => !item.cancelledAt)) {
      throw new Error("فروش دارای برگشتی فعال است و قابل ابطال نیست.");
    }

    const inventory = new InventoryMutationService(tx);
    await inventory.lock(
      currentSale.items.map((item) => ({
        productId: item.productId,
        warehouseId: item.warehouseId
      }))
    );
    const sourceMovement = await tx.stockMovement.findFirst({
      where: { referenceType: "SALE", referenceId: currentSale.id },
      select: { operationId: true }
    });

    for (const item of currentSale.items) {
      if (item.lotId) {
        await tx.stockLot.update({
          where: { id: item.lotId },
          data: {
            remainingQuantity: {
              increment: stockDecimal(Number(item.quantityBase))
            }
          }
        });
      }

      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          warehouseId: item.warehouseId,
          lotId: item.lotId,
          type: StockMovementType.SALE_RETURN,
          quantity: item.quantityBase,
          unitCost: item.unitCostBase,
          currencyId: item.lot?.currencyId ?? currentSale.currencyId,
          exchangeRate: item.lot?.exchangeRate ?? 1,
          baseUnitCost: item.lot?.baseUnitCost ?? item.unitCostBase,
          operationId: sourceMovement?.operationId ?? null,
          occurredAt: kabulNow(),
          referenceType: "SALE_CANCEL",
          referenceId: sale.id,
          note: parsed.data.reason ?? "Sale cancelled",
          createdByUserId: authUser?.id ?? null
        }
      });
    }

    if (sourceMovement?.operationId) {
      const changed = await tx.inventoryOperation.updateMany({
        where: {
          id: sourceMovement.operationId,
          status: "COMPLETED",
          cancelledAt: null
        },
        data: {
          status: "CANCELLED",
          cancelledAt: kabulNow(),
          cancelReason: parsed.data.reason ?? null,
          cancelledByUserId: authUser?.id ?? null
        }
      });
      if (changed.count !== 1) {
        throw new Error("این فروش هم‌زمان ابطال شده است.");
      }
    }

    for (const transaction of moneyTransactions) {
      const amount = Number(transaction.amount);

      if (transaction.cashRegisterAccountId) {
        const account = await tx.cashRegisterAccount.findUnique({
          where: { id: transaction.cashRegisterAccountId }
        });

        if (!account || Number(account.balance) < amount) {
          throw new Error("Not enough cash balance to cancel this sale");
        }

        const updated = await tx.cashRegisterAccount.update({
          where: { id: transaction.cashRegisterAccountId },
          data: { balance: { decrement: amount } }
        });

        await tx.moneyTransaction.create({
          data: {
            currencyId: transaction.currencyId,
            cashRegisterAccountId: transaction.cashRegisterAccountId,
            type: MoneyTransactionType.ADJUSTMENT,
            direction: MoneyDirection.OUT,
            amount,
            balanceAfter: updated.balance,
            exchangeRate: Number(transaction.exchangeRate || 1),
            baseCurrencyId: transaction.baseCurrencyId,
            baseAmount: toBaseAmount(amount, {
              exchangeRate: Number(transaction.exchangeRate || 1),
              baseCurrencyId: transaction.baseCurrencyId
            }),
            baseBalanceAfter: toBaseAmount(Number(updated.balance), {
              exchangeRate: Number(transaction.exchangeRate || 1),
              baseCurrencyId: transaction.baseCurrencyId
            }),
            referenceType: "SALE_CANCEL",
            referenceId: sale.id,
            note: parsed.data.reason ?? "Sale cancellation",
            createdByUserId: authUser?.id ?? null
          }
        });
      }

      if (transaction.bankAccountId) {
        const account = await tx.bankAccount.findUnique({
          where: { id: transaction.bankAccountId }
        });

        if (!account || Number(account.balance) < amount) {
          throw new Error("Not enough bank balance to cancel this sale");
        }

        const updated = await tx.bankAccount.update({
          where: { id: transaction.bankAccountId },
          data: { balance: { decrement: amount } }
        });

        await tx.moneyTransaction.create({
          data: {
            currencyId: transaction.currencyId,
            bankAccountId: transaction.bankAccountId,
            type: MoneyTransactionType.ADJUSTMENT,
            direction: MoneyDirection.OUT,
            amount,
            balanceAfter: updated.balance,
            exchangeRate: Number(transaction.exchangeRate || 1),
            baseCurrencyId: transaction.baseCurrencyId,
            baseAmount: toBaseAmount(amount, {
              exchangeRate: Number(transaction.exchangeRate || 1),
              baseCurrencyId: transaction.baseCurrencyId
            }),
            baseBalanceAfter: toBaseAmount(Number(updated.balance), {
              exchangeRate: Number(transaction.exchangeRate || 1),
              baseCurrencyId: transaction.baseCurrencyId
            }),
            referenceType: "SALE_CANCEL",
            referenceId: sale.id,
            note: parsed.data.reason ?? "Sale cancellation",
            createdByUserId: authUser?.id ?? null
          }
        });
      }
    }

    const partyTransactions = await tx.partyTransaction.findMany({
      where: {
        referenceId: sale.id
      }
    });

    for (const transaction of partyTransactions) {
      const account = await tx.partyAccount.findUnique({
        where: {
          partyId_currencyId: {
            partyId: transaction.partyId,
            currencyId: transaction.currencyId
          }
        }
      });

      if (!account) continue;

      if (transaction.side === PartyAccountSide.DEBIT) {
        await tx.partyAccount.update({
          where: { id: account.id },
          data: { debitBalance: { decrement: transaction.amount } }
        });
      } else {
        await tx.partyAccount.update({
          where: { id: account.id },
          data: { creditBalance: { decrement: transaction.amount } }
        });
      }

      await tx.partyTransaction.create({
        data: {
          partyId: transaction.partyId,
          currencyId: transaction.currencyId,
          type: PartyTransactionType.ADJUSTMENT,
          side: transaction.side === PartyAccountSide.DEBIT ? PartyAccountSide.CREDIT : PartyAccountSide.DEBIT,
          amount: transaction.amount,
          referenceType: "SALE_CANCEL",
          referenceId: sale.id,
          note: parsed.data.reason ?? "Sale cancellation"
        }
      });
    }

    let journalEntry = await createReversalJournal(tx, {
      sourceType: "POS_SALE",
      sourceId: sale.id,
      reversalSourceType: "SALE_CANCEL",
      reversalSourceId: sale.id,
      entryNoPrefix: "JE-SC",
      description: "Sale cancellation",
      createdByUserId: authUser?.id ?? null
    });

    if (!journalEntry) {
      journalEntry = await createReversalJournal(tx, {
        sourceType: "SALE",
        sourceId: sale.id,
        reversalSourceType: "SALE_CANCEL",
        reversalSourceId: sale.id,
        entryNoPrefix: "JE-SC",
        description: "Sale cancellation",
        createdByUserId: authUser?.id ?? null
      });
    }

    const cogsJournalEntry = await createReversalJournal(tx, {
      sourceType: "POS_SALE_COGS",
      sourceId: sale.id,
      reversalSourceType: "POS_SALE_COGS_CANCEL",
      reversalSourceId: sale.id,
      entryNoPrefix: "JE-COGS-CANCEL",
      description: "COGS reversal for sale cancellation",
      createdByUserId: authUser?.id ?? null
    });

    const updatedSale = await tx.sale.update({
      where: { id: sale.id },
      data: {
        status: SaleStatus.CANCELLED,
        paymentStatus: SalePaymentStatus.UNPAID,
        paidAmount: 0,
        remainingAmount: 0,
        basePaidAmount: 0,
        baseRemainingAmount: 0,
        note: [sale.note, parsed.data.reason ? `Cancelled: ${parsed.data.reason}` : "Cancelled"]
          .filter(Boolean)
          .join("\n")
      }
    });

    return { sale: updatedSale, journalEntry, cogsJournalEntry };
  });

  const fullCancelledSale = await prisma.sale.findUnique({
    where: { id: sale.id },
    include: saleResponseInclude
  });

  if (!fullCancelledSale) {
    throw new Error("Cancelled sale could not be reloaded");
  }

  const responseResult = {
    ...result,
    sale: fullCancelledSale
  };

  await writeAudit(c, {
    action: "SALE_CANCELLED",
    entityType: "Sale",
    entityId: sale.id,
    metadata: {
      reason: parsed.data.reason ?? null
    }
  });

  return c.json({ data: responseResult });
});

salesRoute.post("/:id/payments", async (c) => {
  const id = c.req.param("id");
  const authUser = getAuthUser(c);
  const posDevice = await getRequestPosDevice(c, authUser?.id || null);
  const body = await c.req.json().catch(() => null);
  const parsed = salePaymentSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      customer: true,
      currency: true
    }
  });

  if (!sale) {
    return c.json({ message: "Sale not found" }, 404);
  }

  const remainingAmount = Number(sale.remainingAmount);

  if (remainingAmount <= 0) {
    return c.json({ message: "Sale is already fully paid" }, 400);
  }

  if (parsed.data.amount > remainingAmount) {
    return c.json({ message: "Payment amount cannot be greater than remaining sale amount" }, 400);
  }

  if (!sale.customerId) {
    return c.json({ message: "Customer is required for invoice payment" }, 400);
  }

  let paymentAccount:
    | {
        kind: "CASH" | "BANK";
        id: string;
        currencyId: string;
      }
    | null = null;

  if (parsed.data.paymentAccountType === "CASH") {
    const account = await prisma.cashRegisterAccount.findUnique({
      where: { id: parsed.data.paymentAccountId }
    });

    if (!account) {
      return c.json({ message: "Cash account not found" }, 404);
    }

    paymentAccount = {
      kind: "CASH",
      id: account.id,
      currencyId: account.currencyId
    };
  } else {
    const account = await prisma.bankAccount.findUnique({
      where: { id: parsed.data.paymentAccountId }
    });

    if (!account) {
      return c.json({ message: "Bank account not found" }, 404);
    }

    paymentAccount = {
      kind: "BANK",
      id: account.id,
      currencyId: account.currencyId
    };
  }

  if (paymentAccount.currencyId !== sale.currencyId) {
    return c.json({ message: "Payment account currency must match sale currency" }, 400);
  }

  const nextPaid = Number(sale.paidAmount) + parsed.data.amount;
  const nextRemaining = remainingAmount - parsed.data.amount;
  const saleSnapshot = {
    exchangeRate: Number(sale.exchangeRate || 1),
    baseCurrencyId: sale.baseCurrencyId ?? null
  };
  const nextStatus =
    nextRemaining <= 0
      ? SalePaymentStatus.PAID
      : nextPaid > 0
        ? SalePaymentStatus.PARTIAL
        : SalePaymentStatus.UNPAID;

  const result = await prisma.$transaction(async (tx) => {
    const updatedSale = await tx.sale.update({
      where: { id: sale.id },
      data: {
        paidAmount: nextPaid,
        remainingAmount: nextRemaining,
        basePaidAmount: toBaseAmount(nextPaid, saleSnapshot),
        baseRemainingAmount: toBaseAmount(nextRemaining, saleSnapshot),
        paymentStatus: nextStatus
      },
      include: {
        customer: true,
        currency: true,
        cashier: true,
        posDevice: true,
        items: {
          include: {
            product: true,
            warehouse: true,
            unit: true,
            lot: true
          }
        }
      }
    });

    await tx.partyAccount.upsert({
      where: {
        partyId_currencyId: {
          partyId: sale.customerId!,
          currencyId: sale.currencyId
        }
      },
      create: {
        partyId: sale.customerId!,
        currencyId: sale.currencyId,
        debitBalance: 0,
        creditBalance: parsed.data.amount
      },
      update: {
        creditBalance: {
          increment: parsed.data.amount
        }
      }
    });

    const partyTransaction = await tx.partyTransaction.create({
      data: {
        partyId: sale.customerId!,
        currencyId: sale.currencyId,
        type: PartyTransactionType.PAYMENT_RECEIVED,
        side: PartyAccountSide.CREDIT,
        amount: parsed.data.amount,
        referenceType: "SALE_PAYMENT",
        referenceId: sale.id,
        note: parsed.data.note ?? "Sale invoice payment"
      }
    });

    let moneyTransaction = null;

    if (paymentAccount.kind === "CASH") {
      const updatedAccount = await tx.cashRegisterAccount.update({
        where: { id: paymentAccount.id },
        data: { balance: { increment: parsed.data.amount } }
      });

      moneyTransaction = await tx.moneyTransaction.create({
        data: {
          currencyId: sale.currencyId,
          cashRegisterAccountId: paymentAccount.id,
          type: MoneyTransactionType.CUSTOMER_PAYMENT,
          direction: MoneyDirection.IN,
          amount: parsed.data.amount,
          balanceAfter: updatedAccount.balance,
          ...snapshotBaseFields(saleSnapshot, {
            amount: parsed.data.amount,
            balanceAfter: Number(updatedAccount.balance)
          }),
          referenceType: "SALE_PAYMENT",
          referenceId: partyTransaction.id,
          note: parsed.data.note ?? "Sale invoice payment",
          createdByUserId: authUser?.id || null,
          posDeviceId: posDevice?.id || null
        }
      });
    } else {
      const updatedAccount = await tx.bankAccount.update({
        where: { id: paymentAccount.id },
        data: { balance: { increment: parsed.data.amount } }
      });

      moneyTransaction = await tx.moneyTransaction.create({
        data: {
          currencyId: sale.currencyId,
          bankAccountId: paymentAccount.id,
          type: MoneyTransactionType.CUSTOMER_PAYMENT,
          direction: MoneyDirection.IN,
          amount: parsed.data.amount,
          balanceAfter: updatedAccount.balance,
          ...snapshotBaseFields(saleSnapshot, {
            amount: parsed.data.amount,
            balanceAfter: Number(updatedAccount.balance)
          }),
          referenceType: "SALE_PAYMENT",
          referenceId: partyTransaction.id,
          note: parsed.data.note ?? "Sale invoice payment",
          createdByUserId: authUser?.id || null,
          posDeviceId: posDevice?.id || null
        }
      });
    }

    const journalEntry = await createPostedJournal(tx, {
      entryNoPrefix: "JE-SREC",
      sourceType: "SALE_PAYMENT",
      sourceId: partyTransaction.id,
      description: "Sale invoice payment",
      createdByUserId: authUser?.id || null,
      lines: [
        {
          accountCode: treasuryAccountCode(paymentAccount.kind),
          partyId: sale.customerId,
          debit: parsed.data.amount,
          exchangeRate: saleSnapshot.exchangeRate,
          baseCurrencyId: saleSnapshot.baseCurrencyId,
          note: parsed.data.note ?? "Sale payment received"
        },
        {
          accountCode: "1200",
          partyId: sale.customerId,
          credit: parsed.data.amount,
          exchangeRate: saleSnapshot.exchangeRate,
          baseCurrencyId: saleSnapshot.baseCurrencyId,
          note: "Customer receivable reduced"
        }
      ]
    });

    return { sale: updatedSale, partyTransaction, moneyTransaction, journalEntry };
  });

  await writeAudit(c, {
    action: "SALE_PAYMENT_RECEIVED",
    entityType: "Sale",
    entityId: sale.id,
    metadata: {
      amount: parsed.data.amount,
      remainingAmount: nextRemaining
    }
  });

  return c.json({ data: result }, 201);
});

salesRoute.post("/", async (c) => {
  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => null);
  const parsed = createSaleSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  if (parsed.data.clientRequestId) {
    try {
      const replay = await loadIdempotentSaleResult(
        parsed.data.clientRequestId,
        authUser?.id || null
      );

      if (replay) {
        return c.json({ data: replay, idempotentReplay: true }, 200);
      }
    } catch (error) {
      if (!(error instanceof SaleRequestOwnershipError)) {
        throw error;
      }

      return c.json(
        {
          message:
            error instanceof Error
              ? error.message
              : "Sale request ID could not be verified"
        },
        409
      );
    }
  }

  const posDevice = await getRequestPosDevice(c, authUser?.id || null);

  const currency = await prisma.currency.findUnique({
    where: { id: parsed.data.currencyId }
  });

  if (!currency) {
    return c.json({ message: "Currency not found" }, 404);
  }

  if (parsed.data.customerId) {
    const customer = await prisma.party.findUnique({
      where: { id: parsed.data.customerId }
    });

    if (!customer) {
      return c.json({ message: "Customer not found" }, 404);
    }

    if (customer.type !== PartyType.CUSTOMER && customer.type !== PartyType.BOTH) {
      return c.json({ message: "Selected party is not a customer" }, 400);
    }
  }

  const saleDate = parseDate(parsed.data.saleDate);

  if (saleDate === "INVALID_DATE") {
    return c.json({ message: "Invalid saleDate" }, 400);
  }

  const preparedItems: Array<{
    productId: string;
    warehouseId: string;
    lotId: string | null;
    unitId: string;
    quantity: number;
    conversionRate: number;
    quantityBase: number;
    unitPrice: number;
    discount: number;
    totalPrice: number;
    allocations: Array<{
      lotId: string;
      quantityBase: number;
      quantity: number;
      unitCostBase: number;
      totalCost: number;
      baseUnitCost: number;
      baseTotalCost: number;
      costExchangeRate: number;
      currencyId: string | null;
      expiryDate: Date | null;
    }>;
  }> = [];

  for (const rawItem of parsed.data.items) {
    const product = await prisma.product.findUnique({
      where: { id: rawItem.productId },
      include: {
        units: true
      }
    });

    if (!product) {
      return c.json({ message: `Product not found: ${rawItem.productId}` }, 404);
    }

    const warehouse = await prisma.warehouse.findUnique({
      where: { id: rawItem.warehouseId }
    });

    if (!warehouse) {
      return c.json({ message: `Warehouse not found: ${rawItem.warehouseId}` }, 404);
    }

    let conversionRate = 1;

    const productUnit = product.units.find((unit) => unit.unitId === rawItem.unitId);

    if (productUnit) {
      conversionRate = Number(productUnit.conversionRate);
    } else if (product.baseUnitId === rawItem.unitId) {
      conversionRate = 1;
    } else {
      return c.json(
        {
          message: `Unit is not configured for product: ${product.name}`
        },
        400
      );
    }

    const quantityBase = roundStockQuantity(rawItem.quantity * conversionRate);

    const lots = await prisma.stockLot.findMany({
      where: {
        productId: rawItem.productId,
        warehouseId: rawItem.warehouseId,
        remainingQuantity: {
          gt: 0
        },
        ...(rawItem.lotId ? { id: rawItem.lotId } : {})
      },
      orderBy: [
        { expiryDate: "asc" },
        { createdAt: "asc" },
        { id: "asc" }
      ]
    });

    let remainingToAllocate = quantityBase;
    let remainingQuantityToAllocate = roundStockQuantity(rawItem.quantity);

    const allocations: Array<{
      lotId: string;
      quantityBase: number;
      quantity: number;
      unitCostBase: number;
      totalCost: number;
      baseUnitCost: number;
      baseTotalCost: number;
      costExchangeRate: number;
      currencyId: string | null;
      expiryDate: Date | null;
    }> = [];

    for (const lot of lots) {
      if (remainingToAllocate <= 0) break;

      const available = roundStockQuantity(Number(lot.remainingQuantity));
      const lotCanFinishLine = available + 0.00005 >= remainingToAllocate;
      const allocatedQuantity = lotCanFinishLine
        ? remainingQuantityToAllocate
        : Math.floor(
            ((available / conversionRate) + Number.EPSILON) * 10_000
          ) / 10_000;
      const allocatedBase = lotCanFinishLine
        ? remainingToAllocate
        : roundStockQuantity(allocatedQuantity * conversionRate);
      // A tiny residual lot may be representable in base units but round to zero
      // in the selected unit. Leave that dust in the lot and continue FIFO so a
      // zero-quantity sale line can never be created.
      if (allocatedQuantity <= 0) continue;
      const unitCostBase = Number(lot.unitCost);
      const costExchangeRate = Number(lot.exchangeRate || 1);
      const baseUnitCost = Number(lot.baseUnitCost || unitCostBase * costExchangeRate);

      allocations.push({
        lotId: lot.id,
        quantityBase: allocatedBase,
        quantity: allocatedQuantity,
        unitCostBase,
        totalCost: allocatedBase * unitCostBase,
        baseUnitCost,
        baseTotalCost: allocatedBase * baseUnitCost,
        costExchangeRate,
        currencyId: lot.currencyId,
        expiryDate: lot.expiryDate
      });

      remainingToAllocate = roundStockQuantity(
        remainingToAllocate - allocatedBase
      );
      remainingQuantityToAllocate = roundStockQuantity(
        remainingQuantityToAllocate - allocatedQuantity
      );
    }

    if (remainingToAllocate > 0) {
      return c.json(
        {
          message: `Not enough stock for product: ${product.name}`,
          required: quantityBase,
          missing: remainingToAllocate
        },
        400
      );
    }

    const grossTotal = roundMoney4(rawItem.quantity * rawItem.unitPrice);
    const itemDiscount = roundMoney4(rawItem.discount);

    if (itemDiscount > grossTotal) {
      return c.json(
        {
          message: `Discount cannot be greater than item total for product: ${product.name}`
        },
        400
      );
    }

    preparedItems.push({
      productId: rawItem.productId,
      warehouseId: rawItem.warehouseId,
      lotId: rawItem.lotId ?? null,
      unitId: rawItem.unitId,
      quantity: rawItem.quantity,
      conversionRate,
      quantityBase,
      unitPrice: rawItem.unitPrice,
      discount: itemDiscount,
      totalPrice: roundMoney4(grossTotal - itemDiscount),
      allocations
    });
  }

  const saleLines = preparedItems.flatMap((preparedItem) => {
    const weights = preparedItem.allocations.map((allocation) => allocation.quantity);
    const grossAllocations = allocateMoneyByWeight(
      roundMoney4(preparedItem.quantity * preparedItem.unitPrice),
      weights,
    );
    const itemDiscountAllocations = allocateMoneyByWeight(
      preparedItem.discount,
      weights,
    );

    return preparedItem.allocations.map((allocation, index) => {
      const lineDiscount = itemDiscountAllocations[index] ?? 0;
      const lineGrossTotal = grossAllocations[index] ?? 0;

      return {
        preparedItem,
        allocation,
        lineDiscount,
        lineTotal: roundMoney4(lineGrossTotal - lineDiscount),
      };
    });
  });

  const subtotal = roundMoney4(
    saleLines.reduce((sum, line) => sum + line.lineTotal, 0),
  );
  const documentDiscount = roundMoney4(parsed.data.discount);
  const total = roundMoney4(subtotal - documentDiscount);

  if (total < 0) {
    return c.json({ message: "Discount cannot be greater than subtotal" }, 400);
  }

  const paidAmount = roundMoney4(parsed.data.paidAmount);

  if (paidAmount > total) {
    return c.json({ message: "Paid amount cannot be greater than total" }, 400);
  }

  const documentDiscountAllocations = allocateMoneyByWeight(
    documentDiscount,
    saleLines.map((line) => line.lineTotal),
  );
  const pricedSaleLines = saleLines.map((line, index) => ({
    ...line,
    documentDiscountAllocated: documentDiscountAllocations[index] ?? 0,
    netTotalPrice: roundMoney4(
      line.lineTotal - (documentDiscountAllocations[index] ?? 0),
    ),
  }));

  const lineNetTotal = roundMoney4(
    pricedSaleLines.reduce((sum, line) => sum + line.netTotalPrice, 0),
  );

  if (lineNetTotal !== total) {
    return c.json({ message: "Sale line discount allocation is inconsistent" }, 400);
  }

  const requestedPaymentLines =
    parsed.data.paymentLines.length > 0
      ? parsed.data.paymentLines
      : paidAmount > 0 && parsed.data.paymentAccountType && parsed.data.paymentAccountId
        ? [
            {
              paymentAccountType: parsed.data.paymentAccountType,
              paymentAccountId: parsed.data.paymentAccountId,
              amount: paidAmount
            }
          ]
        : [];

  const paymentLinesTotal = roundMoney4(
    requestedPaymentLines.reduce((sum, line) => sum + roundMoney4(line.amount), 0),
  );

  if (paymentLinesTotal !== paidAmount) {
    return c.json({ message: "Payment lines total must equal paidAmount" }, 400);
  }

  const remainingAmount = roundMoney4(total - paidAmount);

  if (remainingAmount > 0 && !parsed.data.customerId) {
    return c.json({ message: "Customer is required for credit sale" }, 400);
  }

  if (paidAmount > 0 && requestedPaymentLines.length === 0) {
    return c.json({ message: "Payment account is required when paidAmount is greater than zero" }, 400);
  }

  const paymentLines: Array<{
    kind: "CASH" | "BANK";
    id: string;
    currencyId: string;
    amount: number;
  }> = [];

  for (const line of requestedPaymentLines) {
    let paymentAccount:
      | {
          kind: "CASH" | "BANK";
          id: string;
          currencyId: string;
        }
      | null = null;

    if (line.paymentAccountType === "CASH") {
      const account = await prisma.cashRegisterAccount.findUnique({
        where: { id: line.paymentAccountId }
      });

      if (!account) {
        return c.json({ message: "Cash account not found" }, 404);
      }

      paymentAccount = {
        kind: "CASH",
        id: account.id,
        currencyId: account.currencyId
      };
    } else {
      const account = await prisma.bankAccount.findUnique({
        where: { id: line.paymentAccountId }
      });

      if (!account) {
        return c.json({ message: "Bank account not found" }, 404);
      }

      paymentAccount = {
        kind: "BANK",
        id: account.id,
        currencyId: account.currencyId
      };
    }

    if (paymentAccount.currencyId !== parsed.data.currencyId) {
      return c.json({ message: "Payment account currency must match sale currency" }, 400);
    }

    paymentLines.push({
      ...paymentAccount,
      amount: roundMoney4(line.amount)
    });
  }

  const paymentStatus =
    remainingAmount === 0
      ? SalePaymentStatus.PAID
      : paidAmount > 0
        ? SalePaymentStatus.PARTIAL
      : SalePaymentStatus.UNPAID;

  let currencySnapshot;

  try {
    currencySnapshot = await resolveCurrencySnapshot(prisma, parsed.data.currencyId);
  } catch (error) {
    return c.json(
      { message: error instanceof Error ? error.message : "Currency rate could not be resolved" },
      400
    );
  }

  const inventoryOccurredAt = saleDate || kabulNow();
  const inventoryClientRequestId = requestOperationId(
    parsed.data.clientRequestId ||
      c.req.header("Idempotency-Key") ||
      c.req.header("x-idempotency-key"),
    "SALE"
  );
  const runSaleTransaction = () => prisma.$transaction(async (tx) => {
    const inventory = new InventoryMutationService(tx);
    await inventory.prepare(
      preparedItems.map((preparedItem) => ({
        productId: preparedItem.productId,
        warehouseId: preparedItem.warehouseId
      }))
    );
    if (parsed.data.clientRequestId) {
      const committedSale = await tx.sale.findUnique({
        where: { clientRequestId: parsed.data.clientRequestId },
        select: { cashierId: true }
      });
      if (committedSale) {
        if (committedSale.cashierId && committedSale.cashierId !== (authUser?.id || null)) {
          throw new SaleRequestOwnershipError("This sale request ID belongs to another user");
        }
        throw new SaleIdempotentReplayError();
      }
    }
    const lockedPreparedItems = [];
    for (const preparedItem of preparedItems) {
      const lots = await tx.stockLot.findMany({
        where: {
          productId: preparedItem.productId,
          warehouseId: preparedItem.warehouseId,
          remainingQuantity: { gt: 0 },
          ...(preparedItem.lotId ? { id: preparedItem.lotId } : {})
        },
        orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }, { id: "asc" }]
      });
      let remainingToAllocate = preparedItem.quantityBase;
      let remainingQuantityToAllocate = roundStockQuantity(preparedItem.quantity);
      const allocations: typeof preparedItem.allocations = [];

      for (const lot of lots) {
        if (remainingToAllocate <= 0) break;
        const available = roundStockQuantity(Number(lot.remainingQuantity));
        const lotCanFinishLine = available + 0.00005 >= remainingToAllocate;
        const allocatedQuantity = lotCanFinishLine
          ? remainingQuantityToAllocate
          : Math.floor(
              ((available / preparedItem.conversionRate) + Number.EPSILON) * 10_000
            ) / 10_000;
        const allocatedBase = lotCanFinishLine
          ? remainingToAllocate
          : roundStockQuantity(allocatedQuantity * preparedItem.conversionRate);
        if (allocatedQuantity <= 0) continue;
        const unitCostBase = Number(lot.unitCost);
        const costExchangeRate = Number(lot.exchangeRate || 1);
        const baseUnitCost = Number(
          lot.baseUnitCost || unitCostBase * costExchangeRate
        );

        allocations.push({
          lotId: lot.id,
          quantityBase: allocatedBase,
          quantity: allocatedQuantity,
          unitCostBase,
          totalCost: allocatedBase * unitCostBase,
          baseUnitCost,
          baseTotalCost: allocatedBase * baseUnitCost,
          costExchangeRate,
          currencyId: lot.currencyId,
          expiryDate: lot.expiryDate
        });
        remainingToAllocate = roundStockQuantity(remainingToAllocate - allocatedBase);
        remainingQuantityToAllocate = roundStockQuantity(
          remainingQuantityToAllocate - allocatedQuantity
        );
      }

      if (remainingToAllocate > 0) {
        throw new Error("Not enough stock for concurrent sale");
      }
      lockedPreparedItems.push({ ...preparedItem, allocations });
    }
    const lockedSaleLines = lockedPreparedItems.flatMap((preparedItem) => {
      const weights = preparedItem.allocations.map((allocation) => allocation.quantity);
      const grossAllocations = allocateMoneyByWeight(
        roundMoney4(preparedItem.quantity * preparedItem.unitPrice),
        weights
      );
      const itemDiscountAllocations = allocateMoneyByWeight(
        preparedItem.discount,
        weights
      );
      return preparedItem.allocations.map((allocation, index) => ({
        preparedItem,
        allocation,
        lineDiscount: itemDiscountAllocations[index] ?? 0,
        lineTotal: roundMoney4(
          (grossAllocations[index] ?? 0) - (itemDiscountAllocations[index] ?? 0)
        )
      }));
    });
    const lockedDocumentDiscountAllocations = allocateMoneyByWeight(
      documentDiscount,
      lockedSaleLines.map((line) => line.lineTotal)
    );
    const lockedPricedSaleLines = lockedSaleLines.map((line, index) => ({
      ...line,
      documentDiscountAllocated: lockedDocumentDiscountAllocations[index] ?? 0,
      netTotalPrice: roundMoney4(
        line.lineTotal - (lockedDocumentDiscountAllocations[index] ?? 0)
      )
    }));
    const inventoryOperation = await inventory.startOperation({
      ...inventoryOperationEvidence(c),
      type: "SALE",
      clientRequestId: inventoryClientRequestId,
      occurredAt: inventoryOccurredAt,
      createdByUserId: authUser?.id
    });

    const sale = await tx.sale.create({
      data: {
        clientRequestId: parsed.data.clientRequestId ?? null,
        invoiceNo: parsed.data.invoiceNo ?? null,
        customerId: parsed.data.customerId ?? null,
        currencyId: parsed.data.currencyId,
        status: SaleStatus.COMPLETED,
        paymentStatus,
        subtotal,
        discount: documentDiscount,
        total,
        paidAmount,
        remainingAmount,
        ...snapshotBaseFields(currencySnapshot, {
          subtotal,
          total,
          paidAmount,
          remainingAmount
        }),
        saleDate: saleDate || new Date(),
        note: parsed.data.note ?? null,
        cashierId: authUser?.id || null,
        posDeviceId: posDevice?.id || null
      }
    });

    const createdItems = [];

    for (const pricedLine of lockedPricedSaleLines) {
        const { preparedItem, allocation } = pricedLine;
        const stockUpdate = await tx.stockLot.updateMany({
          where: {
            id: allocation.lotId,
            remainingQuantity: {
              gte: stockDecimal(allocation.quantityBase)
            }
          },
          data: {
            remainingQuantity: {
              decrement: stockDecimal(allocation.quantityBase)
            }
          }
        });

        if (stockUpdate.count !== 1) {
          throw new Error("Not enough stock for concurrent sale");
        }

        await tx.stockMovement.create({
          data: {
            productId: preparedItem.productId,
            warehouseId: preparedItem.warehouseId,
            lotId: allocation.lotId,
            type: StockMovementType.SALE,
            quantity: allocation.quantityBase,
            unitCost: allocation.unitCostBase,
            currencyId: allocation.currencyId,
            operationId: inventoryOperation.id,
            occurredAt: inventoryOccurredAt,
            exchangeRate: allocation.costExchangeRate,
            baseUnitCost: allocation.baseUnitCost,
            referenceType: "SALE",
            referenceId: sale.id,
            note: parsed.data.note ?? null,
            createdByUserId: authUser?.id || null
          }
        });

        const saleItem = await tx.saleItem.create({
          data: {
            saleId: sale.id,
            productId: preparedItem.productId,
            warehouseId: preparedItem.warehouseId,
            unitId: preparedItem.unitId,
            lotId: allocation.lotId,
            quantity: allocation.quantity,
            conversionRate: preparedItem.conversionRate,
            quantityBase: allocation.quantityBase,
            unitPrice: preparedItem.unitPrice,
            discount: pricedLine.lineDiscount,
            totalPrice: pricedLine.lineTotal,
            documentDiscountAllocated: pricedLine.documentDiscountAllocated,
            netTotalPrice: pricedLine.netTotalPrice,
            unitCostBase: allocation.unitCostBase,
            totalCost: allocation.totalCost,
            baseTotalCost: allocation.baseTotalCost,
            expiryDate: allocation.expiryDate
          }
        });

        createdItems.push(saleItem);
    }

    const moneyTransactions = [];

    for (const paymentLine of paymentLines) {
      if (paymentLine.kind === "CASH") {
        const updatedAccount = await tx.cashRegisterAccount.update({
          where: { id: paymentLine.id },
          data: {
            balance: {
              increment: paymentLine.amount
            }
          }
        });

        const moneyTransaction = await tx.moneyTransaction.create({
          data: {
            currencyId: parsed.data.currencyId,
            cashRegisterAccountId: paymentLine.id,
            type: MoneyTransactionType.SALE_PAYMENT,
            direction: MoneyDirection.IN,
            amount: paymentLine.amount,
            balanceAfter: updatedAccount.balance,
            ...snapshotBaseFields(currencySnapshot, {
              amount: paymentLine.amount,
              balanceAfter: Number(updatedAccount.balance)
            }),
            referenceType: "SALE",
            referenceId: sale.id,
            note: "Sale payment",
            createdByUserId: authUser?.id || null,
            posDeviceId: posDevice?.id || null
          }
        });

        moneyTransactions.push(moneyTransaction);
      } else {
        const updatedAccount = await tx.bankAccount.update({
          where: { id: paymentLine.id },
          data: {
            balance: {
              increment: paymentLine.amount
            }
          }
        });

        const moneyTransaction = await tx.moneyTransaction.create({
          data: {
            currencyId: parsed.data.currencyId,
            bankAccountId: paymentLine.id,
            type: MoneyTransactionType.SALE_PAYMENT,
            direction: MoneyDirection.IN,
            amount: paymentLine.amount,
            balanceAfter: updatedAccount.balance,
            ...snapshotBaseFields(currencySnapshot, {
              amount: paymentLine.amount,
              balanceAfter: Number(updatedAccount.balance)
            }),
            referenceType: "SALE",
            referenceId: sale.id,
            note: "Sale payment",
            createdByUserId: authUser?.id || null,
            posDeviceId: posDevice?.id || null
          }
        });

        moneyTransactions.push(moneyTransaction);
      }
    }

    let customerTransaction = null;

    if (parsed.data.customerId && remainingAmount > 0) {
      await tx.partyAccount.upsert({
        where: {
          partyId_currencyId: {
            partyId: parsed.data.customerId,
            currencyId: parsed.data.currencyId
          }
        },
        create: {
          partyId: parsed.data.customerId,
          currencyId: parsed.data.currencyId,
          debitBalance: remainingAmount,
          creditBalance: 0
        },
        update: {
          debitBalance: {
            increment: remainingAmount
          }
        }
      });

      customerTransaction = await tx.partyTransaction.create({
        data: {
          partyId: parsed.data.customerId,
          currencyId: parsed.data.currencyId,
          type: PartyTransactionType.SALE_CREDIT,
          side: PartyAccountSide.DEBIT,
          amount: remainingAmount,
          referenceType: "SALE",
          referenceId: sale.id,
          note: "Credit sale"
        }
      });
    }

    const journalEntry = await createPostedJournal(tx, {
      entryNoPrefix: "JE-POS",
      sourceType: "POS_SALE",
      sourceId: sale.id,
      description: `POS Sale ${sale.invoiceNo || sale.id}`,
      createdByUserId: authUser?.id || null,
      lines: [
        ...paymentLines.map((line) => ({
          accountCode: treasuryAccountCode(line.kind),
          partyId: parsed.data.customerId || null,
          debit: line.amount,
          exchangeRate: currencySnapshot.exchangeRate,
          baseCurrencyId: currencySnapshot.baseCurrencyId,
          note: "Sale payment received"
        })),
        ...(remainingAmount > 0
          ? [{
              accountCode: "1200",
              partyId: parsed.data.customerId || null,
              debit: remainingAmount,
              exchangeRate: currencySnapshot.exchangeRate,
              baseCurrencyId: currencySnapshot.baseCurrencyId,
              note: "Customer receivable"
            }]
          : []),
        {
          accountCode: "4000",
          partyId: parsed.data.customerId || null,
          credit: subtotal,
          exchangeRate: currencySnapshot.exchangeRate,
          baseCurrencyId: currencySnapshot.baseCurrencyId,
          note: "Sales revenue"
        },
        ...(documentDiscount > 0
          ? [{
              accountCode: "4100",
              partyId: parsed.data.customerId || null,
              debit: documentDiscount,
              exchangeRate: currencySnapshot.exchangeRate,
              baseCurrencyId: currencySnapshot.baseCurrencyId,
              note: "Sales discount"
            }]
          : [])
      ]
    });

    const cogsResult = await ensureSaleCogsJournal(tx, {
      saleId: sale.id,
      invoiceNo: sale.invoiceNo,
      createdByUserId: authUser?.id || null
    });

    return {
      sale,
      items: createdItems,
      moneyTransactions,
      customerTransaction,
      journalEntry,
      cogsJournal: cogsResult.journalEntry,
      cogs: cogsResult.cogs,
      cogsZeroCost: cogsResult.zeroCost,
      idempotentReplay: false
    };
  }, {
    maxWait: 10_000,
    timeout: 30_000
  });

  let result: Awaited<ReturnType<typeof runSaleTransaction>>;

  try {
    result = await runSaleTransaction();
  } catch (error) {
    if (parsed.data.clientRequestId && error instanceof SaleIdempotentReplayError) {
      const replay = await loadIdempotentSaleResult(
        parsed.data.clientRequestId,
        authUser?.id || null
      );
      if (replay) {
        return c.json({ data: replay, idempotentReplay: true }, 200);
      }
    }

    if (error instanceof SaleRequestOwnershipError) {
      return c.json({ message: error.message }, 409);
    }

    if (parsed.data.clientRequestId && isUniqueConstraintError(error)) {
      const replay = await loadIdempotentSaleResult(
        parsed.data.clientRequestId,
        authUser?.id || null
      );

      if (replay) {
        return c.json({ data: replay, idempotentReplay: true }, 200);
      }
    }

    if (error instanceof Error && error.message === "Not enough stock for concurrent sale") {
      return c.json(
        {
          message: "Stock changed while this sale was being saved. Refresh the product and try again."
        },
        409
      );
    }

    throw error;
  }

  const fullSale = await prisma.sale.findUnique({
    where: { id: result.sale.id },
    include: saleResponseInclude
  });

  if (!fullSale) {
    throw new Error("Sale was committed but could not be reloaded");
  }

  const pricedFullSale = {
    ...fullSale,
    items: decorateSaleItemsWithPricing(fullSale.discount, fullSale.items),
  };

  result = {
    ...result,
    sale: pricedFullSale,
    items: pricedFullSale.items
  };

  await writeAudit(c, {
    action: "SALE_CREATED",
    entityType: "Sale",
    entityId: result.sale?.id || null,
    metadata: {
      total,
      paidAmount,
      invoiceNo: parsed.data.invoiceNo || null
    }
  });

  return c.json({ data: result }, 201);
});
