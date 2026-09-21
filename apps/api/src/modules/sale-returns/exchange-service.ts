import { z } from "zod";

import type { Prisma } from "../../generated/prisma/client";
import {
  MoneyDirection,
  MoneyTransactionType,
  PartyAccountSide,
  PartyTransactionType,
  PartyType,
  SalePaymentStatus,
  SaleStatus,
  StockMovementType,
} from "../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import { snapshotBaseFields, resolveCurrencySnapshot } from "../../lib/currency-rates";
import { acquireTransactionLock } from "../../lib/db-lock";
import { InventoryMutationService } from "../../lib/inventory-mutation";
import { createPostedJournal, treasuryAccountCode } from "../../lib/journal";
import { kabulNow } from "../../lib/kabul-date";
import { createOperationReference } from "../../lib/operation-id";
import { ensureSaleCogsJournal, isUniqueConstraintError } from "../../lib/sale-cogs";
import { allocateMoneyByWeight, resolveSaleItemPricing, roundMoney4 } from "../../lib/sale-pricing";
import { roundStockQuantity, stockDecimal } from "../../lib/stock-quantity";

const accountTypeSchema = z.enum(["CASH", "BANK"]);

const paymentLineSchema = z.object({
  paymentAccountType: accountTypeSchema,
  paymentAccountId: z.string().trim().min(1),
  amount: z.coerce.number().positive(),
});

const replacementItemSchema = z.object({
  productId: z.string().trim().min(1),
  warehouseId: z.string().trim().min(1),
  unitId: z.string().trim().min(1),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().nonnegative(),
  discount: z.coerce.number().nonnegative().default(0),
});

export const saleExchangeSchema = z.object({
  clientRequestId: z.string().trim().min(8).max(100),
  saleId: z.string().trim().min(1),
  customerId: z.string().trim().min(1).optional().nullable(),
  returnNo: z.string().trim().max(120).optional().nullable(),
  refundAccountType: accountTypeSchema.optional().nullable(),
  refundAccountId: z.string().trim().optional().nullable(),
  refundAmount: z.coerce.number().nonnegative().default(0),
  note: z.string().trim().max(500).optional().nullable(),
  returnItems: z.array(
    z.object({
      saleItemId: z.string().trim().min(1),
      quantity: z.coerce.number().positive(),
    }),
  ).min(1),
  replacement: z.object({
    invoiceNo: z.string().trim().max(120).optional().nullable(),
    paidAmount: z.coerce.number().nonnegative().default(0),
    paymentAccountType: accountTypeSchema.optional().nullable(),
    paymentAccountId: z.string().trim().optional().nullable(),
    paymentLines: z.array(paymentLineSchema).optional().default([]),
    note: z.string().trim().max(500).optional().nullable(),
    items: z.array(replacementItemSchema).min(1),
  }),
});

export type SaleExchangeInput = z.infer<typeof saleExchangeSchema>;

export type SaleExchangeActor = {
  id?: string | null;
};

export type SaleExchangePosDevice = {
  id?: string | null;
} | null;

export type SaleExchangeEvidence = {
  sourceChannel?: string | null;
  sourceDeviceCode?: string | null;
  appVersion?: string | null;
  correlationId?: string | null;
  requestIp?: string | null;
};

type TreasuryAccount = {
  type: "CASH" | "BANK";
  id: string;
  currencyId: string;
  balance: number;
};

type PaymentLine = {
  kind: "CASH" | "BANK";
  id: string;
  currencyId: string;
  amount: number;
};

type PreparedReplacementItem = {
  productId: string;
  warehouseId: string;
  unitId: string;
  quantity: number;
  conversionRate: number;
  quantityBase: number;
  unitPrice: number;
  discount: number;
};

type LotAllocation = {
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
};

class SaleExchangeReplayError extends Error {}

const CASH_EXCHANGE_CUSTOMER_CODE = "SYSTEM-CASH-CUSTOMER";
const CASH_EXCHANGE_CUSTOMER_NAME = "مشتری نقدی";

function operationRequestId(clientRequestId: string, suffix: "RETURN" | "SALE") {
  return `${clientRequestId}:${suffix}`;
}

async function getTreasuryAccount(
  tx: Prisma.TransactionClient,
  type: "CASH" | "BANK",
  id: string,
): Promise<TreasuryAccount | null> {
  if (type === "CASH") {
    const account = await tx.cashRegisterAccount.findUnique({ where: { id } });
    return account
      ? {
          type,
          id: account.id,
          currencyId: account.currencyId,
          balance: Number(account.balance),
        }
      : null;
  }

  const account = await tx.bankAccount.findUnique({ where: { id } });
  return account
    ? {
        type,
        id: account.id,
        currencyId: account.currencyId,
        balance: Number(account.balance),
      }
    : null;
}

async function resolveExchangeCustomer(
  tx: Prisma.TransactionClient,
  sourceSale: { customerId: string | null },
  requestedCustomerId: string | null | undefined,
  createdByUserId: string | null | undefined,
) {
  if (sourceSale.customerId) {
    if (requestedCustomerId && requestedCustomerId !== sourceSale.customerId) {
      throw new Error("مشتری تعویض باید با مشتری فاکتور اصلی یکسان باشد.");
    }

    const customer = await tx.party.findUnique({ where: { id: sourceSale.customerId } });
    if (!customer || (customer.type !== PartyType.CUSTOMER && customer.type !== PartyType.BOTH)) {
      throw new Error("مشتری فاکتور اصلی برای تعویض معتبر نیست.");
    }
    if (!customer.isActive || customer.deletedAt) {
      throw new Error("مشتری فاکتور اصلی غیرفعال است و تعویض برای او ثبت نمی‌شود.");
    }
    return customer;
  }

  if (requestedCustomerId) {
    throw new Error("برای فروش نقدی، مشتری تعویض به صورت خودکار تعیین می‌شود.");
  }

  // Cash sales have no historical party. A single, explicit system party keeps
  // the new return/replacement documents linked without changing the old sale.
  await acquireTransactionLock(tx, "sale-exchange-cash-customer", CASH_EXCHANGE_CUSTOMER_CODE);
  const existingCashCustomer = await tx.party.findFirst({
    where: {
      code: CASH_EXCHANGE_CUSTOMER_CODE,
      deletedAt: null,
    },
    orderBy: { createdAt: "asc" },
  });
  if (existingCashCustomer) {
    if (
      !existingCashCustomer.isActive ||
      (existingCashCustomer.type !== PartyType.CUSTOMER && existingCashCustomer.type !== PartyType.BOTH)
    ) {
      throw new Error("مشتری نقدی سیستمی غیرفعال یا نامعتبر است.");
    }
    return existingCashCustomer;
  }

  return tx.party.create({
    data: {
      type: PartyType.CUSTOMER,
      code: CASH_EXCHANGE_CUSTOMER_CODE,
      name: CASH_EXCHANGE_CUSTOMER_NAME,
      note: "مشتری سیستمی برای اسناد تعویض فروش نقدی",
      createdByUserId: createdByUserId ?? null,
    },
  });
}

async function resolvePaymentLines(
  tx: Prisma.TransactionClient,
  input: SaleExchangeInput,
  currencyId: string,
): Promise<PaymentLine[]> {
  const requested =
    input.replacement.paymentLines.length > 0
      ? input.replacement.paymentLines
      : input.replacement.paidAmount > 0 &&
          input.replacement.paymentAccountType &&
          input.replacement.paymentAccountId
        ? [
            {
              paymentAccountType: input.replacement.paymentAccountType,
              paymentAccountId: input.replacement.paymentAccountId,
              amount: input.replacement.paidAmount,
            },
          ]
        : [];

  const paymentTotal = roundMoney4(
    requested.reduce((sum, item) => sum + roundMoney4(item.amount), 0),
  );
  if (paymentTotal !== roundMoney4(input.replacement.paidAmount)) {
    throw new Error("جمع پرداخت‌ها باید با مبلغ پرداخت جدید برابر باشد.");
  }
  if (input.replacement.paidAmount > 0 && requested.length === 0) {
    throw new Error("برای پرداخت جدید، حساب صندوق یا بانک را انتخاب کنید.");
  }

  const lines: PaymentLine[] = [];
  for (const item of requested) {
    const account = await getTreasuryAccount(
      tx,
      item.paymentAccountType,
      item.paymentAccountId,
    );
    if (!account) {
      throw new Error("حساب پرداخت انتخاب‌شده پیدا نشد.");
    }
    if (account.currencyId !== currencyId) {
      throw new Error("کرنسی حساب پرداخت باید با کرنسی فروش یکسان باشد.");
    }
    lines.push({
      kind: account.type,
      id: account.id,
      currencyId: account.currencyId,
      amount: roundMoney4(item.amount),
    });
  }

  return lines;
}

function prepareReturnItems(sourceSale: any, input: SaleExchangeInput) {
  const requestedByItem = new Map(
    input.returnItems.map((item) => [item.saleItemId, item]),
  );
  if (requestedByItem.size !== input.returnItems.length) {
    throw new Error("یک قلم برگشتی بیش از یک بار وارد شده است.");
  }

  const prepared: Array<any> = [];
  const pricing = resolveSaleItemPricing(sourceSale.discount, sourceSale.items);

  for (const requestItem of input.returnItems) {
    const saleItem = sourceSale.items.find((item: any) => item.id === requestItem.saleItemId);
    if (!saleItem) {
      throw new Error("یکی از اقلام انتخاب‌شده به این فاکتور تعلق ندارد.");
    }

    const activeReturnItems = saleItem.returnItems.filter(
      (item: any) => !item.saleReturn.cancelledAt,
    );
    const requestedQuantity = roundMoney4(requestItem.quantity);
    const returnedQuantity = roundMoney4(
      activeReturnItems.reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0),
    );
    const availableQuantity = roundMoney4(Number(saleItem.quantity) - returnedQuantity);
    const requestedBase = roundMoney4(requestedQuantity * Number(saleItem.conversionRate));
    const returnedBase = roundMoney4(
      activeReturnItems.reduce(
        (sum: number, item: any) => sum + Number(item.quantityBase || 0),
        0,
      ),
    );
    const availableBase = roundMoney4(Number(saleItem.quantityBase) - returnedBase);
    const tolerance = Math.max(
      0.0001,
      Number(saleItem.conversionRate) * 0.00005 + 0.00001,
    );
    const quantityBase =
      Math.abs(requestedQuantity - availableQuantity) <= 0.0001 ||
      Math.abs(requestedBase - availableBase) <= tolerance
        ? availableBase
        : requestedBase;

    if (quantityBase <= 0 || quantityBase > availableBase + tolerance) {
      throw new Error(`مقدار برگشتی ${saleItem.product.name} از مقدار قابل برگشت بیشتر است.`);
    }

    const fullNet = roundMoney4(pricing.get(saleItem.id)?.netTotalPrice ?? saleItem.totalPrice);
    const returnedNet = roundMoney4(
      activeReturnItems.reduce((sum: number, item: any) => sum + Number(item.totalPrice || 0), 0),
    );
    const remainingNet = Math.max(0, roundMoney4(fullNet - returnedNet));
    const returningAll = Math.abs(quantityBase - availableBase) <= tolerance;
    const ratio = Number(saleItem.quantityBase) > 0 ? quantityBase / Number(saleItem.quantityBase) : 0;
    const totalPrice = returningAll
      ? remainingNet
      : Math.min(remainingNet, roundMoney4(fullNet * ratio));

    const fullTotalCost = saleItem.totalCost === null ? null : roundMoney4(saleItem.totalCost);
    const returnedTotalCost = roundMoney4(
      activeReturnItems.reduce((sum: number, item: any) => sum + Number(item.totalCost || 0), 0),
    );
    const remainingTotalCost =
      fullTotalCost === null ? null : Math.max(0, roundMoney4(fullTotalCost - returnedTotalCost));
    const totalCost =
      remainingTotalCost === null
        ? null
        : returningAll
          ? remainingTotalCost
          : Math.min(remainingTotalCost, roundMoney4(fullTotalCost! * ratio));

    const fullBaseTotalCost =
      saleItem.baseTotalCost === null ? fullTotalCost : roundMoney4(saleItem.baseTotalCost);
    const returnedBaseTotalCost = roundMoney4(
      activeReturnItems.reduce(
        (sum: number, item: any) =>
          sum + Number(item.baseTotalCost ?? item.totalCost ?? 0),
        0,
      ),
    );
    const remainingBaseTotalCost =
      fullBaseTotalCost === null
        ? null
        : Math.max(0, roundMoney4(fullBaseTotalCost - returnedBaseTotalCost));
    const baseTotalCost =
      remainingBaseTotalCost === null
        ? null
        : returningAll
          ? remainingBaseTotalCost
          : Math.min(remainingBaseTotalCost, roundMoney4(fullBaseTotalCost! * ratio));

    prepared.push({
      saleItem,
      quantity: requestedQuantity,
      quantityBase,
      unitPrice: Number(saleItem.unitPrice),
      totalPrice,
      unitCostBase: saleItem.unitCostBase === null ? null : Number(saleItem.unitCostBase),
      totalCost,
      baseTotalCost,
    });
  }

  return prepared;
}

async function prepareReplacementItems(
  tx: Prisma.TransactionClient,
  input: SaleExchangeInput,
): Promise<PreparedReplacementItem[]> {
  const prepared: PreparedReplacementItem[] = [];
  for (const item of input.replacement.items) {
    const product = await tx.product.findUnique({
      where: { id: item.productId },
      include: { units: true },
    });
    if (!product) throw new Error("یکی از محصولات جایگزین پیدا نشد.");

    const warehouse = await tx.warehouse.findUnique({ where: { id: item.warehouseId } });
    if (!warehouse) throw new Error("گدام انتخاب‌شده برای یکی از اقلام پیدا نشد.");

    const productUnit = product.units.find((unit) => unit.unitId === item.unitId);
    const conversionRate = productUnit
      ? Number(productUnit.conversionRate)
      : product.baseUnitId === item.unitId
        ? 1
        : 0;
    if (!Number.isFinite(conversionRate) || conversionRate <= 0) {
      throw new Error(`واحد فروش برای محصول ${product.name} معتبر نیست.`);
    }

    const discount = roundMoney4(item.discount);
    const grossTotal = roundMoney4(item.quantity * item.unitPrice);
    if (discount > grossTotal) {
      throw new Error(`تخفیف قلم ${product.name} از مبلغ آن بیشتر است.`);
    }

    prepared.push({
      productId: item.productId,
      warehouseId: item.warehouseId,
      unitId: item.unitId,
      quantity: roundMoney4(item.quantity),
      conversionRate,
      quantityBase: roundStockQuantity(item.quantity * conversionRate),
      unitPrice: roundMoney4(item.unitPrice),
      discount,
    });
  }
  return prepared;
}

async function replayExchange(clientRequestId: string) {
  const replacementSale = await prisma.sale.findUnique({
    where: { clientRequestId },
    include: {
      customer: true,
      currency: true,
      items: { include: { product: true, warehouse: true, unit: true, lot: true } },
    },
  });
  if (!replacementSale) return null;

  const exchange = await prisma.saleExchange.findUnique({
    where: { replacementSaleId: replacementSale.id },
    include: {
      sourceSale: { select: { id: true, invoiceNo: true } },
      saleReturn: { include: { items: true } },
    },
  });
  if (!exchange) return null;
  return { exchange, replacementSale, saleReturn: exchange.saleReturn, idempotentReplay: true };
}

export async function createSaleExchange(input: {
  data: SaleExchangeInput;
  actor: SaleExchangeActor;
  posDevice: SaleExchangePosDevice;
  evidence: SaleExchangeEvidence;
}) {
  const existing = await replayExchange(input.data.clientRequestId);
  if (existing) return existing;

  try {
    return await prisma.$transaction(
      async (tx) => {
        const existingReplacement = await tx.sale.findUnique({
          where: { clientRequestId: input.data.clientRequestId },
          select: { id: true },
        });
        if (existingReplacement) throw new SaleExchangeReplayError();

        await acquireTransactionLock(tx, "sale-document", input.data.saleId);
        const sourceSale = await tx.sale.findUnique({
          where: { id: input.data.saleId },
          include: {
            items: {
              include: {
                product: true,
                warehouse: true,
                lot: true,
                returnItems: { include: { saleReturn: true } },
              },
            },
          },
        });
        if (!sourceSale) throw new Error("فاکتور فروش اصلی پیدا نشد.");
        if (sourceSale.status === SaleStatus.CANCELLED) {
          throw new Error("فروش ابطال شده و قابل برگشت یا تعویض نیست.");
        }
        const customer = await resolveExchangeCustomer(
          tx,
          sourceSale,
          input.data.customerId,
          input.actor.id,
        );

        const returnItems = prepareReturnItems(sourceSale, input.data);
        const replacementItems = await prepareReplacementItems(tx, input.data);
        const inventory = new InventoryMutationService(tx);
        await inventory.prepare([
          ...returnItems.map((item) => ({
            productId: item.saleItem.productId,
            warehouseId: item.saleItem.warehouseId,
          })),
          ...replacementItems.map((item) => ({
            productId: item.productId,
            warehouseId: item.warehouseId,
          })),
        ]);

        const returnSubtotal = roundMoney4(
          returnItems.reduce((sum, item) => sum + item.totalPrice, 0),
        );
        const refundAmount = roundMoney4(input.data.refundAmount);
        if (refundAmount > returnSubtotal) {
          throw new Error("مبلغ برگشت پول نمی‌تواند از جمع برگشتی بیشتر باشد.");
        }
        const receivableAdjustment = roundMoney4(returnSubtotal - refundAmount);
        const sourceSnapshot = {
          exchangeRate: Number(sourceSale.exchangeRate || 1),
          baseCurrencyId: sourceSale.baseCurrencyId ?? null,
        };
        const currencySnapshot = await resolveCurrencySnapshot(tx, sourceSale.currencyId);

        const requestedPaymentAccounts =
          input.data.replacement.paymentLines.length > 0
            ? input.data.replacement.paymentLines.map(
                (item) => `${item.paymentAccountType}:${item.paymentAccountId}`,
              )
            : input.data.replacement.paidAmount > 0 &&
                input.data.replacement.paymentAccountType &&
                input.data.replacement.paymentAccountId
              ? [
                  `${input.data.replacement.paymentAccountType}:${input.data.replacement.paymentAccountId}`,
                ]
              : [];
        const treasuryLocks = [
          ...requestedPaymentAccounts,
          ...(input.data.refundAmount > 0 &&
          input.data.refundAccountType &&
          input.data.refundAccountId
            ? [`${input.data.refundAccountType}:${input.data.refundAccountId}`]
            : []),
        ].sort();
        for (const key of [...new Set(treasuryLocks)]) {
          await acquireTransactionLock(tx, "sale-exchange-treasury", key);
        }

        const paymentLines = await resolvePaymentLines(tx, input.data, sourceSale.currencyId);
        let refundAccount: TreasuryAccount | null = null;
        if (refundAmount > 0) {
          if (!input.data.refundAccountType || !input.data.refundAccountId) {
            throw new Error("برای برگشت پول، حساب صندوق یا بانک را انتخاب کنید.");
          }
          refundAccount = await getTreasuryAccount(
            tx,
            input.data.refundAccountType,
            input.data.refundAccountId,
          );
          if (!refundAccount) throw new Error("حساب برگشت پول پیدا نشد.");
          if (refundAccount.currencyId !== sourceSale.currencyId) {
            throw new Error("کرنسی حساب برگشت پول باید با کرنسی فروش یکسان باشد.");
          }
          if (refundAccount.balance + 0.0001 < refundAmount) {
            throw new Error("موجودی حساب برای برگشت پول کافی نیست.");
          }
        }

        const replacementSubtotal = roundMoney4(
          replacementItems.reduce(
            (sum, item) => sum + roundMoney4(item.quantity * item.unitPrice - item.discount),
            0,
          ),
        );
        const replacementTotal = replacementSubtotal;
        const cashPaidAmount = roundMoney4(input.data.replacement.paidAmount);
        if (cashPaidAmount > replacementTotal) {
          throw new Error("مبلغ پرداخت جدید نمی‌تواند از جمع اقلام جدید بیشتر باشد.");
        }
        // A return can leave a customer credit. Apply only the portion that can
        // settle the replacement invoice; any excess remains on the party account.
        const creditApplied = roundMoney4(
          Math.min(receivableAdjustment, replacementTotal - cashPaidAmount),
        );
        const settledPaidAmount = roundMoney4(cashPaidAmount + creditApplied);
        const replacementReceivableAmount = roundMoney4(replacementTotal - cashPaidAmount);
        const remainingAmount = roundMoney4(replacementReceivableAmount - creditApplied);
        const paymentStatus =
          remainingAmount === 0
            ? SalePaymentStatus.PAID
            : settledPaidAmount > 0
              ? SalePaymentStatus.PARTIAL
              : SalePaymentStatus.UNPAID;
        const occurredAt = kabulNow();

        const returnOperation = await inventory.startOperation({
          ...input.evidence,
          type: "SALE_RETURN",
          clientRequestId: operationRequestId(input.data.clientRequestId, "RETURN"),
          occurredAt,
          createdByUserId: input.actor.id ?? null,
        });
        const saleOperation = await inventory.startOperation({
          ...input.evidence,
          type: "SALE",
          clientRequestId: operationRequestId(input.data.clientRequestId, "SALE"),
          occurredAt,
          createdByUserId: input.actor.id ?? null,
        });

        const saleReturn = await tx.saleReturn.create({
          data: {
            returnNo: input.data.returnNo ?? createOperationReference("SR"),
            saleId: sourceSale.id,
            customerId: customer.id,
            currencyId: sourceSale.currencyId,
            subtotal: returnSubtotal,
            refundAmount,
            receivableAdjustment,
            ...snapshotBaseFields(sourceSnapshot, {
              subtotal: returnSubtotal,
              paidAmount: refundAmount,
              remainingAmount: receivableAdjustment,
            }),
            note: input.data.note ?? null,
            createdByUserId: input.actor.id ?? null,
            posDeviceId: input.posDevice?.id ?? null,
          },
        });

        let returnBaseTotalCost = 0;
        for (const item of returnItems) {
          if (item.saleItem.lotId) {
            await tx.stockLot.update({
              where: { id: item.saleItem.lotId },
              data: { remainingQuantity: { increment: stockDecimal(item.quantityBase) } },
            });
          }
          await tx.stockMovement.create({
            data: {
              productId: item.saleItem.productId,
              warehouseId: item.saleItem.warehouseId,
              lotId: item.saleItem.lotId,
              operationId: returnOperation.id,
              type: StockMovementType.SALE_RETURN,
              quantity: item.quantityBase,
              unitCost: item.unitCostBase,
              currencyId: item.saleItem.lot?.currencyId || sourceSale.currencyId,
              exchangeRate: Number(item.saleItem.lot?.exchangeRate || 1),
              baseUnitCost: Number(item.saleItem.lot?.baseUnitCost || item.unitCostBase || 0),
              occurredAt,
              referenceType: "SALE_RETURN",
              referenceId: saleReturn.id,
              note: input.data.note ?? null,
              createdByUserId: input.actor.id ?? null,
            },
          });
          await tx.saleReturnItem.create({
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
              baseTotalCost: item.baseTotalCost,
            },
          });
          returnBaseTotalCost += Number(item.baseTotalCost || 0);
        }

        if (refundAccount && refundAmount > 0) {
          if (refundAccount.type === "CASH") {
            const updated = await tx.cashRegisterAccount.update({
              where: { id: refundAccount.id },
              data: { balance: { decrement: refundAmount } },
            });
            await tx.moneyTransaction.create({
              data: {
                currencyId: sourceSale.currencyId,
                cashRegisterAccountId: refundAccount.id,
                type: MoneyTransactionType.ADJUSTMENT,
                direction: MoneyDirection.OUT,
                amount: refundAmount,
                balanceAfter: updated.balance,
                ...snapshotBaseFields(sourceSnapshot, {
                  amount: refundAmount,
                  balanceAfter: Number(updated.balance),
                }),
                referenceType: "SALE_RETURN",
                referenceId: saleReturn.id,
                note: input.data.note ?? "Sale exchange refund",
                createdByUserId: input.actor.id ?? null,
                posDeviceId: input.posDevice?.id ?? null,
              },
            });
          } else {
            const updated = await tx.bankAccount.update({
              where: { id: refundAccount.id },
              data: { balance: { decrement: refundAmount } },
            });
            await tx.moneyTransaction.create({
              data: {
                currencyId: sourceSale.currencyId,
                bankAccountId: refundAccount.id,
                type: MoneyTransactionType.ADJUSTMENT,
                direction: MoneyDirection.OUT,
                amount: refundAmount,
                balanceAfter: updated.balance,
                ...snapshotBaseFields(sourceSnapshot, {
                  amount: refundAmount,
                  balanceAfter: Number(updated.balance),
                }),
                referenceType: "SALE_RETURN",
                referenceId: saleReturn.id,
                note: input.data.note ?? "Sale exchange refund",
                createdByUserId: input.actor.id ?? null,
                posDeviceId: input.posDevice?.id ?? null,
              },
            });
          }
        }

        if (receivableAdjustment > 0) {
          await tx.partyAccount.upsert({
            where: { partyId_currencyId: { partyId: customer.id, currencyId: sourceSale.currencyId } },
            create: {
              partyId: customer.id,
              currencyId: sourceSale.currencyId,
              debitBalance: 0,
              creditBalance: receivableAdjustment,
            },
            update: { creditBalance: { increment: receivableAdjustment } },
          });
          await tx.partyTransaction.create({
            data: {
              partyId: customer.id,
              currencyId: sourceSale.currencyId,
              type: PartyTransactionType.ADJUSTMENT,
              side: PartyAccountSide.CREDIT,
              amount: receivableAdjustment,
              referenceType: "SALE_RETURN",
              referenceId: saleReturn.id,
              note: input.data.note ?? "Sale exchange credit",
            },
          });
        }

        await createPostedJournal(tx, {
          entryNoPrefix: "JE-SR",
          sourceType: "SALE_RETURN",
          sourceId: saleReturn.id,
          description: "Sale exchange return",
          createdByUserId: input.actor.id ?? null,
          lines: [
            {
              accountCode: "4200",
              debit: returnSubtotal,
              exchangeRate: sourceSnapshot.exchangeRate,
              baseCurrencyId: sourceSnapshot.baseCurrencyId,
              note: "Sale exchange return",
            },
            ...(refundAmount > 0 && refundAccount
              ? [{
                  accountCode: treasuryAccountCode(refundAccount.type),
                  credit: refundAmount,
                  exchangeRate: sourceSnapshot.exchangeRate,
                  baseCurrencyId: sourceSnapshot.baseCurrencyId,
                  note: "Sale exchange refund",
                }]
              : []),
            ...(receivableAdjustment > 0
              ? [{
                  accountCode: "1200",
                  credit: receivableAdjustment,
                  exchangeRate: sourceSnapshot.exchangeRate,
                  baseCurrencyId: sourceSnapshot.baseCurrencyId,
                  note: "Sale exchange credit",
                }]
              : []),
            ...(returnBaseTotalCost > 0
              ? [
                  {
                    accountCode: "1300",
                    debit: returnBaseTotalCost,
                    exchangeRate: 1,
                    baseCurrencyId: sourceSnapshot.baseCurrencyId,
                    note: "Sale exchange returned inventory",
                  },
                  {
                    accountCode: "5000",
                    credit: returnBaseTotalCost,
                    exchangeRate: 1,
                    baseCurrencyId: sourceSnapshot.baseCurrencyId,
                    note: "Sale exchange COGS reversal",
                  },
                ]
              : []),
          ],
        });

        const lockedItems: Array<PreparedReplacementItem & { allocations: LotAllocation[] }> = [];
        for (const item of replacementItems) {
          const lots = await tx.stockLot.findMany({
            where: {
              productId: item.productId,
              warehouseId: item.warehouseId,
              remainingQuantity: { gt: 0 },
            },
            orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          });
          let remainingBase = item.quantityBase;
          let remainingQuantity = item.quantity;
          const allocations: LotAllocation[] = [];
          for (const lot of lots) {
            if (remainingBase <= 0) break;
            const available = roundStockQuantity(Number(lot.remainingQuantity));
            const finishesLine = available + 0.00005 >= remainingBase;
            const quantity = finishesLine
              ? remainingQuantity
              : Math.floor((available / item.conversionRate + Number.EPSILON) * 10_000) / 10_000;
            const quantityBase = finishesLine
              ? remainingBase
              : roundStockQuantity(quantity * item.conversionRate);
            if (quantity <= 0) continue;
            const unitCostBase = Number(lot.unitCost);
            const costExchangeRate = Number(lot.exchangeRate || 1);
            const baseUnitCost = Number(lot.baseUnitCost || unitCostBase * costExchangeRate);
            allocations.push({
              lotId: lot.id,
              quantityBase,
              quantity,
              unitCostBase,
              totalCost: quantityBase * unitCostBase,
              baseUnitCost,
              baseTotalCost: quantityBase * baseUnitCost,
              costExchangeRate,
              currencyId: lot.currencyId,
              expiryDate: lot.expiryDate,
            });
            remainingBase = roundStockQuantity(remainingBase - quantityBase);
            remainingQuantity = roundStockQuantity(remainingQuantity - quantity);
          }
          if (remainingBase > 0) {
            throw new Error("موجودی یکی از اقلام جدید برای ثبت تعویض کافی نیست.");
          }
          lockedItems.push({ ...item, allocations });
        }

        const replacementSale = await tx.sale.create({
          data: {
            clientRequestId: input.data.clientRequestId,
            invoiceNo: input.data.replacement.invoiceNo ?? createOperationReference("EX"),
            customerId: customer.id,
            currencyId: sourceSale.currencyId,
            status: SaleStatus.COMPLETED,
            paymentStatus,
            subtotal: replacementSubtotal,
            discount: 0,
            total: replacementTotal,
            paidAmount: settledPaidAmount,
            remainingAmount,
            ...snapshotBaseFields(currencySnapshot, {
              subtotal: replacementSubtotal,
              total: replacementTotal,
              paidAmount: settledPaidAmount,
              remainingAmount,
            }),
            saleDate: occurredAt,
            note: input.data.replacement.note ?? input.data.note ?? null,
            cashierId: input.actor.id ?? null,
            posDeviceId: input.posDevice?.id ?? null,
          },
        });

        const exchange = await tx.saleExchange.create({
          data: {
            exchangeNo: createOperationReference("SX"),
            sourceSaleId: sourceSale.id,
            replacementSaleId: replacementSale.id,
            saleReturnId: saleReturn.id,
            cashPaidAmount,
            creditApplied,
            outstandingAmount: remainingAmount,
            note: input.data.note ?? null,
            createdByUserId: input.actor.id ?? null,
          },
          include: {
            sourceSale: { select: { id: true, invoiceNo: true } },
            saleReturn: { include: { items: true } },
          },
        });

        const saleLines = lockedItems.flatMap((item) => {
          const weights = item.allocations.map((allocation) => allocation.quantity);
          const grossAllocations = allocateMoneyByWeight(
            roundMoney4(item.quantity * item.unitPrice),
            weights,
          );
          const discountAllocations = allocateMoneyByWeight(item.discount, weights);
          return item.allocations.map((allocation, index) => ({
            item,
            allocation,
            discount: discountAllocations[index] ?? 0,
            totalPrice: roundMoney4(
              (grossAllocations[index] ?? 0) - (discountAllocations[index] ?? 0),
            ),
          }));
        });

        for (const line of saleLines) {
          const stockUpdate = await tx.stockLot.updateMany({
            where: {
              id: line.allocation.lotId,
              remainingQuantity: { gte: stockDecimal(line.allocation.quantityBase) },
            },
            data: { remainingQuantity: { decrement: stockDecimal(line.allocation.quantityBase) } },
          });
          if (stockUpdate.count !== 1) {
            throw new Error("موجودی هم‌زمان تغییر کرده است؛ دوباره کوشش کنید.");
          }
          await tx.stockMovement.create({
            data: {
              productId: line.item.productId,
              warehouseId: line.item.warehouseId,
              lotId: line.allocation.lotId,
              operationId: saleOperation.id,
              type: StockMovementType.SALE,
              quantity: line.allocation.quantityBase,
              unitCost: line.allocation.unitCostBase,
              currencyId: line.allocation.currencyId,
              exchangeRate: line.allocation.costExchangeRate,
              baseUnitCost: line.allocation.baseUnitCost,
              occurredAt,
              referenceType: "SALE",
              referenceId: replacementSale.id,
              note: input.data.replacement.note ?? input.data.note ?? null,
              createdByUserId: input.actor.id ?? null,
            },
          });
          await tx.saleItem.create({
            data: {
              saleId: replacementSale.id,
              productId: line.item.productId,
              warehouseId: line.item.warehouseId,
              unitId: line.item.unitId,
              lotId: line.allocation.lotId,
              quantity: line.allocation.quantity,
              conversionRate: line.item.conversionRate,
              quantityBase: line.allocation.quantityBase,
              unitPrice: line.item.unitPrice,
              discount: line.discount,
              totalPrice: line.totalPrice,
              documentDiscountAllocated: 0,
              netTotalPrice: line.totalPrice,
              unitCostBase: line.allocation.unitCostBase,
              totalCost: line.allocation.totalCost,
              baseTotalCost: line.allocation.baseTotalCost,
              expiryDate: line.allocation.expiryDate,
            },
          });
        }

        for (const payment of paymentLines) {
          if (payment.kind === "CASH") {
            const updated = await tx.cashRegisterAccount.update({
              where: { id: payment.id },
              data: { balance: { increment: payment.amount } },
            });
            await tx.moneyTransaction.create({
              data: {
                currencyId: sourceSale.currencyId,
                cashRegisterAccountId: payment.id,
                type: MoneyTransactionType.SALE_PAYMENT,
                direction: MoneyDirection.IN,
                amount: payment.amount,
                balanceAfter: updated.balance,
                ...snapshotBaseFields(currencySnapshot, {
                  amount: payment.amount,
                  balanceAfter: Number(updated.balance),
                }),
                referenceType: "SALE",
                referenceId: replacementSale.id,
                note: "Sale exchange payment",
                createdByUserId: input.actor.id ?? null,
                posDeviceId: input.posDevice?.id ?? null,
              },
            });
          } else {
            const updated = await tx.bankAccount.update({
              where: { id: payment.id },
              data: { balance: { increment: payment.amount } },
            });
            await tx.moneyTransaction.create({
              data: {
                currencyId: sourceSale.currencyId,
                bankAccountId: payment.id,
                type: MoneyTransactionType.SALE_PAYMENT,
                direction: MoneyDirection.IN,
                amount: payment.amount,
                balanceAfter: updated.balance,
                ...snapshotBaseFields(currencySnapshot, {
                  amount: payment.amount,
                  balanceAfter: Number(updated.balance),
                }),
                referenceType: "SALE",
                referenceId: replacementSale.id,
                note: "Sale exchange payment",
                createdByUserId: input.actor.id ?? null,
                posDeviceId: input.posDevice?.id ?? null,
              },
            });
          }
        }

        if (replacementReceivableAmount > 0) {
          await tx.partyAccount.upsert({
            where: { partyId_currencyId: { partyId: customer.id, currencyId: sourceSale.currencyId } },
            create: {
              partyId: customer.id,
              currencyId: sourceSale.currencyId,
              debitBalance: replacementReceivableAmount,
              creditBalance: 0,
            },
            update: { debitBalance: { increment: replacementReceivableAmount } },
          });
        }

        if (creditApplied > 0) {
          await tx.partyTransaction.create({
            data: {
              partyId: customer.id,
              currencyId: sourceSale.currencyId,
              type: PartyTransactionType.ADJUSTMENT,
              side: PartyAccountSide.DEBIT,
              amount: creditApplied,
              referenceType: "SALE_EXCHANGE",
              referenceId: exchange.id,
              note: "Sale exchange credit applied",
            },
          });
        }

        if (remainingAmount > 0) {
          await tx.partyTransaction.create({
            data: {
              partyId: customer.id,
              currencyId: sourceSale.currencyId,
              type: PartyTransactionType.SALE_CREDIT,
              side: PartyAccountSide.DEBIT,
              amount: remainingAmount,
              referenceType: "SALE",
              referenceId: replacementSale.id,
              note: "Sale exchange receivable",
            },
          });
        }

        await createPostedJournal(tx, {
          entryNoPrefix: "JE-POS",
          sourceType: "POS_SALE",
          sourceId: replacementSale.id,
          description: `Sale exchange ${replacementSale.invoiceNo || replacementSale.id}`,
          createdByUserId: input.actor.id ?? null,
          lines: [
            ...paymentLines.map((line) => ({
              accountCode: treasuryAccountCode(line.kind),
              partyId: customer.id,
              debit: line.amount,
              exchangeRate: currencySnapshot.exchangeRate,
              baseCurrencyId: currencySnapshot.baseCurrencyId,
              note: "Sale exchange payment",
            })),
            ...(creditApplied > 0
              ? [{
                  accountCode: "1200",
                  partyId: customer.id,
                  debit: creditApplied,
                  exchangeRate: currencySnapshot.exchangeRate,
                  baseCurrencyId: currencySnapshot.baseCurrencyId,
                  note: "Sale exchange credit applied",
                }]
              : []),
            ...(remainingAmount > 0
              ? [{
                  accountCode: "1200",
                  partyId: customer.id,
                  debit: remainingAmount,
                  exchangeRate: currencySnapshot.exchangeRate,
                  baseCurrencyId: currencySnapshot.baseCurrencyId,
                  note: "Sale exchange receivable",
                }]
              : []),
            {
              accountCode: "4000",
              partyId: customer.id,
              credit: replacementSubtotal,
              exchangeRate: currencySnapshot.exchangeRate,
              baseCurrencyId: currencySnapshot.baseCurrencyId,
              note: "Sale exchange revenue",
            },
          ],
        });

        const cogs = await ensureSaleCogsJournal(tx, {
          saleId: replacementSale.id,
          invoiceNo: replacementSale.invoiceNo,
          createdByUserId: input.actor.id ?? null,
        });

        return {
          exchange,
          saleReturn,
          replacementSale,
          cogs,
          idempotentReplay: false,
        };
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  } catch (error) {
    if (error instanceof SaleExchangeReplayError || isUniqueConstraintError(error)) {
      const replay = await replayExchange(input.data.clientRequestId);
      if (replay) return replay;
    }
    throw error;
  }
}
