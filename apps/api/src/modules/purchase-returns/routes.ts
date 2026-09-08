import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import { getAuthUser, writeAudit } from "../../lib/auth";
import { snapshotBaseFields, toBaseAmount } from "../../lib/currency-rates";
import { createPostedJournal, createReversalJournal, treasuryAccountCode } from "../../lib/journal";
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
import { acquireTransactionLock } from "../../lib/db-lock";
import { roundStockQuantity, stockDecimal } from "../../lib/stock-quantity";
import { PurchaseStatus } from "../../generated/prisma/enums";
import { createOperationReference } from "../../lib/operation-id";
import {
  InventoryMutationService,
  requestOperationId
} from "../../lib/inventory-mutation";
import { inventoryOperationEvidence } from "../../lib/request-evidence";
import { kabulNow } from "../../lib/kabul-date";

export const purchaseReturnsRoute = new Hono();

const accountTypeSchema = z.enum(["CASH", "BANK"]);

const purchaseReturnSchema = z.object({
  purchaseId: z.string().min(1),
  returnNo: z.string().trim().max(120).optional().nullable(),
  receiveAccountType: accountTypeSchema.optional().nullable(),
  receiveAccountId: z.string().trim().optional().nullable(),
  receivedAmount: z.coerce.number().nonnegative().default(0),
  note: z.string().trim().max(500).optional().nullable(),
  clientRequestId: z.string().trim().min(8).max(200).optional().nullable(),
  items: z.array(
    z.object({
      purchaseItemId: z.string().min(1),
      quantity: z.coerce.number().positive()
    })
  ).min(1)
});

const cancelPurchaseReturnSchema = z.object({
  reason: z.string().trim().min(1).max(500)
});

async function getTreasuryAccount(type: "CASH" | "BANK", id: string) {
  if (type === "CASH") {
    const account = await prisma.cashRegisterAccount.findUnique({
      where: { id }
    });

    return account
      ? { type, id: account.id, currencyId: account.currencyId }
      : null;
  }

  const account = await prisma.bankAccount.findUnique({
    where: { id }
  });

  return account
    ? { type, id: account.id, currencyId: account.currencyId }
    : null;
}

purchaseReturnsRoute.get("/", async (c) => {
  const pagination = getPagePagination(c);
  const search = c.req.query("search")?.trim();
  const where = {
    createdAt: getRecentDateRange(c),
    ...(search
      ? {
          OR: [
            { returnNo: { contains: search, mode: "insensitive" as const } },
            { note: { contains: search, mode: "insensitive" as const } },
            { purchase: { invoiceNo: { contains: search, mode: "insensitive" as const } } },
            { supplier: { name: { contains: search, mode: "insensitive" as const } } },
            { supplier: { phone: { contains: search, mode: "insensitive" as const } } },
            { items: { some: { product: { name: { contains: search, mode: "insensitive" as const } } } } },
            { items: { some: { product: { barcode: { contains: search, mode: "insensitive" as const } } } } },
            { items: { some: { product: { barcodeNormalized: { contains: normalizeBarcodeText(search), mode: "insensitive" as const } } } } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.purchaseReturn.findMany({
    where,
    include: {
      purchase: true,
      supplier: true,
      currency: true,
      createdByUser: true,
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
    prisma.purchaseReturn.count({ where })
  ]);

  return c.json({ data: items, pagination: createPaginationMeta({ ...pagination, total }) });
});

purchaseReturnsRoute.post("/", async (c) => {
  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => null);
  const parsed = purchaseReturnSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const purchase = await prisma.purchase.findUnique({
    where: { id: parsed.data.purchaseId },
    include: {
      supplier: true,
      items: {
        include: {
          product: true,
          warehouse: true,
          lot: true,
          returnItems: {
            include: {
              purchaseReturn: true
            }
          }
        }
      }
    }
  });

  if (!purchase) {
    return c.json({ message: "Purchase not found" }, 404);
  }

  if (purchase.status === PurchaseStatus.CANCELLED) {
    return c.json({ message: "خرید ابطال شده و قابل برگشت نیست." }, 400);
  }

  const requestedByItem = new Map(parsed.data.items.map((item) => [item.purchaseItemId, item]));

  if (requestedByItem.size !== parsed.data.items.length) {
    return c.json({ message: "Duplicate return item was provided" }, 400);
  }

  const preparedItems: any[] = [];

  for (const requestItem of parsed.data.items) {
    const purchaseItem = purchase.items.find((item) => item.id === requestItem.purchaseItemId);

    if (!purchaseItem) {
      return c.json({ message: `Purchase item not found: ${requestItem.purchaseItemId}` }, 404);
    }

    const requestedQuantityBase = roundStockQuantity(
      requestItem.quantity * Number(purchaseItem.conversionRate)
    );
    const returnedBase = purchaseItem.returnItems.filter((item) => !item.purchaseReturn.cancelledAt).reduce(
      (sum, item) => sum + Number(item.quantityBase || 0),
      0
    );
    const availableBase = roundStockQuantity(
      Number(purchaseItem.quantityBase) - returnedBase
    );
    const unitRoundingTolerance = Math.max(
      0.0001,
      Number(purchaseItem.conversionRate) * 0.00005 + 0.00001
    );
    const quantityBase =
      Math.abs(requestedQuantityBase - availableBase) <= unitRoundingTolerance
        ? availableBase
        : requestedQuantityBase;

    if (quantityBase > availableBase + unitRoundingTolerance) {
      return c.json({
        message: `Return quantity exceeds purchased quantity for ${purchaseItem.product.name}`,
        availableBase
      }, 400);
    }

    if (purchaseItem.lotId) {
      const lot = await prisma.stockLot.findUnique({
        where: { id: purchaseItem.lotId }
      });

      if (!lot || Number(lot.remainingQuantity) < quantityBase) {
        return c.json({
          message: `Not enough remaining stock to return ${purchaseItem.product.name}`
        }, 400);
      }
    }

    const ratio = requestItem.quantity / Number(purchaseItem.quantity);
    const totalCost = Number(purchaseItem.totalCost) * ratio;

    preparedItems.push({
      purchaseItem,
      quantity: requestItem.quantity,
      quantityBase,
      unitCost: Number(purchaseItem.unitCost),
      unitCostBase: Number(purchaseItem.unitCostBase),
      totalCost
    });
  }

  const subtotal = preparedItems.reduce((sum, item) => sum + item.totalCost, 0);

  if (parsed.data.receivedAmount > subtotal) {
    return c.json({ message: "Received amount cannot exceed return total" }, 400);
  }

  const payableAdjustment = subtotal - parsed.data.receivedAmount;
  const purchaseSnapshot = {
    exchangeRate: Number(purchase.exchangeRate || 1),
    baseCurrencyId: purchase.baseCurrencyId ?? null
  };

  if (payableAdjustment > 0 && !purchase.supplierId) {
    return c.json({ message: "Supplier is required when return is not fully received" }, 400);
  }

  let receiveAccount: Awaited<ReturnType<typeof getTreasuryAccount>> = null;

  if (parsed.data.receivedAmount > 0) {
    if (!parsed.data.receiveAccountType || !parsed.data.receiveAccountId) {
      return c.json({ message: "Receive account is required" }, 400);
    }

    receiveAccount = await getTreasuryAccount(parsed.data.receiveAccountType, parsed.data.receiveAccountId);

    if (!receiveAccount) {
      return c.json({ message: "Receive account not found" }, 404);
    }

    if (receiveAccount.currencyId !== purchase.currencyId) {
      return c.json({ message: "Receive account currency must match purchase currency" }, 400);
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    await acquireTransactionLock(tx, "purchase-document", purchase.id);
    const currentPurchase = await tx.purchase.findUnique({
      where: { id: purchase.id },
      select: { status: true }
    });
    if (!currentPurchase || currentPurchase.status === PurchaseStatus.CANCELLED) {
      throw new Error("خرید ابطال شده و قابل برگشت نیست.");
    }

    const inventory = new InventoryMutationService(tx);
    await inventory.prepare(
      preparedItems.map((item) => ({
        productId: item.purchaseItem.productId,
        warehouseId: item.purchaseItem.warehouseId
      }))
    );
    const operationOccurredAt = kabulNow();
    const inventoryOperation = await inventory.startOperation({
      ...inventoryOperationEvidence(c),
      type: "PURCHASE_RETURN",
      clientRequestId: requestOperationId(
        parsed.data.clientRequestId ||
          c.req.header("Idempotency-Key") ||
          c.req.header("x-idempotency-key"),
        "purchase-return"
      ),
      occurredAt: operationOccurredAt,
      createdByUserId: authUser?.id || null
    });
    for (const item of preparedItems) {
      const returned = await tx.purchaseReturnItem.aggregate({
        where: {
          purchaseItemId: item.purchaseItem.id,
          purchaseReturn: { cancelledAt: null }
        },
        _sum: { quantityBase: true }
      });
      const available = roundStockQuantity(
        Number(item.purchaseItem.quantityBase) - Number(returned._sum.quantityBase || 0)
      );
      if (item.quantityBase > available + 0.0001) {
        throw new Error(
          `مقدار برگشتی ${item.purchaseItem.product.name} از مقدار قابل برگشت بیشتر است.`
        );
      }
    }

    const purchaseReturn = await tx.purchaseReturn.create({
      data: {
        returnNo: parsed.data.returnNo ?? createOperationReference("PR"),
        purchaseId: purchase.id,
        supplierId: purchase.supplierId,
        currencyId: purchase.currencyId,
        subtotal,
        receivedAmount: parsed.data.receivedAmount,
        payableAdjustment,
        ...snapshotBaseFields(purchaseSnapshot, {
          subtotal,
          paidAmount: parsed.data.receivedAmount,
          remainingAmount: payableAdjustment
        }),
        note: parsed.data.note ?? null,
        createdByUserId: authUser?.id || null
      }
    });

    const createdItems = [];

    for (const item of preparedItems) {
      if (item.purchaseItem.lotId) {
        const stockUpdate = await tx.stockLot.updateMany({
          where: {
            id: item.purchaseItem.lotId,
            remainingQuantity: {
              gte: stockDecimal(item.quantityBase)
            }
          },
          data: {
            remainingQuantity: {
              decrement: stockDecimal(item.quantityBase)
            }
          }
        });

        if (stockUpdate.count !== 1) {
          throw new Error("Not enough stock for concurrent purchase return");
        }
      }

      await tx.stockMovement.create({
        data: {
          productId: item.purchaseItem.productId,
          warehouseId: item.purchaseItem.warehouseId,
          lotId: item.purchaseItem.lotId,
          operationId: inventoryOperation.id,
          occurredAt: operationOccurredAt,
          type: StockMovementType.PURCHASE_RETURN,
          quantity: item.quantityBase,
          unitCost: item.unitCostBase,
          currencyId: purchase.currencyId,
          exchangeRate: purchaseSnapshot.exchangeRate,
          baseUnitCost: Number(item.unitCostBase || 0) * purchaseSnapshot.exchangeRate,
          referenceType: "PURCHASE_RETURN",
          referenceId: purchaseReturn.id,
          note: parsed.data.note ?? null,
          createdByUserId: authUser?.id || null
        }
      });

      const returnItem = await tx.purchaseReturnItem.create({
        data: {
          purchaseReturnId: purchaseReturn.id,
          purchaseItemId: item.purchaseItem.id,
          productId: item.purchaseItem.productId,
          warehouseId: item.purchaseItem.warehouseId,
          lotId: item.purchaseItem.lotId,
          quantity: item.quantity,
          quantityBase: item.quantityBase,
          unitCost: item.unitCost,
          unitCostBase: item.unitCostBase,
          totalCost: item.totalCost
        }
      });

      createdItems.push(returnItem);
    }

    let moneyTransaction = null;

    if (receiveAccount && parsed.data.receivedAmount > 0) {
      if (receiveAccount.type === "CASH") {
        const updated = await tx.cashRegisterAccount.update({
          where: { id: receiveAccount.id },
          data: { balance: { increment: parsed.data.receivedAmount } }
        });

        moneyTransaction = await tx.moneyTransaction.create({
          data: {
            currencyId: purchase.currencyId,
            cashRegisterAccountId: receiveAccount.id,
            type: MoneyTransactionType.ADJUSTMENT,
            direction: MoneyDirection.IN,
            amount: parsed.data.receivedAmount,
            balanceAfter: updated.balance,
            ...snapshotBaseFields(purchaseSnapshot, {
              amount: parsed.data.receivedAmount,
              balanceAfter: Number(updated.balance)
            }),
            referenceType: "PURCHASE_RETURN",
            referenceId: purchaseReturn.id,
            note: parsed.data.note ?? "Purchase return received",
            createdByUserId: authUser?.id || null
          }
        });
      } else {
        const updated = await tx.bankAccount.update({
          where: { id: receiveAccount.id },
          data: { balance: { increment: parsed.data.receivedAmount } }
        });

        moneyTransaction = await tx.moneyTransaction.create({
          data: {
            currencyId: purchase.currencyId,
            bankAccountId: receiveAccount.id,
            type: MoneyTransactionType.ADJUSTMENT,
            direction: MoneyDirection.IN,
            amount: parsed.data.receivedAmount,
            balanceAfter: updated.balance,
            ...snapshotBaseFields(purchaseSnapshot, {
              amount: parsed.data.receivedAmount,
              balanceAfter: Number(updated.balance)
            }),
            referenceType: "PURCHASE_RETURN",
            referenceId: purchaseReturn.id,
            note: parsed.data.note ?? "Purchase return received",
            createdByUserId: authUser?.id || null
          }
        });
      }
    }

    let partyTransaction = null;

    if (purchase.supplierId && payableAdjustment > 0) {
      await tx.partyAccount.upsert({
        where: {
          partyId_currencyId: {
            partyId: purchase.supplierId,
            currencyId: purchase.currencyId
          }
        },
        create: {
          partyId: purchase.supplierId,
          currencyId: purchase.currencyId,
          debitBalance: payableAdjustment,
          creditBalance: 0
        },
        update: {
          debitBalance: {
            increment: payableAdjustment
          }
        }
      });

      partyTransaction = await tx.partyTransaction.create({
        data: {
          partyId: purchase.supplierId,
          currencyId: purchase.currencyId,
          type: PartyTransactionType.ADJUSTMENT,
          side: PartyAccountSide.DEBIT,
          amount: payableAdjustment,
          referenceType: "PURCHASE_RETURN",
          referenceId: purchaseReturn.id,
          note: parsed.data.note ?? "Purchase return payable adjustment"
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
    }> = [];

    if (receiveAccount && parsed.data.receivedAmount > 0) {
      lines.push({
        accountCode: treasuryAccountCode(receiveAccount.type),
        debit: parsed.data.receivedAmount,
        exchangeRate: purchaseSnapshot.exchangeRate,
        baseCurrencyId: purchaseSnapshot.baseCurrencyId,
        note: "Purchase return received"
      });
    }

    if (payableAdjustment > 0) {
      lines.push({
        accountCode: "2000",
        debit: payableAdjustment,
        exchangeRate: purchaseSnapshot.exchangeRate,
        baseCurrencyId: purchaseSnapshot.baseCurrencyId,
        note: "Purchase return payable adjustment"
      });
    }

    lines.push({
      accountCode: "1300",
      credit: subtotal,
      exchangeRate: purchaseSnapshot.exchangeRate,
      baseCurrencyId: purchaseSnapshot.baseCurrencyId,
      note: "Inventory returned to supplier"
    });

    const journalEntry = await createPostedJournal(tx, {
      entryNoPrefix: "JE-PR",
      sourceType: "PURCHASE_RETURN",
      sourceId: purchaseReturn.id,
      description: "Purchase return",
      createdByUserId: authUser?.id || null,
      lines
    });

    return {
      purchaseReturn,
      items: createdItems,
      moneyTransaction,
      partyTransaction,
      journalEntry
    };
  });

  await writeAudit(c, {
    action: "PURCHASE_RETURN_CREATED",
    entityType: "PurchaseReturn",
    entityId: result.purchaseReturn.id,
    metadata: {
      purchaseId: purchase.id,
      subtotal,
      receivedAmount: parsed.data.receivedAmount
    }
  });

  return c.json({ data: result }, 201);
});

purchaseReturnsRoute.post("/:id/cancel", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");
  const parsed = cancelPurchaseReturnSchema.safeParse(await c.req.json().catch(() => ({})));

  if (!parsed.success) return c.json(zodError(parsed.error), 400);

  const purchaseReturn = await prisma.purchaseReturn.findUnique({
    where: { id },
    include: { items: true }
  });

  if (!purchaseReturn) return c.json({ message: "Purchase return not found" }, 404);
  if (purchaseReturn.cancelledAt) return c.json({ message: "Purchase return is already cancelled" }, 400);

  const moneyTransactions = await prisma.moneyTransaction.findMany({
    where: { referenceType: "PURCHASE_RETURN", referenceId: id }
  });
  const partyTransactions = await prisma.partyTransaction.findMany({
    where: { referenceType: "PURCHASE_RETURN", referenceId: id }
  });

  try {
    const result = await prisma.$transaction(async (tx) => {
      await acquireTransactionLock(tx, "purchase-return-cancel", id);
      const currentReturn = await tx.purchaseReturn.findUnique({
        where: { id },
        include: { items: true }
      });
      if (!currentReturn) throw new Error("Purchase return not found");
      if (currentReturn.cancelledAt) {
        throw new Error("Purchase return is already cancelled");
      }

      const inventory = new InventoryMutationService(tx);
      await inventory.lock(
        currentReturn.items.map((item) => ({
          productId: item.productId,
          warehouseId: item.warehouseId
        }))
      );
      const sourceMovement = await tx.stockMovement.findFirst({
        where: { referenceType: "PURCHASE_RETURN", referenceId: id },
        select: { operationId: true }
      });
      const operationOccurredAt = kabulNow();

      for (const item of currentReturn.items) {
        if (item.lotId) {
          await tx.stockLot.update({
            where: { id: item.lotId },
            data: { remainingQuantity: { increment: stockDecimal(Number(item.quantityBase)) } }
          });
        }
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            warehouseId: item.warehouseId,
            lotId: item.lotId,
            operationId: sourceMovement?.operationId ?? null,
            occurredAt: operationOccurredAt,
            type: StockMovementType.PURCHASE,
            quantity: item.quantityBase,
            unitCost: item.unitCostBase,
            currencyId: currentReturn.currencyId,
            exchangeRate: Number(currentReturn.exchangeRate || 1),
            baseUnitCost: Number(item.unitCostBase || 0) * Number(currentReturn.exchangeRate || 1),
            referenceType: "PURCHASE_RETURN_CANCEL",
            referenceId: id,
            note: parsed.data.reason,
            createdByUserId: authUser?.id ?? null
          }
        });
      }

      for (const transaction of moneyTransactions) {
        const amount = Number(transaction.amount);
        const snapshot = {
          exchangeRate: Number(transaction.exchangeRate || 1),
          baseCurrencyId: transaction.baseCurrencyId
        };
        let balanceAfter = 0;

        if (transaction.cashRegisterAccountId) {
          const account = await tx.cashRegisterAccount.findUnique({ where: { id: transaction.cashRegisterAccountId } });
          if (!account || Number(account.balance) < amount) throw new Error("Not enough cash balance to cancel purchase return");
          const updated = await tx.cashRegisterAccount.update({
            where: { id: transaction.cashRegisterAccountId },
            data: { balance: { decrement: amount } }
          });
          balanceAfter = Number(updated.balance);
        } else if (transaction.bankAccountId) {
          const account = await tx.bankAccount.findUnique({ where: { id: transaction.bankAccountId } });
          if (!account || Number(account.balance) < amount) throw new Error("Not enough bank balance to cancel purchase return");
          const updated = await tx.bankAccount.update({
            where: { id: transaction.bankAccountId },
            data: { balance: { decrement: amount } }
          });
          balanceAfter = Number(updated.balance);
        }

        await tx.moneyTransaction.create({
          data: {
            currencyId: transaction.currencyId,
            cashRegisterAccountId: transaction.cashRegisterAccountId,
            bankAccountId: transaction.bankAccountId,
            type: MoneyTransactionType.ADJUSTMENT,
            direction: MoneyDirection.OUT,
            amount,
            balanceAfter,
            baseAmount: toBaseAmount(amount, snapshot),
            baseBalanceAfter: toBaseAmount(balanceAfter, snapshot),
            ...snapshot,
            referenceType: "PURCHASE_RETURN_CANCEL",
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
            referenceType: "PURCHASE_RETURN_CANCEL",
            referenceId: id,
            note: parsed.data.reason
          }
        });
      }

      const journalEntry = await createReversalJournal(tx, {
        sourceType: "PURCHASE_RETURN",
        sourceId: id,
        reversalSourceType: "PURCHASE_RETURN_CANCEL",
        reversalSourceId: id,
        entryNoPrefix: "JE-PRC",
        description: "Purchase return cancellation",
        createdByUserId: authUser?.id ?? null
      });
      const updated = await tx.purchaseReturn.update({
        where: { id },
        data: {
          cancelledAt: new Date(),
          cancelledByUserId: authUser?.id ?? null,
          cancellationReason: parsed.data.reason
        }
      });

      if (sourceMovement?.operationId) {
        const changed = await tx.inventoryOperation.updateMany({
          where: {
            id: sourceMovement.operationId,
            status: "COMPLETED",
            cancelledAt: null
          },
          data: {
            status: "CANCELLED",
            cancelledAt: operationOccurredAt,
            cancelReason: parsed.data.reason,
            cancelledByUserId: authUser?.id ?? null
          }
        });
        if (changed.count !== 1) {
          throw new Error("Purchase return was cancelled concurrently");
        }
      }

      return { purchaseReturn: updated, journalEntry };
    });

    await writeAudit(c, {
      action: "PURCHASE_RETURN_CANCELLED",
      entityType: "PurchaseReturn",
      entityId: id,
      metadata: { reason: parsed.data.reason }
    });
    return c.json({ data: result });
  } catch (error) {
    return c.json({ message: error instanceof Error ? error.message : "Purchase return cancellation failed" }, 400);
  }
});
