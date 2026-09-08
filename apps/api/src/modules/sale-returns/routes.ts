import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import { getAuthUser, writeAudit } from "../../lib/auth";
import { snapshotBaseFields, toBaseAmount } from "../../lib/currency-rates";
import { createPostedJournal, createReversalJournal, treasuryAccountCode } from "../../lib/journal";
import { getRequestPosDevice } from "../../lib/pos-device";
import {
  MoneyDirection,
  MoneyTransactionType,
  PartyAccountSide,
  PartyTransactionType,
  StockMovementType
} from "../../generated/prisma/enums";
import { createPaginationMeta, getPagePagination } from "../../lib/pagination";
import { getRecentDateRange } from "../../lib/recent-date-range";
import { normalizeBarcodeText } from "../../lib/barcode";
import { resolveSaleItemPricing, roundMoney4 } from "../../lib/sale-pricing";
import { Prisma } from "../../generated/prisma/client";
import { acquireTransactionLock } from "../../lib/db-lock";
import { SaleStatus } from "../../generated/prisma/enums";
import { createOperationReference } from "../../lib/operation-id";
import {
  InventoryMutationService,
  requestOperationId
} from "../../lib/inventory-mutation";
import { inventoryOperationEvidence } from "../../lib/request-evidence";
import { kabulNow } from "../../lib/kabul-date";
import { stockDecimal } from "../../lib/stock-quantity";

export const saleReturnsRoute = new Hono();

const accountTypeSchema = z.enum(["CASH", "BANK"]);

const saleReturnSchema = z.object({
  saleId: z.string().min(1),
  returnNo: z.string().trim().max(120).optional().nullable(),
  refundAccountType: accountTypeSchema.optional().nullable(),
  refundAccountId: z.string().trim().optional().nullable(),
  refundAmount: z.coerce.number().nonnegative().default(0),
  note: z.string().trim().max(500).optional().nullable(),
  items: z.array(
    z.object({
      saleItemId: z.string().min(1),
      quantity: z.coerce.number().positive()
    })
  ).min(1)
});

const cancelSaleReturnSchema = z.object({
  reason: z.string().trim().min(1).max(500)
});

async function getTreasuryAccount(type: "CASH" | "BANK", id: string) {
  if (type === "CASH") {
    const account = await prisma.cashRegisterAccount.findUnique({
      where: { id }
    });

    return account
      ? { type, id: account.id, currencyId: account.currencyId, balance: Number(account.balance) }
      : null;
  }

  const account = await prisma.bankAccount.findUnique({
    where: { id }
  });

  return account
    ? { type, id: account.id, currencyId: account.currencyId, balance: Number(account.balance) }
    : null;
}

saleReturnsRoute.get("/", async (c) => {
  const pagination = getPagePagination(c);
  const search = c.req.query("search")?.trim();
  const where = {
    createdAt: getRecentDateRange(c),
    ...(search
      ? {
          OR: [
            { returnNo: { contains: search, mode: "insensitive" as const } },
            { note: { contains: search, mode: "insensitive" as const } },
            { sale: { invoiceNo: { contains: search, mode: "insensitive" as const } } },
            { customer: { name: { contains: search, mode: "insensitive" as const } } },
            { customer: { phone: { contains: search, mode: "insensitive" as const } } },
            { items: { some: { product: { name: { contains: search, mode: "insensitive" as const } } } } },
            { items: { some: { product: { barcode: { contains: search, mode: "insensitive" as const } } } } },
            { items: { some: { product: { barcodeNormalized: { contains: normalizeBarcodeText(search), mode: "insensitive" as const } } } } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.saleReturn.findMany({
    where,
    include: {
      sale: true,
      customer: true,
      currency: true,
      createdByUser: true,
      posDevice: true,
      items: {
        include: {
          product: true,
          warehouse: true,
          lot: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    skip: pagination.skip,
    take: pagination.limit
  }),
    prisma.saleReturn.count({ where })
  ]);

  return c.json({ data: items, pagination: createPaginationMeta({ ...pagination, total }) });
});

saleReturnsRoute.get("/quality", async (c) => {
  const authUser = getAuthUser(c);

  if (authUser?.role !== "Admin") {
    return c.json({ message: "Only Admin can review historical return quality" }, 403);
  }

  const pagination = getPagePagination(c);
  const createdAt = getRecentDateRange(c);
  const rows = await prisma.$queryRaw<Array<{
    returnId: string;
    returnNo: string | null;
    returnItemId: string;
    saleId: string;
    invoiceNo: string | null;
    productId: string;
    productName: string;
    createdAt: Date;
    actualTotal: Prisma.Decimal;
    expectedNetTotal: Prisma.Decimal;
    discrepancy: Prisma.Decimal;
    totalCount: bigint;
    discrepancyTotal: Prisma.Decimal;
  }>>(Prisma.sql`
    WITH quality AS (
      SELECT
        sr.id AS "returnId",
        sr."returnNo",
        sri.id AS "returnItemId",
        s.id AS "saleId",
        s."invoiceNo",
        p.id AS "productId",
        p.name AS "productName",
        sr."createdAt",
        sri."totalPrice" AS "actualTotal",
        GREATEST(
          0,
          ROUND(
            CASE
              WHEN si."quantityBase" > 0
                THEN (
                  si."totalPrice" - CASE
                    WHEN s.subtotal > 0
                      THEN s.discount * (si."totalPrice" / s.subtotal)
                    ELSE 0
                  END
                ) * (sri."quantityBase" / si."quantityBase")
              ELSE 0
            END,
            4
          )
        ) AS "expectedNetTotal"
      FROM "SaleReturnItem" sri
      JOIN "SaleReturn" sr ON sr.id = sri."saleReturnId"
      JOIN "SaleItem" si ON si.id = sri."saleItemId"
      JOIN "Sale" s ON s.id = si."saleId"
      JOIN "Product" p ON p.id = sri."productId"
      WHERE sr."cancelledAt" IS NULL
        AND sr."createdAt" >= ${createdAt.gte}
        AND sr."createdAt" < ${createdAt.lt}
        AND si."netTotalPrice" IS NULL
        AND s.discount > 0
    ), suspicious AS (
      SELECT
        *,
        ROUND("actualTotal" - "expectedNetTotal", 4) AS discrepancy
      FROM quality
      WHERE "actualTotal" - "expectedNetTotal" > 0.0001
    )
    SELECT
      *,
      COUNT(*) OVER() AS "totalCount",
      COALESCE(SUM(discrepancy) OVER(), 0) AS "discrepancyTotal"
    FROM suspicious
    ORDER BY "createdAt" DESC, "returnItemId" DESC
    LIMIT ${pagination.limit}
    OFFSET ${pagination.skip}
  `);
  const total = Number(rows[0]?.totalCount || 0);

  return c.json({
    data: rows.map((row) => ({
      returnId: row.returnId,
      returnNo: row.returnNo,
      returnItemId: row.returnItemId,
      saleId: row.saleId,
      invoiceNo: row.invoiceNo,
      productId: row.productId,
      productName: row.productName,
      createdAt: row.createdAt,
      actualTotal: Number(row.actualTotal),
      expectedNetTotal: Number(row.expectedNetTotal),
      discrepancy: Number(row.discrepancy),
    })),
    pagination: createPaginationMeta({ ...pagination, total }),
    summary: {
      suspiciousCount: total,
      discrepancyTotal: Number(rows[0]?.discrepancyTotal || 0),
    },
    remediation: "REVIEW_AND_CANCEL_RECREATE",
  });
});

saleReturnsRoute.post("/", async (c) => {
  const authUser = getAuthUser(c);
  const posDevice = await getRequestPosDevice(c, authUser?.id || null);
  const body = await c.req.json().catch(() => null);
  const parsed = saleReturnSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const sale = await prisma.sale.findUnique({
    where: { id: parsed.data.saleId },
    include: {
      customer: true,
      items: {
        include: {
          product: true,
          warehouse: true,
          lot: true,
          returnItems: {
            include: {
              saleReturn: true
            }
          }
        }
      }
    }
  });

  if (!sale) {
    return c.json({ message: "Sale not found" }, 404);
  }

  if (sale.status === SaleStatus.CANCELLED) {
    return c.json({ message: "فروش ابطال شده و قابل برگشت نیست." }, 400);
  }

  const requestedByItem = new Map(parsed.data.items.map((item) => [item.saleItemId, item]));
  const preparedItems: any[] = [];
  const saleItemPricing = resolveSaleItemPricing(sale.discount, sale.items);

  for (const requestItem of parsed.data.items) {
    const saleItem = sale.items.find((item) => item.id === requestItem.saleItemId);

    if (!saleItem) {
      return c.json({ message: `Sale item not found: ${requestItem.saleItemId}` }, 404);
    }

    const activeReturnItems = saleItem.returnItems.filter(
      (item) => !item.saleReturn.cancelledAt,
    );
    const requestedUnitQuantity = roundMoney4(requestItem.quantity);
    const returnedUnitQuantity = roundMoney4(
      activeReturnItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    );
    const availableUnitQuantity = roundMoney4(
      Number(saleItem.quantity) - returnedUnitQuantity,
    );
    const requestedQuantityBase = roundMoney4(
      requestItem.quantity * Number(saleItem.conversionRate),
    );
    const returnedBase = roundMoney4(
      activeReturnItems.reduce(
        (sum, item) => sum + Number(item.quantityBase || 0),
        0,
      ),
    );
    const soldBase = Number(saleItem.quantityBase);
    const availableBase = roundMoney4(soldBase - returnedBase);
    const unitRoundingTolerance = Math.max(
      0.0001,
      Number(saleItem.conversionRate) * 0.00005 + 0.00001,
    );
    const quantityBase =
      Math.abs(requestedUnitQuantity - availableUnitQuantity) <= 0.0001 ||
      Math.abs(requestedQuantityBase - availableBase) <= unitRoundingTolerance
        ? availableBase
        : requestedQuantityBase;

    if (quantityBase > availableBase + unitRoundingTolerance) {
      return c.json({
        message: `Return quantity exceeds sold quantity for ${saleItem.product.name}`,
        availableBase
      }, 400);
    }

    const pricing = saleItemPricing.get(saleItem.id);
    const fullNetTotal = roundMoney4(
      pricing?.netTotalPrice ?? saleItem.totalPrice,
    );
    const alreadyReturnedNet = roundMoney4(
      activeReturnItems.reduce(
        (sum, item) => sum + Number(item.totalPrice || 0),
        0,
      ),
    );
    const remainingNet = Math.max(
      0,
      roundMoney4(fullNetTotal - alreadyReturnedNet),
    );
    const returningAllRemaining =
      Math.abs(quantityBase - availableBase) <= unitRoundingTolerance;
    const quantityRatio = soldBase > 0 ? quantityBase / soldBase : 0;
    const totalPrice = returningAllRemaining
      ? remainingNet
      : Math.min(remainingNet, roundMoney4(fullNetTotal * quantityRatio));

    const fullTotalCost =
      saleItem.totalCost === null ? null : roundMoney4(saleItem.totalCost);
    const returnedTotalCost = roundMoney4(
      activeReturnItems.reduce(
        (sum, item) => sum + Number(item.totalCost || 0),
        0,
      ),
    );
    const remainingTotalCost =
      fullTotalCost === null
        ? null
        : Math.max(0, roundMoney4(fullTotalCost - returnedTotalCost));
    const totalCost =
      fullTotalCost === null || remainingTotalCost === null
        ? null
        : returningAllRemaining
          ? remainingTotalCost
          : Math.min(
              remainingTotalCost,
              roundMoney4(fullTotalCost * quantityRatio),
            );

    const fullBaseTotalCost =
      saleItem.baseTotalCost === null
        ? fullTotalCost
        : roundMoney4(saleItem.baseTotalCost);
    const returnedBaseTotalCost = roundMoney4(
      activeReturnItems.reduce(
        (sum, item) =>
          sum + Number(item.baseTotalCost ?? item.totalCost ?? 0),
        0,
      ),
    );
    const remainingBaseTotalCost =
      fullBaseTotalCost === null
        ? null
        : Math.max(
            0,
            roundMoney4(fullBaseTotalCost - returnedBaseTotalCost),
          );
    const baseTotalCost =
      fullBaseTotalCost === null || remainingBaseTotalCost === null
        ? null
        : returningAllRemaining
          ? remainingBaseTotalCost
          : Math.min(
              remainingBaseTotalCost,
              roundMoney4(fullBaseTotalCost * quantityRatio),
            );

    preparedItems.push({
      saleItem,
      quantity: roundMoney4(requestItem.quantity),
      quantityBase,
      unitPrice: Number(saleItem.unitPrice),
      totalPrice,
      unitCostBase: saleItem.unitCostBase === null ? null : Number(saleItem.unitCostBase),
      totalCost,
      baseTotalCost
    });
  }

  if (requestedByItem.size !== parsed.data.items.length) {
    return c.json({ message: "Duplicate return item was provided" }, 400);
  }

  const subtotal = roundMoney4(
    preparedItems.reduce((sum, item) => sum + item.totalPrice, 0),
  );
  const refundAmount = roundMoney4(parsed.data.refundAmount);

  if (refundAmount > subtotal) {
    return c.json({ message: "Refund amount cannot exceed return total" }, 400);
  }

  const receivableAdjustment = roundMoney4(subtotal - refundAmount);
  const saleSnapshot = {
    exchangeRate: Number(sale.exchangeRate || 1),
    baseCurrencyId: sale.baseCurrencyId ?? null
  };

  if (receivableAdjustment > 0 && !sale.customerId) {
    return c.json({ message: "Customer is required when return is not fully refunded" }, 400);
  }

  let refundAccount: Awaited<ReturnType<typeof getTreasuryAccount>> = null;

  if (refundAmount > 0) {
    if (!parsed.data.refundAccountType || !parsed.data.refundAccountId) {
      return c.json({ message: "Refund account is required" }, 400);
    }

    refundAccount = await getTreasuryAccount(parsed.data.refundAccountType, parsed.data.refundAccountId);

    if (!refundAccount) {
      return c.json({ message: "Refund account not found" }, 404);
    }

    if (refundAccount.currencyId !== sale.currencyId) {
      return c.json({ message: "Refund account currency must match sale currency" }, 400);
    }

    if (refundAccount.balance < refundAmount) {
      return c.json({ message: "Not enough balance for refund" }, 400);
    }
  }

  const inventoryOccurredAt = kabulNow();
  const inventoryClientRequestId = requestOperationId(
    c.req.header("Idempotency-Key") || c.req.header("x-idempotency-key"),
    "SALE-RETURN"
  );

  const result = await prisma.$transaction(async (tx) => {
    await acquireTransactionLock(tx, "sale-document", sale.id);
    const currentSale = await tx.sale.findUnique({
      where: { id: sale.id },
      select: { status: true }
    });
    if (!currentSale || currentSale.status === SaleStatus.CANCELLED) {
      throw new Error("فروش ابطال شده و قابل برگشت نیست.");
    }
    const inventory = new InventoryMutationService(tx);
    await inventory.prepare(
      preparedItems.map((item) => ({
        productId: item.saleItem.productId,
        warehouseId: item.saleItem.warehouseId
      }))
    );
    const inventoryOperation = await inventory.startOperation({
      ...inventoryOperationEvidence(c),
      type: "SALE_RETURN",
      clientRequestId: inventoryClientRequestId,
      occurredAt: inventoryOccurredAt,
      createdByUserId: authUser?.id
    });

    for (const item of preparedItems) {
      const returned = await tx.saleReturnItem.aggregate({
        where: {
          saleItemId: item.saleItem.id,
          saleReturn: { cancelledAt: null }
        },
        _sum: { quantityBase: true }
      });
      const available = roundMoney4(
        Number(item.saleItem.quantityBase) - Number(returned._sum.quantityBase || 0)
      );
      if (item.quantityBase > available + 0.0001) {
        throw new Error(
          `مقدار برگشتی ${item.saleItem.product.name} از مقدار قابل برگشت بیشتر است.`
        );
      }
    }

    const saleReturn = await tx.saleReturn.create({
      data: {
        returnNo: parsed.data.returnNo ?? createOperationReference("SR"),
        saleId: sale.id,
        customerId: sale.customerId,
        currencyId: sale.currencyId,
        subtotal,
        refundAmount,
        receivableAdjustment,
        ...snapshotBaseFields(saleSnapshot, {
          subtotal,
          paidAmount: refundAmount,
          remainingAmount: receivableAdjustment
        }),
        note: parsed.data.note ?? null,
        createdByUserId: authUser?.id || null,
        posDeviceId: posDevice?.id || null
      }
    });

    const createdItems = [];
    let baseTotalCost = 0;

    for (const item of preparedItems) {
      if (item.saleItem.lotId) {
        await tx.stockLot.update({
          where: { id: item.saleItem.lotId },
          data: {
            remainingQuantity: {
              increment: stockDecimal(item.quantityBase)
            }
          }
        });
      }

      await tx.stockMovement.create({
        data: {
          productId: item.saleItem.productId,
          warehouseId: item.saleItem.warehouseId,
          lotId: item.saleItem.lotId,
          type: StockMovementType.SALE_RETURN,
          quantity: item.quantityBase,
          unitCost: item.unitCostBase,
          currencyId: item.saleItem.lot?.currencyId || sale.currencyId,
          operationId: inventoryOperation.id,
          occurredAt: inventoryOccurredAt,
          exchangeRate: Number(item.saleItem.lot?.exchangeRate || 1),
          baseUnitCost: Number(item.saleItem.lot?.baseUnitCost || item.unitCostBase || 0),
          referenceType: "SALE_RETURN",
          referenceId: saleReturn.id,
          note: parsed.data.note ?? null,
          createdByUserId: authUser?.id || null
        }
      });

      const returnItem = await tx.saleReturnItem.create({
        data: {
          saleReturnId: saleReturn.id,
          saleItemId: item.saleItem.id,
          productId: item.saleItem.productId,
          warehouseId: item.saleItem.warehouseId,
          lotId: item.saleItem.lotId,
          quantity: item.quantity,
          quantityBase: item.quantityBase,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          unitCostBase: item.unitCostBase,
          totalCost: item.totalCost,
          baseTotalCost: item.baseTotalCost
        }
      });

      baseTotalCost += Number(item.baseTotalCost || 0);
      createdItems.push(returnItem);
    }

    let moneyTransaction = null;

    if (refundAccount && refundAmount > 0) {
      if (refundAccount.type === "CASH") {
        const updated = await tx.cashRegisterAccount.update({
          where: { id: refundAccount.id },
          data: { balance: { decrement: refundAmount } }
        });

        moneyTransaction = await tx.moneyTransaction.create({
          data: {
            currencyId: sale.currencyId,
            cashRegisterAccountId: refundAccount.id,
            type: MoneyTransactionType.ADJUSTMENT,
            direction: MoneyDirection.OUT,
            amount: refundAmount,
            balanceAfter: updated.balance,
            ...snapshotBaseFields(saleSnapshot, {
              amount: refundAmount,
              balanceAfter: Number(updated.balance)
            }),
            referenceType: "SALE_RETURN",
            referenceId: saleReturn.id,
            note: parsed.data.note ?? "Sale return refund",
            createdByUserId: authUser?.id || null,
            posDeviceId: posDevice?.id || null
          }
        });
      } else {
        const updated = await tx.bankAccount.update({
          where: { id: refundAccount.id },
          data: { balance: { decrement: refundAmount } }
        });

        moneyTransaction = await tx.moneyTransaction.create({
          data: {
            currencyId: sale.currencyId,
            bankAccountId: refundAccount.id,
            type: MoneyTransactionType.ADJUSTMENT,
            direction: MoneyDirection.OUT,
            amount: refundAmount,
            balanceAfter: updated.balance,
            ...snapshotBaseFields(saleSnapshot, {
              amount: refundAmount,
              balanceAfter: Number(updated.balance)
            }),
            referenceType: "SALE_RETURN",
            referenceId: saleReturn.id,
            note: parsed.data.note ?? "Sale return refund",
            createdByUserId: authUser?.id || null,
            posDeviceId: posDevice?.id || null
          }
        });
      }
    }

    let partyTransaction = null;

    if (sale.customerId && receivableAdjustment > 0) {
      await tx.partyAccount.upsert({
        where: {
          partyId_currencyId: {
            partyId: sale.customerId,
            currencyId: sale.currencyId
          }
        },
        create: {
          partyId: sale.customerId,
          currencyId: sale.currencyId,
          debitBalance: 0,
          creditBalance: receivableAdjustment
        },
        update: {
          creditBalance: {
            increment: receivableAdjustment
          }
        }
      });

      partyTransaction = await tx.partyTransaction.create({
        data: {
          partyId: sale.customerId,
          currencyId: sale.currencyId,
          type: PartyTransactionType.ADJUSTMENT,
          side: PartyAccountSide.CREDIT,
          amount: receivableAdjustment,
          referenceType: "SALE_RETURN",
          referenceId: saleReturn.id,
          note: parsed.data.note ?? "Sale return receivable adjustment"
        }
      });
    }

    const lines: Array<{
      accountCode: string;
      debit?: number;
      credit?: number;
      exchangeRate?: number;
      baseCurrencyId?: string | null;
      note?: string | null;
    }> = [
      {
        accountCode: "4200",
        debit: subtotal,
        exchangeRate: saleSnapshot.exchangeRate,
        baseCurrencyId: saleSnapshot.baseCurrencyId,
        note: "Sale return"
      }
    ];

    if (refundAccount && refundAmount > 0) {
      lines.push({
        accountCode: treasuryAccountCode(refundAccount.type),
        credit: refundAmount,
        exchangeRate: saleSnapshot.exchangeRate,
        baseCurrencyId: saleSnapshot.baseCurrencyId,
        note: "Sale return refund"
      });
    }

    if (receivableAdjustment > 0) {
      lines.push({
        accountCode: "1200",
        credit: receivableAdjustment,
        exchangeRate: saleSnapshot.exchangeRate,
        baseCurrencyId: saleSnapshot.baseCurrencyId,
        note: "Sale return receivable adjustment"
      });
    }

    if (baseTotalCost > 0) {
      lines.push(
        {
          accountCode: "1300",
          debit: baseTotalCost,
          exchangeRate: 1,
          baseCurrencyId: saleSnapshot.baseCurrencyId,
          note: "Returned inventory"
        },
        {
          accountCode: "5000",
          credit: baseTotalCost,
          exchangeRate: 1,
          baseCurrencyId: saleSnapshot.baseCurrencyId,
          note: "COGS reversed"
        }
      );
    }

    const journalEntry = await createPostedJournal(tx, {
      entryNoPrefix: "JE-SR",
      sourceType: "SALE_RETURN",
      sourceId: saleReturn.id,
      description: "Sale return",
      createdByUserId: authUser?.id || null,
      lines
    });

    return {
      saleReturn,
      items: createdItems,
      moneyTransaction,
      partyTransaction,
      journalEntry
    };
  });

  await writeAudit(c, {
    action: "SALE_RETURN_CREATED",
    entityType: "SaleReturn",
    entityId: result.saleReturn.id,
    metadata: {
      saleId: sale.id,
      subtotal,
      refundAmount
    }
  });

  return c.json({ data: result }, 201);
});

saleReturnsRoute.post("/:id/cancel", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");
  const parsed = cancelSaleReturnSchema.safeParse(await c.req.json().catch(() => ({})));

  if (!parsed.success) return c.json(zodError(parsed.error), 400);

  const saleReturn = await prisma.saleReturn.findUnique({
    where: { id },
    include: { items: true }
  });

  if (!saleReturn) return c.json({ message: "Sale return not found" }, 404);
  if (saleReturn.cancelledAt) return c.json({ message: "Sale return is already cancelled" }, 400);

  const moneyTransactions = await prisma.moneyTransaction.findMany({
    where: { referenceType: "SALE_RETURN", referenceId: id }
  });
  const partyTransactions = await prisma.partyTransaction.findMany({
    where: { referenceType: "SALE_RETURN", referenceId: id }
  });

  try {
    const result = await prisma.$transaction(async (tx) => {
      await acquireTransactionLock(tx, "sale-return-document", id);
      const currentReturn = await tx.saleReturn.findUnique({
        where: { id },
        include: { items: { include: { lot: true } } }
      });
      if (!currentReturn || currentReturn.cancelledAt) {
        throw new Error("این برگشت فروش قبلاً ابطال شده است.");
      }
      const inventory = new InventoryMutationService(tx);
      await inventory.lock(
        currentReturn.items.map((item) => ({
          productId: item.productId,
          warehouseId: item.warehouseId
        }))
      );
      const sourceMovement = await tx.stockMovement.findFirst({
        where: { referenceType: "SALE_RETURN", referenceId: id },
        select: { operationId: true }
      });

      for (const item of currentReturn.items) {
        if (item.lotId) {
          const updated = await tx.stockLot.updateMany({
            where: {
              id: item.lotId,
              remainingQuantity: { gte: stockDecimal(Number(item.quantityBase)) }
            },
            data: {
              remainingQuantity: { decrement: stockDecimal(Number(item.quantityBase)) }
            }
          });
          if (updated.count !== 1) throw new Error("Returned stock was already used and cannot be cancelled");
        }

        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            warehouseId: item.warehouseId,
            lotId: item.lotId,
            type: StockMovementType.SALE,
            quantity: item.quantityBase,
            unitCost: item.unitCostBase,
            currencyId: item.lot?.currencyId ?? currentReturn.currencyId,
            exchangeRate: item.lot?.exchangeRate ?? currentReturn.exchangeRate,
            baseUnitCost: item.lot?.baseUnitCost ?? item.unitCostBase,
            operationId: sourceMovement?.operationId ?? null,
            occurredAt: kabulNow(),
            referenceType: "SALE_RETURN_CANCEL",
            referenceId: id,
            note: parsed.data.reason,
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
            cancelReason: parsed.data.reason,
            cancelledByUserId: authUser?.id ?? null
          }
        });
        if (changed.count !== 1) {
          throw new Error("این برگشت فروش هم‌زمان ابطال شده است.");
        }
      }

      for (const transaction of moneyTransactions) {
        const amount = Number(transaction.amount);
        const snapshot = {
          exchangeRate: Number(transaction.exchangeRate || 1),
          baseCurrencyId: transaction.baseCurrencyId
        };
        let balanceAfter = 0;

        if (transaction.cashRegisterAccountId) {
          const updated = await tx.cashRegisterAccount.update({
            where: { id: transaction.cashRegisterAccountId },
            data: { balance: { increment: amount } }
          });
          balanceAfter = Number(updated.balance);
        } else if (transaction.bankAccountId) {
          const updated = await tx.bankAccount.update({
            where: { id: transaction.bankAccountId },
            data: { balance: { increment: amount } }
          });
          balanceAfter = Number(updated.balance);
        }

        await tx.moneyTransaction.create({
          data: {
            currencyId: transaction.currencyId,
            cashRegisterAccountId: transaction.cashRegisterAccountId,
            bankAccountId: transaction.bankAccountId,
            type: MoneyTransactionType.ADJUSTMENT,
            direction: MoneyDirection.IN,
            amount,
            balanceAfter,
            baseAmount: toBaseAmount(amount, snapshot),
            baseBalanceAfter: toBaseAmount(balanceAfter, snapshot),
            ...snapshot,
            referenceType: "SALE_RETURN_CANCEL",
            referenceId: id,
            note: parsed.data.reason,
            createdByUserId: authUser?.id ?? null
          }
        });
      }

      for (const transaction of partyTransactions) {
        await tx.partyAccount.update({
          where: { partyId_currencyId: { partyId: transaction.partyId, currencyId: transaction.currencyId } },
          data: transaction.side === PartyAccountSide.DEBIT
            ? { debitBalance: { decrement: transaction.amount } }
            : { creditBalance: { decrement: transaction.amount } }
        });
        await tx.partyTransaction.create({
          data: {
            partyId: transaction.partyId,
            currencyId: transaction.currencyId,
            type: PartyTransactionType.ADJUSTMENT,
            side: transaction.side === PartyAccountSide.DEBIT ? PartyAccountSide.CREDIT : PartyAccountSide.DEBIT,
            amount: transaction.amount,
            referenceType: "SALE_RETURN_CANCEL",
            referenceId: id,
            note: parsed.data.reason
          }
        });
      }

      const journalEntry = await createReversalJournal(tx, {
        sourceType: "SALE_RETURN",
        sourceId: id,
        reversalSourceType: "SALE_RETURN_CANCEL",
        reversalSourceId: id,
        entryNoPrefix: "JE-SRC",
        description: "Sale return cancellation",
        createdByUserId: authUser?.id ?? null
      });
      const updated = await tx.saleReturn.update({
        where: { id },
        data: {
          cancelledAt: new Date(),
          cancelledByUserId: authUser?.id ?? null,
          cancellationReason: parsed.data.reason
        }
      });

      return { saleReturn: updated, journalEntry };
    });

    await writeAudit(c, {
      action: "SALE_RETURN_CANCELLED",
      entityType: "SaleReturn",
      entityId: id,
      metadata: { reason: parsed.data.reason }
    });
    return c.json({ data: result });
  } catch (error) {
    return c.json({ message: error instanceof Error ? error.message : "Sale return cancellation failed" }, 400);
  }
});
