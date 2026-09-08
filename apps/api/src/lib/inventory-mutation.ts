import { randomUUID } from "node:crypto";
import type { Prisma } from "../generated/prisma/client";
import { StockMovementType } from "../generated/prisma/enums";
import { acquireTransactionLock } from "./db-lock";
import { stockDecimal } from "./stock-quantity";

export type InventoryTarget = {
  productId: string;
  warehouseId: string;
};

export type StartInventoryOperationInput = {
  type: string;
  clientRequestId?: string | null;
  occurredAt?: Date | null;
  createdByUserId?: string | null;
  sourceChannel?: string | null;
  sourceDeviceCode?: string | null;
  appVersion?: string | null;
  correlationId?: string | null;
  requestIp?: string | null;
};

function targetKey(target: InventoryTarget) {
  return `${target.productId}:${target.warehouseId}`;
}

export function normalizeInventoryTargets(targets: InventoryTarget[]) {
  const unique = new Map<string, InventoryTarget>();
  for (const target of targets) {
    if (!target.productId || !target.warehouseId) {
      throw new Error("Product and warehouse are required for an inventory mutation.");
    }
    unique.set(targetKey(target), target);
  }
  return [...unique.values()].sort((left, right) =>
    targetKey(left).localeCompare(targetKey(right)),
  );
}

export function normalizeClientRequestId(value: string | null | undefined) {
  const normalized = value?.trim() || null;
  if (!normalized) return null;
  if (normalized.length < 8 || normalized.length > 200) {
    throw new Error("Idempotency-Key must contain between 8 and 200 characters.");
  }
  return normalized;
}

export class InventoryMutationService {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async lock(targets: InventoryTarget[]) {
    const normalized = normalizeInventoryTargets(targets);
    for (const target of normalized) {
      await acquireTransactionLock(this.tx, "stock", targetKey(target));
    }
    return normalized;
  }

  async assertWritable(targets: InventoryTarget[]) {
    const normalized = normalizeInventoryTargets(targets);
    // Interactive transactions use one PostgreSQL connection. Keep these
    // queries sequential so the pg adapter never executes two queries on the
    // same busy client.
    const products = await this.tx.product.findMany({
      where: {
        id: { in: [...new Set(normalized.map((item) => item.productId))] },
      },
      select: { id: true, isActive: true, deletedAt: true, hasExpiry: true },
    });
    const warehouses = await this.tx.warehouse.findMany({
      where: {
        id: { in: [...new Set(normalized.map((item) => item.warehouseId))] },
      },
      select: { id: true, isActive: true, deletedAt: true },
    });

    const productMap = new Map(products.map((item) => [item.id, item]));
    const warehouseMap = new Map(warehouses.map((item) => [item.id, item]));
    for (const target of normalized) {
      const product = productMap.get(target.productId);
      if (!product || !product.isActive || product.deletedAt) {
        throw new Error("محصول حذف یا غیرفعال است و حرکت جدید موجودی برای آن مجاز نیست.");
      }
      const warehouse = warehouseMap.get(target.warehouseId);
      if (!warehouse || !warehouse.isActive || warehouse.deletedAt) {
        throw new Error("گدام حذف یا غیرفعال است و حرکت جدید موجودی برای آن مجاز نیست.");
      }
    }
    return { normalized, productMap, warehouseMap };
  }

  async prepare(targets: InventoryTarget[]) {
    const normalized = await this.lock(targets);
    await this.assertWritable(normalized);
    return normalized;
  }

  async startOperation(input: StartInventoryOperationInput) {
    const clientRequestId = normalizeClientRequestId(input.clientRequestId);
    // Let the database unique constraint arbitrate concurrent retries. A
    // read-before-create race can make both requests appear new and turns an
    // otherwise replayable request into an internal error.
    return this.tx.inventoryOperation.create({
      data: {
        clientRequestId,
        type: input.type,
        occurredAt: input.occurredAt ?? new Date(),
        createdByUserId: input.createdByUserId ?? null,
        sourceChannel: input.sourceChannel ?? null,
        sourceDeviceCode: input.sourceDeviceCode ?? null,
        appVersion: input.appVersion ?? null,
        correlationId: input.correlationId ?? null,
        requestIp: input.requestIp ?? null,
      },
    });
  }

  async cancelOperation(input: {
    operationId: string;
    reason?: string | null;
    cancelledByUserId?: string | null;
    occurredAt?: Date;
  }) {
    await acquireTransactionLock(this.tx, "inventory-operation-cancel", input.operationId);
    const operation = await this.tx.inventoryOperation.findUnique({
      where: { id: input.operationId },
      include: {
        movements: {
          include: { lot: true },
          orderBy: { createdAt: "asc" }
        }
      }
    });
    if (!operation) {
      throw new Error("عملیات موجودی پیدا نشد.");
    }
    if (operation.status === "CANCELLED" || operation.cancelledAt) {
      throw new Error("این عملیات موجودی قبلاً ابطال شده است.");
    }

    const originals = operation.movements.filter(
      (movement) => !movement.referenceType?.endsWith("_CANCEL")
    );
    if (!originals.length) {
      throw new Error("این عملیات حرکت قابل ابطال ندارد.");
    }
    const documentMovementTypes = new Set<StockMovementType>([
      StockMovementType.PURCHASE,
      StockMovementType.SALE,
      StockMovementType.SALE_RETURN,
      StockMovementType.PURCHASE_RETURN,
      StockMovementType.TRANSFER_IN,
      StockMovementType.TRANSFER_OUT
    ]);
    if (originals.some((movement) => documentMovementTypes.has(movement.type))) {
      throw new Error("این عملیات باید از سند خرید، فروش، برگشتی یا انتقال ابطال شود.");
    }

    await this.lock(
      originals.map((movement) => ({
        productId: movement.productId,
        warehouseId: movement.warehouseId
      }))
    );

    const occurredAt = input.occurredAt ?? new Date();
    const reversals = [];
    for (const movement of originals) {
      if (!movement.lotId || !movement.lot) {
        throw new Error("یکی از حرکت‌های عملیات لات معتبر ندارد.");
      }
      const quantity = Number(movement.quantity);
      const addedStock =
        movement.type === StockMovementType.OPENING_STOCK ||
        movement.type === StockMovementType.ADJUSTMENT_IN;

      if (addedStock) {
        const changed = await this.tx.stockLot.updateMany({
          where: {
            id: movement.lotId,
            remainingQuantity: { gte: stockDecimal(quantity) }
          },
          data: { remainingQuantity: { decrement: stockDecimal(quantity) } }
        });
        if (changed.count !== 1) {
          throw new Error("بخشی از موجودی این عملیات مصرف شده و ابطال کامل ممکن نیست.");
        }
      } else {
        await this.tx.stockLot.update({
          where: { id: movement.lotId },
          data: { remainingQuantity: { increment: stockDecimal(quantity) } }
        });
      }

      reversals.push(await this.tx.stockMovement.create({
        data: {
          productId: movement.productId,
          warehouseId: movement.warehouseId,
          lotId: movement.lotId,
          operationId: operation.id,
          occurredAt,
          type: addedStock ? StockMovementType.ADJUSTMENT_OUT : StockMovementType.ADJUSTMENT_IN,
          quantity,
          unitCost: movement.unitCost,
          currencyId: movement.currencyId,
          exchangeRate: movement.exchangeRate,
          baseUnitCost: movement.baseUnitCost,
          referenceType: `${movement.type}_CANCEL`,
          referenceId: movement.id,
          note: input.reason ?? "Inventory operation cancellation",
          createdByUserId: input.cancelledByUserId ?? null
        }
      }));
    }

    const changed = await this.tx.inventoryOperation.updateMany({
      where: { id: operation.id, status: "COMPLETED", cancelledAt: null },
      data: {
        status: "CANCELLED",
        cancelledAt: occurredAt,
        cancelReason: input.reason ?? null,
        cancelledByUserId: input.cancelledByUserId ?? null
      }
    });
    if (changed.count !== 1) {
      throw new Error("این عملیات هم‌زمان ابطال شده است.");
    }
    return { operationId: operation.id, movements: reversals };
  }
}

export function requestOperationId(
  headerValue: string | null | undefined,
  fallbackPrefix: string,
) {
  return normalizeClientRequestId(headerValue) ?? `${fallbackPrefix}-${randomUUID()}`;
}
