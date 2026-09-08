import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { zodError } from "../../lib/api";
import { getAuthUser, writeAudit } from "../../lib/auth";
import { resolveCurrencySnapshot, snapshotBaseFields, toBaseAmount } from "../../lib/currency-rates";
import { createPostedJournal, createReversalJournal, treasuryAccountCode } from "../../lib/journal";
import { getRequestPosDevice } from "../../lib/pos-device";
import { createPaginationMeta, getPagePagination } from "../../lib/pagination";
import { getRecentDateRange } from "../../lib/recent-date-range";
import { kabulNow, parseKabulDateInput } from "../../lib/kabul-date";
import { cacheDeleteByPattern } from "../../lib/cache";
import { normalizeBarcodeText } from "../../lib/barcode";
import {
  MoneyDirection,
  MoneyTransactionType,
  PartyAccountSide,
  PartyTransactionType,
  PartyType,
  PurchasePaymentStatus,
  PurchaseStatus,
  StockMovementType
} from "../../generated/prisma/enums";
import { acquireTransactionLock } from "../../lib/db-lock";
import { roundStockQuantity, stockDecimal } from "../../lib/stock-quantity";
import {
  InventoryMutationService,
  requestOperationId
} from "../../lib/inventory-mutation";
import { inventoryOperationEvidence } from "../../lib/request-evidence";

export const purchasesRoute = new Hono();

const paymentAccountTypeSchema = z.enum(["CASH", "BANK"]);

const purchaseItemSchema = z.object({
  productId: z.string().min(1),
  warehouseId: z.string().min(1),
  unitId: z.string().min(1),
  quantity: z.coerce.number().positive(),
  unitCost: z.coerce.number().nonnegative(),
  updateSalePrice: z.boolean().optional().default(false),
  salePrice: z.coerce.number().nonnegative().optional().nullable(),
  expiryDate: z.string().trim().optional().nullable()
});

const createPurchaseSchema = z.object({
  invoiceNo: z.string().trim().max(120).optional().nullable(),
  supplierId: z.string().trim().optional().nullable(),
  currencyId: z.string().min(1),
  purchaseDate: z.string().trim().optional().nullable(),
  discount: z.coerce.number().nonnegative().default(0),
  paidAmount: z.coerce.number().nonnegative().default(0),
  paymentAccountType: paymentAccountTypeSchema.optional().nullable(),
  paymentAccountId: z.string().trim().optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  items: z.array(purchaseItemSchema).min(1)
});

const purchasePaymentSchema = z.object({
  amount: z.coerce.number().positive(),
  paymentAccountType: paymentAccountTypeSchema,
  paymentAccountId: z.string().trim().min(1),
  note: z.string().trim().max(500).optional().nullable()
});

const cancelPurchaseSchema = z.object({
  reason: z.string().trim().max(500).optional().nullable()
});

function parseDate(value: string | null | undefined) {
  if (!value) return null;

  const date = parseKabulDateInput(value);

  if (!date || date === "INVALID_DATE" || Number.isNaN(date.getTime())) {
    return "INVALID_DATE";
  }

  return date;
}

purchasesRoute.get("/", async (c) => {
  const supplierId = c.req.query("supplierId");
  const search = c.req.query("search")?.trim();
  const pagination = getPagePagination(c);
  const purchaseDate = getRecentDateRange(c);
  const where = {
    ...(supplierId ? { supplierId } : {}),
    purchaseDate,
    ...(search
      ? {
          OR: [
            { invoiceNo: { contains: search, mode: "insensitive" as const } },
            { note: { contains: search, mode: "insensitive" as const } },
            { supplier: { name: { contains: search, mode: "insensitive" as const } } },
            { supplier: { phone: { contains: search, mode: "insensitive" as const } } },
            { supplier: { code: { contains: search, mode: "insensitive" as const } } },
            { items: { some: { product: { name: { contains: search, mode: "insensitive" as const } } } } },
            { items: { some: { product: { barcode: { contains: search, mode: "insensitive" as const } } } } },
            { items: { some: { product: { barcodeNormalized: { contains: normalizeBarcodeText(search), mode: "insensitive" as const } } } } },
          ],
        }
      : {})
  };

  const [items, total, summary] = await Promise.all([
    prisma.purchase.findMany({
    where,
    include: {
      supplier: true,
      currency: true,
      items: {
        include: {
          product: true,
          warehouse: true,
          unit: true,
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
    prisma.purchase.count({ where }),
    prisma.purchase.aggregate({
      where: { ...where, status: { not: PurchaseStatus.CANCELLED } },
      _count: true,
      _sum: { baseTotal: true, basePaidAmount: true, baseRemainingAmount: true }
    })
  ]);

  return c.json({
    data: items,
    pagination: createPaginationMeta({ ...pagination, total }),
    summary: {
      count: summary._count,
      total: Number(summary._sum.baseTotal || 0),
      paid: Number(summary._sum.basePaidAmount || 0),
      remaining: Number(summary._sum.baseRemainingAmount || 0)
    }
  });
});

purchasesRoute.get("/:id", async (c) => {
  const id = c.req.param("id");

  const item = await prisma.purchase.findUnique({
    where: { id },
    include: {
      supplier: true,
      currency: true,
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

  if (!item) {
    return c.json({ message: "Purchase not found" }, 404);
  }

  return c.json({ data: item });
});

purchasesRoute.post("/:id/cancel", async (c) => {
  const authUser = getAuthUser(c);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = cancelPurchaseSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const purchase = await prisma.purchase.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          lot: true
        }
      },
      returns: true
    }
  });

  if (!purchase) {
    return c.json({ message: "Purchase not found" }, 404);
  }

  if (purchase.status === PurchaseStatus.CANCELLED) {
    return c.json({ message: "Purchase is already cancelled" }, 400);
  }

  if (purchase.returns.some((item) => !item.cancelledAt)) {
    return c.json({ message: "Purchase has returns. Cancel the return workflow manually instead." }, 400);
  }

  for (const item of purchase.items) {
    if (!item.lot || Number(item.lot.remainingQuantity) < Number(item.quantityBase)) {
      return c.json({
        message: "Purchase cannot be cancelled because its stock was already used or transferred"
      }, 400);
    }
  }

  const moneyTransactions = await prisma.moneyTransaction.findMany({
    where: {
      referenceId: purchase.id,
      direction: MoneyDirection.OUT
    }
  });

  const result = await prisma.$transaction(async (tx) => {
    await acquireTransactionLock(tx, "purchase-document", purchase.id);
    const currentPurchase = await tx.purchase.findUnique({
      where: { id: purchase.id },
      include: {
        returns: true,
        items: {
          include: { lot: true }
        }
      }
    });
    if (!currentPurchase || currentPurchase.status === PurchaseStatus.CANCELLED) {
      throw new Error("این خرید قبلاً ابطال شده است.");
    }
    if (currentPurchase.returns.some((item) => !item.cancelledAt)) {
      throw new Error("خرید دارای برگشتی فعال است و قابل ابطال نیست.");
    }

    const inventory = new InventoryMutationService(tx);
    await inventory.lock(
      currentPurchase.items.map((item) => ({
        productId: item.productId,
        warehouseId: item.warehouseId
      }))
    );
    const sourceMovement = await tx.stockMovement.findFirst({
      where: { referenceType: "PURCHASE", referenceId: currentPurchase.id },
      select: { operationId: true }
    });

    for (const item of currentPurchase.items) {
      if (item.lotId) {
        const changed = await tx.stockLot.updateMany({
          where: {
            id: item.lotId,
            remainingQuantity: { gte: stockDecimal(Number(item.quantityBase)) }
          },
          data: {
            remainingQuantity: {
              decrement: stockDecimal(Number(item.quantityBase))
            }
          }
        });
        if (changed.count !== 1) {
          throw new Error(
            "موجودی این خرید مصرف یا انتقال شده و ابطال ممکن نیست."
          );
        }
      }

      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          warehouseId: item.warehouseId,
          lotId: item.lotId,
          type: StockMovementType.PURCHASE_RETURN,
          quantity: item.quantityBase,
          unitCost: item.unitCostBase,
          currencyId: item.lot?.currencyId ?? currentPurchase.currencyId,
          exchangeRate: item.lot?.exchangeRate ?? 1,
          baseUnitCost: item.lot?.baseUnitCost ?? item.unitCostBase,
          operationId: sourceMovement?.operationId ?? null,
          occurredAt: kabulNow(),
          referenceType: "PURCHASE_CANCEL",
          referenceId: purchase.id,
          note: parsed.data.reason ?? "Purchase cancelled",
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
        throw new Error("این خرید هم‌زمان ابطال شده است.");
      }
    }

    for (const transaction of moneyTransactions) {
      const amount = Number(transaction.amount);

      if (transaction.cashRegisterAccountId) {
        const updated = await tx.cashRegisterAccount.update({
          where: { id: transaction.cashRegisterAccountId },
          data: { balance: { increment: amount } }
        });

        await tx.moneyTransaction.create({
          data: {
            currencyId: transaction.currencyId,
            cashRegisterAccountId: transaction.cashRegisterAccountId,
            type: MoneyTransactionType.ADJUSTMENT,
            direction: MoneyDirection.IN,
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
            referenceType: "PURCHASE_CANCEL",
            referenceId: purchase.id,
            note: parsed.data.reason ?? "Purchase cancellation",
            createdByUserId: authUser?.id ?? null
          }
        });
      }

      if (transaction.bankAccountId) {
        const updated = await tx.bankAccount.update({
          where: { id: transaction.bankAccountId },
          data: { balance: { increment: amount } }
        });

        await tx.moneyTransaction.create({
          data: {
            currencyId: transaction.currencyId,
            bankAccountId: transaction.bankAccountId,
            type: MoneyTransactionType.ADJUSTMENT,
            direction: MoneyDirection.IN,
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
            referenceType: "PURCHASE_CANCEL",
            referenceId: purchase.id,
            note: parsed.data.reason ?? "Purchase cancellation",
            createdByUserId: authUser?.id ?? null
          }
        });
      }
    }

    const partyTransactions = await tx.partyTransaction.findMany({
      where: {
        referenceId: purchase.id
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
          referenceType: "PURCHASE_CANCEL",
          referenceId: purchase.id,
          note: parsed.data.reason ?? "Purchase cancellation"
        }
      });
    }

    const journalEntry = await createReversalJournal(tx, {
      sourceType: "PURCHASE",
      sourceId: purchase.id,
      reversalSourceType: "PURCHASE_CANCEL",
      reversalSourceId: purchase.id,
      entryNoPrefix: "JE-PC",
      description: "Purchase cancellation",
      createdByUserId: authUser?.id ?? null
    });

    const updatedPurchase = await tx.purchase.update({
      where: { id: purchase.id },
      data: {
        status: PurchaseStatus.CANCELLED,
        paymentStatus: PurchasePaymentStatus.UNPAID,
        paidAmount: 0,
        remainingAmount: 0,
        basePaidAmount: 0,
        baseRemainingAmount: 0,
        note: [purchase.note, parsed.data.reason ? `Cancelled: ${parsed.data.reason}` : "Cancelled"]
          .filter(Boolean)
          .join("\n")
      },
      include: {
        supplier: true,
        currency: true,
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

    return { purchase: updatedPurchase, journalEntry };
  });

  await writeAudit(c, {
    action: "PURCHASE_CANCELLED",
    entityType: "Purchase",
    entityId: purchase.id,
    metadata: {
      reason: parsed.data.reason ?? null
    }
  });

  return c.json({ data: result });
});

purchasesRoute.post("/:id/payments", async (c) => {
  const id = c.req.param("id");
  const authUser = getAuthUser(c);
  const posDevice = await getRequestPosDevice(c, authUser?.id || null);
  const body = await c.req.json().catch(() => null);
  const parsed = purchasePaymentSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const purchase = await prisma.purchase.findUnique({
    where: { id },
    include: {
      supplier: true,
      currency: true
    }
  });

  if (!purchase) {
    return c.json({ message: "Purchase not found" }, 404);
  }

  const remainingAmount = Number(purchase.remainingAmount);

  if (remainingAmount <= 0) {
    return c.json({ message: "Purchase is already fully paid" }, 400);
  }

  if (parsed.data.amount > remainingAmount) {
    return c.json({ message: "Payment amount cannot be greater than remaining purchase amount" }, 400);
  }

  if (!purchase.supplierId) {
    return c.json({ message: "Supplier is required for invoice payment" }, 400);
  }

  let paymentAccount:
    | {
        kind: "CASH" | "BANK";
        id: string;
        currencyId: string;
        balance: number;
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
      currencyId: account.currencyId,
      balance: Number(account.balance)
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
      currencyId: account.currencyId,
      balance: Number(account.balance)
    };
  }

  if (paymentAccount.currencyId !== purchase.currencyId) {
    return c.json({ message: "Payment account currency must match purchase currency" }, 400);
  }

  if (paymentAccount.balance < parsed.data.amount) {
    return c.json({ message: "Not enough balance in payment account" }, 400);
  }

  const nextPaid = Number(purchase.paidAmount) + parsed.data.amount;
  const nextRemaining = remainingAmount - parsed.data.amount;
  const purchaseSnapshot = {
    exchangeRate: Number(purchase.exchangeRate || 1),
    baseCurrencyId: purchase.baseCurrencyId ?? null
  };
  const nextStatus =
    nextRemaining <= 0
      ? PurchasePaymentStatus.PAID
      : nextPaid > 0
        ? PurchasePaymentStatus.PARTIAL
        : PurchasePaymentStatus.UNPAID;

  const result = await prisma.$transaction(async (tx) => {
    const updatedPurchase = await tx.purchase.update({
      where: { id: purchase.id },
      data: {
        paidAmount: nextPaid,
        remainingAmount: nextRemaining,
        basePaidAmount: toBaseAmount(nextPaid, purchaseSnapshot),
        baseRemainingAmount: toBaseAmount(nextRemaining, purchaseSnapshot),
        paymentStatus: nextStatus
      },
      include: {
        supplier: true,
        currency: true,
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
          partyId: purchase.supplierId!,
          currencyId: purchase.currencyId
        }
      },
      create: {
        partyId: purchase.supplierId!,
        currencyId: purchase.currencyId,
        debitBalance: parsed.data.amount,
        creditBalance: 0
      },
      update: {
        debitBalance: {
          increment: parsed.data.amount
        }
      }
    });

    const partyTransaction = await tx.partyTransaction.create({
      data: {
        partyId: purchase.supplierId!,
        currencyId: purchase.currencyId,
        type: PartyTransactionType.PAYMENT_PAID,
        side: PartyAccountSide.DEBIT,
        amount: parsed.data.amount,
        referenceType: "PURCHASE_PAYMENT",
        referenceId: purchase.id,
        note: parsed.data.note ?? "Purchase invoice payment"
      }
    });

    let moneyTransaction = null;

    if (paymentAccount.kind === "CASH") {
      const updatedAccount = await tx.cashRegisterAccount.update({
        where: { id: paymentAccount.id },
        data: { balance: { decrement: parsed.data.amount } }
      });

      moneyTransaction = await tx.moneyTransaction.create({
        data: {
          currencyId: purchase.currencyId,
          cashRegisterAccountId: paymentAccount.id,
          type: MoneyTransactionType.SUPPLIER_PAYMENT,
          direction: MoneyDirection.OUT,
          amount: parsed.data.amount,
          balanceAfter: updatedAccount.balance,
          ...snapshotBaseFields(purchaseSnapshot, {
            amount: parsed.data.amount,
            balanceAfter: Number(updatedAccount.balance)
          }),
          referenceType: "PURCHASE_PAYMENT",
          referenceId: partyTransaction.id,
          note: parsed.data.note ?? "Purchase invoice payment",
          createdByUserId: authUser?.id || null,
          posDeviceId: posDevice?.id || null
        }
      });
    } else {
      const updatedAccount = await tx.bankAccount.update({
        where: { id: paymentAccount.id },
        data: { balance: { decrement: parsed.data.amount } }
      });

      moneyTransaction = await tx.moneyTransaction.create({
        data: {
          currencyId: purchase.currencyId,
          bankAccountId: paymentAccount.id,
          type: MoneyTransactionType.SUPPLIER_PAYMENT,
          direction: MoneyDirection.OUT,
          amount: parsed.data.amount,
          balanceAfter: updatedAccount.balance,
          ...snapshotBaseFields(purchaseSnapshot, {
            amount: parsed.data.amount,
            balanceAfter: Number(updatedAccount.balance)
          }),
          referenceType: "PURCHASE_PAYMENT",
          referenceId: partyTransaction.id,
          note: parsed.data.note ?? "Purchase invoice payment",
          createdByUserId: authUser?.id || null,
          posDeviceId: posDevice?.id || null
        }
      });
    }

    const journalEntry = await createPostedJournal(tx, {
      entryNoPrefix: "JE-PPAY",
      sourceType: "PURCHASE_PAYMENT",
      sourceId: partyTransaction.id,
      description: "Purchase invoice payment",
      createdByUserId: authUser?.id || null,
      lines: [
        {
          accountCode: "2000",
          partyId: purchase.supplierId,
          debit: parsed.data.amount,
          exchangeRate: purchaseSnapshot.exchangeRate,
          baseCurrencyId: purchaseSnapshot.baseCurrencyId,
          note: parsed.data.note ?? "Supplier payable reduced"
        },
        {
          accountCode: treasuryAccountCode(paymentAccount.kind),
          partyId: purchase.supplierId,
          credit: parsed.data.amount,
          exchangeRate: purchaseSnapshot.exchangeRate,
          baseCurrencyId: purchaseSnapshot.baseCurrencyId,
          note: "Paid to supplier"
        }
      ]
    });

    return { purchase: updatedPurchase, partyTransaction, moneyTransaction, journalEntry };
  });

  await writeAudit(c, {
    action: "PURCHASE_PAYMENT_PAID",
    entityType: "Purchase",
    entityId: purchase.id,
    metadata: {
      amount: parsed.data.amount,
      remainingAmount: nextRemaining
    }
  });

  return c.json({ data: result }, 201);
});

purchasesRoute.post("/", async (c) => {
  const authUser = getAuthUser(c);
  const body = await c.req.json().catch(() => null);
  const parsed = createPurchaseSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(zodError(parsed.error), 400);
  }

  const currency = await prisma.currency.findUnique({
    where: { id: parsed.data.currencyId }
  });

  if (!currency) {
    return c.json({ message: "Currency not found" }, 404);
  }

  if (parsed.data.supplierId) {
    const supplier = await prisma.party.findUnique({
      where: { id: parsed.data.supplierId }
    });

    if (!supplier) {
      return c.json({ message: "Supplier not found" }, 404);
    }

    if (supplier.type !== PartyType.SUPPLIER && supplier.type !== PartyType.BOTH) {
      return c.json({ message: "Selected party is not a supplier" }, 400);
    }
  }

  const purchaseDate = parseDate(parsed.data.purchaseDate);

  if (purchaseDate === "INVALID_DATE") {
    return c.json({ message: "Invalid purchaseDate" }, 400);
  }

  const preparedItems: Array<{
    productId: string;
    warehouseId: string;
    unitId: string;
    quantity: number;
    conversionRate: number;
    quantityBase: number;
    unitCost: number;
    unitCostBase: number;
    grossTotalCost: number;
    allocatedDiscount: number;
    totalCost: number;
    baseUnitId: string;
    updateSalePrice: boolean;
    salePrice: number | null;
    expiryDate: Date | null;
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

    const expiryDate = parseDate(rawItem.expiryDate);

    if (expiryDate === "INVALID_DATE") {
      return c.json({ message: `Invalid expiryDate for product: ${product.name}` }, 400);
    }

    if (product.hasExpiry && !expiryDate) {
      return c.json(
        {
          message: `Expiry date is required for product: ${product.name}`
        },
        400
      );
    }

    const quantityBase = roundStockQuantity(rawItem.quantity * conversionRate);
    const unitCostBase = conversionRate > 0 ? rawItem.unitCost / conversionRate : rawItem.unitCost;
    const grossTotalCost = rawItem.quantity * rawItem.unitCost;

    preparedItems.push({
      productId: rawItem.productId,
      warehouseId: rawItem.warehouseId,
      unitId: rawItem.unitId,
      quantity: rawItem.quantity,
      conversionRate,
      quantityBase,
      unitCost: rawItem.unitCost,
      unitCostBase,
      grossTotalCost,
      allocatedDiscount: 0,
      totalCost: grossTotalCost,
      baseUnitId: product.baseUnitId,
      updateSalePrice: Boolean(rawItem.updateSalePrice),
      salePrice: rawItem.salePrice ?? null,
      expiryDate
    });
  }

  const subtotal = preparedItems.reduce((sum, item) => sum + item.grossTotalCost, 0);
  const total = subtotal - parsed.data.discount;

  if (total < 0) {
    return c.json({ message: "Discount cannot be greater than subtotal" }, 400);
  }

  if (parsed.data.paidAmount > total) {
    return c.json({ message: "Paid amount cannot be greater than total" }, 400);
  }

  let remainingDiscount = parsed.data.discount;
  preparedItems.forEach((item, index) => {
    const allocatedDiscount =
      index === preparedItems.length - 1
        ? remainingDiscount
        : subtotal > 0
          ? Number(((item.grossTotalCost / subtotal) * parsed.data.discount).toFixed(4))
          : 0;
    const netTotalCost = Math.max(0, item.grossTotalCost - allocatedDiscount);
    item.allocatedDiscount = allocatedDiscount;
    item.totalCost = netTotalCost;
    item.unitCost = item.quantity > 0 ? netTotalCost / item.quantity : item.unitCost;
    item.unitCostBase = item.quantityBase > 0 ? netTotalCost / item.quantityBase : item.unitCostBase;
    remainingDiscount = Number((remainingDiscount - allocatedDiscount).toFixed(4));
  });

  const remainingAmount = total - parsed.data.paidAmount;

  if (remainingAmount > 0 && !parsed.data.supplierId) {
    return c.json({ message: "Supplier is required for credit purchase" }, 400);
  }

  if (parsed.data.paidAmount > 0 && (!parsed.data.paymentAccountType || !parsed.data.paymentAccountId)) {
    return c.json({ message: "Payment account is required when paidAmount is greater than zero" }, 400);
  }

  let paymentAccount:
    | {
        kind: "CASH" | "BANK";
        id: string;
        currencyId: string;
        balance: number;
      }
    | null = null;

  if (parsed.data.paidAmount > 0 && parsed.data.paymentAccountType && parsed.data.paymentAccountId) {
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
        currencyId: account.currencyId,
        balance: Number(account.balance)
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
        currencyId: account.currencyId,
        balance: Number(account.balance)
      };
    }

    if (paymentAccount.currencyId !== parsed.data.currencyId) {
      return c.json({ message: "Payment account currency must match purchase currency" }, 400);
    }

    if (paymentAccount.balance < parsed.data.paidAmount) {
      return c.json({ message: "Not enough balance in payment account" }, 400);
    }
  }

  const paymentStatus =
    remainingAmount === 0
      ? PurchasePaymentStatus.PAID
      : parsed.data.paidAmount > 0
        ? PurchasePaymentStatus.PARTIAL
        : PurchasePaymentStatus.UNPAID;

  let currencySnapshot;

  try {
    currencySnapshot = await resolveCurrencySnapshot(prisma, parsed.data.currencyId);
  } catch (error) {
    return c.json(
      { message: error instanceof Error ? error.message : "Currency rate could not be resolved" },
      400
    );
  }

  const inventoryOccurredAt = purchaseDate || kabulNow();
  const inventoryClientRequestId = requestOperationId(
    c.req.header("Idempotency-Key") || c.req.header("x-idempotency-key"),
    "PURCHASE"
  );

  const result = await prisma.$transaction(async (tx) => {
    const inventory = new InventoryMutationService(tx);
    await inventory.prepare(
      preparedItems.map((item) => ({
        productId: item.productId,
        warehouseId: item.warehouseId
      }))
    );
    const inventoryOperation = await inventory.startOperation({
      ...inventoryOperationEvidence(c),
      type: "PURCHASE",
      clientRequestId: inventoryClientRequestId,
      occurredAt: inventoryOccurredAt,
      createdByUserId: authUser?.id
    });

    const purchase = await tx.purchase.create({
      data: {
        invoiceNo: parsed.data.invoiceNo ?? null,
        supplierId: parsed.data.supplierId ?? null,
        currencyId: parsed.data.currencyId,
        status: PurchaseStatus.COMPLETED,
        paymentStatus,
        subtotal,
        discount: parsed.data.discount,
        total,
        paidAmount: parsed.data.paidAmount,
        remainingAmount,
        ...snapshotBaseFields(currencySnapshot, {
          subtotal,
          total,
          paidAmount: parsed.data.paidAmount,
          remainingAmount
        }),
        purchaseDate: purchaseDate || new Date(),
        note: parsed.data.note ?? null,
        createdByUserId: authUser?.id || null
      }
    });

    const createdItems = [];

    for (const preparedItem of preparedItems) {
      const lot = await tx.stockLot.create({
        data: {
          productId: preparedItem.productId,
          warehouseId: preparedItem.warehouseId,
          expiryDate: preparedItem.expiryDate,
          initialQuantity: preparedItem.quantityBase,
          remainingQuantity: preparedItem.quantityBase,
          unitCost: preparedItem.unitCostBase,
          currencyId: parsed.data.currencyId,
          exchangeRate: currencySnapshot.exchangeRate,
          baseUnitCost: preparedItem.unitCostBase * currencySnapshot.exchangeRate,
          sourceType: "PURCHASE",
          sourceId: purchase.id,
          note: parsed.data.note ?? null
        }
      });

      await tx.stockMovement.create({
        data: {
          productId: preparedItem.productId,
          warehouseId: preparedItem.warehouseId,
          lotId: lot.id,
          type: StockMovementType.PURCHASE,
          quantity: preparedItem.quantityBase,
          operationId: inventoryOperation.id,
          occurredAt: inventoryOccurredAt,
          unitCost: preparedItem.unitCostBase,
          currencyId: parsed.data.currencyId,
          exchangeRate: currencySnapshot.exchangeRate,
          baseUnitCost: preparedItem.unitCostBase * currencySnapshot.exchangeRate,
          referenceType: "PURCHASE",
          referenceId: purchase.id,
          note: parsed.data.note ?? null,
          createdByUserId: authUser?.id || null
        }
      });

      const purchaseItem = await tx.purchaseItem.create({
        data: {
          purchaseId: purchase.id,
          productId: preparedItem.productId,
          warehouseId: preparedItem.warehouseId,
          unitId: preparedItem.unitId,
          lotId: lot.id,
          quantity: preparedItem.quantity,
          conversionRate: preparedItem.conversionRate,
          quantityBase: preparedItem.quantityBase,
          unitCost: preparedItem.unitCost,
          unitCostBase: preparedItem.unitCostBase,
          totalCost: preparedItem.totalCost,
          expiryDate: preparedItem.expiryDate
        },
        include: {
          product: true,
          warehouse: true,
          unit: true,
          lot: true
        }
      });

      createdItems.push(purchaseItem);

      if (preparedItem.updateSalePrice && preparedItem.salePrice !== null) {
        const salePriceInBaseCurrency =
          preparedItem.salePrice * currencySnapshot.exchangeRate;
        const baseUnitSalePrice =
          preparedItem.conversionRate > 0
            ? salePriceInBaseCurrency / preparedItem.conversionRate
            : salePriceInBaseCurrency;
        const purchasePriceInBaseCurrency =
          preparedItem.unitCost * currencySnapshot.exchangeRate;
        const baseUnitPurchasePrice =
          preparedItem.unitCostBase * currencySnapshot.exchangeRate;

        await tx.productUnit.upsert({
          where: {
            productId_unitId: {
              productId: preparedItem.productId,
              unitId: preparedItem.unitId
            }
          },
          create: {
            productId: preparedItem.productId,
            unitId: preparedItem.unitId,
            conversionRate: preparedItem.conversionRate,
            salePrice: salePriceInBaseCurrency,
            purchasePrice: purchasePriceInBaseCurrency,
            isDefaultPurchase: false,
            isDefaultSale: false
          },
          update: {
            conversionRate: preparedItem.conversionRate,
            salePrice: salePriceInBaseCurrency,
            purchasePrice: purchasePriceInBaseCurrency
          }
        });

        if (preparedItem.baseUnitId && preparedItem.baseUnitId !== preparedItem.unitId) {
          await tx.productUnit.upsert({
            where: {
              productId_unitId: {
                productId: preparedItem.productId,
                unitId: preparedItem.baseUnitId
              }
            },
            create: {
              productId: preparedItem.productId,
              unitId: preparedItem.baseUnitId,
              conversionRate: 1,
              salePrice: baseUnitSalePrice,
              purchasePrice: baseUnitPurchasePrice,
              isDefaultPurchase: false,
              isDefaultSale: false
            },
            update: {
              conversionRate: 1,
              salePrice: baseUnitSalePrice,
              purchasePrice: baseUnitPurchasePrice
            }
          });
        }
      }
    }

    let moneyTransaction = null;

    if (paymentAccount && parsed.data.paidAmount > 0) {
      if (paymentAccount.kind === "CASH") {
        const updatedAccount = await tx.cashRegisterAccount.update({
          where: { id: paymentAccount.id },
          data: {
            balance: {
              decrement: parsed.data.paidAmount
            }
          }
        });

        moneyTransaction = await tx.moneyTransaction.create({
          data: {
            currencyId: parsed.data.currencyId,
            cashRegisterAccountId: paymentAccount.id,
            type: MoneyTransactionType.SUPPLIER_PAYMENT,
            direction: MoneyDirection.OUT,
            amount: parsed.data.paidAmount,
            balanceAfter: updatedAccount.balance,
            ...snapshotBaseFields(currencySnapshot, {
              amount: parsed.data.paidAmount,
              balanceAfter: Number(updatedAccount.balance)
            }),
            referenceType: "PURCHASE",
            referenceId: purchase.id,
            note: "Purchase payment",
            createdByUserId: authUser?.id || null
          }
        });
      } else {
        const updatedAccount = await tx.bankAccount.update({
          where: { id: paymentAccount.id },
          data: {
            balance: {
              decrement: parsed.data.paidAmount
            }
          }
        });

        moneyTransaction = await tx.moneyTransaction.create({
          data: {
            currencyId: parsed.data.currencyId,
            bankAccountId: paymentAccount.id,
            type: MoneyTransactionType.SUPPLIER_PAYMENT,
            direction: MoneyDirection.OUT,
            amount: parsed.data.paidAmount,
            balanceAfter: updatedAccount.balance,
            ...snapshotBaseFields(currencySnapshot, {
              amount: parsed.data.paidAmount,
              balanceAfter: Number(updatedAccount.balance)
            }),
            referenceType: "PURCHASE",
            referenceId: purchase.id,
            note: "Purchase payment",
            createdByUserId: authUser?.id || null
          }
        });
      }
    }

    let supplierTransaction = null;

    if (parsed.data.supplierId && remainingAmount > 0) {
      await tx.partyAccount.upsert({
        where: {
          partyId_currencyId: {
            partyId: parsed.data.supplierId,
            currencyId: parsed.data.currencyId
          }
        },
        create: {
          partyId: parsed.data.supplierId,
          currencyId: parsed.data.currencyId,
          debitBalance: 0,
          creditBalance: remainingAmount
        },
        update: {
          creditBalance: {
            increment: remainingAmount
          }
        }
      });

      supplierTransaction = await tx.partyTransaction.create({
        data: {
          partyId: parsed.data.supplierId,
          currencyId: parsed.data.currencyId,
          type: PartyTransactionType.PURCHASE_CREDIT,
          side: PartyAccountSide.CREDIT,
          amount: remainingAmount,
          referenceType: "PURCHASE",
          referenceId: purchase.id,
          note: "Credit purchase"
        }
      });
    }

    const journalEntry = await createPostedJournal(tx, {
      entryNoPrefix: "JE-PUR",
      sourceType: "PURCHASE",
      sourceId: purchase.id,
      description: `Purchase ${purchase.invoiceNo || purchase.id}`,
      createdByUserId: authUser?.id || null,
      lines: [
        {
          accountCode: "1300",
          partyId: parsed.data.supplierId || null,
          debit: total,
          exchangeRate: currencySnapshot.exchangeRate,
          baseCurrencyId: currencySnapshot.baseCurrencyId,
          note: "Inventory purchased"
        },
        ...(paymentAccount && parsed.data.paidAmount > 0
          ? [{
              accountCode: treasuryAccountCode(paymentAccount.kind),
              partyId: parsed.data.supplierId || null,
              credit: parsed.data.paidAmount,
              exchangeRate: currencySnapshot.exchangeRate,
              baseCurrencyId: currencySnapshot.baseCurrencyId,
              note: "Purchase payment"
            }]
          : []),
        ...(remainingAmount > 0
          ? [{
              accountCode: "2000",
              partyId: parsed.data.supplierId || null,
              credit: remainingAmount,
              exchangeRate: currencySnapshot.exchangeRate,
              baseCurrencyId: currencySnapshot.baseCurrencyId,
              note: "Supplier payable"
            }]
          : [])
      ]
    });

    const fullPurchase = await tx.purchase.findUnique({
      where: { id: purchase.id },
      include: {
        supplier: true,
        currency: true,
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

    return {
      purchase: fullPurchase,
      items: createdItems,
      moneyTransaction,
      supplierTransaction,
      journalEntry
    };
  });

  await writeAudit(c, {
    action: "PURCHASE_CREATED",
    entityType: "Purchase",
    entityId: result.purchase?.id || null,
    metadata: {
      total,
      paidAmount: parsed.data.paidAmount,
      invoiceNo: parsed.data.invoiceNo || null
    }
  });

  if (preparedItems.some((item) => item.updateSalePrice)) {
    await cacheDeleteByPattern("pos:products:*");
  }

  return c.json({ data: result }, 201);
});
