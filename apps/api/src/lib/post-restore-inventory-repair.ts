import { createHash } from "node:crypto";
import type { Prisma } from "../generated/prisma/client";
import { StockMovementType } from "../generated/prisma/enums";
import { InventoryMutationService } from "./inventory-mutation";
import { prisma } from "./prisma";
import { roundStockQuantity, stockDecimal } from "./stock-quantity";

const LEDGER_EPSILON = 0.0001;
const MAX_AUTOMATIC_LEDGER_CORRECTION = 0.1;

type LedgerMismatchRow = {
  lotId: string;
  productId: string;
  warehouseId: string;
  difference: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  currencyId: string | null;
  exchangeRate: Prisma.Decimal;
  baseUnitCost: Prisma.Decimal;
};

export type PostRestoreInventoryRepairSummary = {
  negativeLotsRepaired: number;
  negativeQuantityCorrected: number;
  smallLedgerMismatchesRepaired: number;
  ledgerQuantityCorrected: number;
  sampleOperationIds: string[];
};

function restoreRepairKey(restoreKey: string, repairType: string, lotId: string) {
  const digest = createHash("sha256")
    .update(`${restoreKey}:${repairType}:${lotId}`)
    .digest("hex");
  return `restore-stock-repair:${repairType}:${digest}`;
}

function positiveQuantity(value: number) {
  return roundStockQuantity(Math.abs(value));
}

export async function repairRestoredInventory(
  restoreKey: string
): Promise<PostRestoreInventoryRepairSummary> {
  const summary: PostRestoreInventoryRepairSummary = {
    negativeLotsRepaired: 0,
    negativeQuantityCorrected: 0,
    smallLedgerMismatchesRepaired: 0,
    ledgerQuantityCorrected: 0,
    sampleOperationIds: []
  };

  const negativeLots = await prisma.stockLot.findMany({
    where: { remainingQuantity: { lt: 0 } },
    select: { id: true }
  });

  for (const candidate of negativeLots) {
    const repaired = await prisma.$transaction(async (tx) => {
      const inventory = new InventoryMutationService(tx);
      const current = await tx.stockLot.findUnique({ where: { id: candidate.id } });
      if (!current || Number(current.remainingQuantity) >= 0) return null;

      await inventory.lock([{
        productId: current.productId,
        warehouseId: current.warehouseId
      }]);
      const locked = await tx.stockLot.findUnique({ where: { id: candidate.id } });
      if (!locked || Number(locked.remainingQuantity) >= 0) return null;

      const quantity = positiveQuantity(Number(locked.remainingQuantity));
      if (quantity <= 0) return null;
      const occurredAt = new Date();
      const operation = await inventory.startOperation({
        type: "RESTORE_NEGATIVE_STOCK_REPAIR",
        clientRequestId: restoreRepairKey(restoreKey, "negative", locked.id),
        occurredAt,
        sourceChannel: "BACKUP_RESTORE"
      });

      await tx.stockLot.update({
        where: { id: locked.id },
        data: { remainingQuantity: { increment: stockDecimal(quantity) } }
      });
      await tx.stockMovement.create({
        data: {
          productId: locked.productId,
          warehouseId: locked.warehouseId,
          lotId: locked.id,
          operationId: operation.id,
          type: StockMovementType.ADJUSTMENT_IN,
          quantity: stockDecimal(quantity),
          unitCost: locked.unitCost,
          currencyId: locked.currencyId,
          exchangeRate: locked.exchangeRate,
          baseUnitCost: locked.baseUnitCost,
          referenceType: "RESTORE_NEGATIVE_STOCK_REPAIR",
          referenceId: locked.id,
          note: "Automatic restore repair: negative lot adjusted to zero",
          occurredAt
        }
      });

      return { operationId: operation.id, quantity };
    }, { isolationLevel: "Serializable", timeout: 30_000 });

    if (!repaired) continue;
    summary.negativeLotsRepaired += 1;
    summary.negativeQuantityCorrected = roundStockQuantity(
      summary.negativeQuantityCorrected + repaired.quantity
    );
    if (summary.sampleOperationIds.length < 50) {
      summary.sampleOperationIds.push(repaired.operationId);
    }
  }

  const mismatches = await prisma.$queryRaw<LedgerMismatchRow[]>`
    WITH ledger AS (
      SELECT "lotId", SUM(CASE
        WHEN type IN ('OPENING_STOCK', 'PURCHASE', 'SALE_RETURN', 'ADJUSTMENT_IN', 'TRANSFER_IN')
          THEN quantity ELSE -quantity END
      ) AS quantity
      FROM "StockMovement"
      WHERE "lotId" IS NOT NULL
      GROUP BY "lotId"
    )
    SELECT
      lot.id AS "lotId",
      lot."productId",
      lot."warehouseId",
      lot."remainingQuantity" - COALESCE(ledger.quantity, 0) AS difference,
      lot."unitCost",
      lot."currencyId",
      lot."exchangeRate",
      lot."baseUnitCost"
    FROM "StockLot" lot
    LEFT JOIN ledger ON ledger."lotId" = lot.id
    WHERE ABS(lot."remainingQuantity" - COALESCE(ledger.quantity, 0)) > ${LEDGER_EPSILON}
      AND ABS(lot."remainingQuantity" - COALESCE(ledger.quantity, 0)) < ${MAX_AUTOMATIC_LEDGER_CORRECTION}
    ORDER BY lot.id
  `;

  for (const candidate of mismatches) {
    const repaired = await prisma.$transaction(async (tx) => {
      const inventory = new InventoryMutationService(tx);
      await inventory.lock([{
        productId: candidate.productId,
        warehouseId: candidate.warehouseId
      }]);

      const rows = await tx.$queryRaw<LedgerMismatchRow[]>`
        WITH ledger AS (
          SELECT "lotId", SUM(CASE
            WHEN type IN ('OPENING_STOCK', 'PURCHASE', 'SALE_RETURN', 'ADJUSTMENT_IN', 'TRANSFER_IN')
              THEN quantity ELSE -quantity END
          ) AS quantity
          FROM "StockMovement"
          WHERE "lotId" = ${candidate.lotId}
          GROUP BY "lotId"
        )
        SELECT
          lot.id AS "lotId",
          lot."productId",
          lot."warehouseId",
          lot."remainingQuantity" - COALESCE(ledger.quantity, 0) AS difference,
          lot."unitCost",
          lot."currencyId",
          lot."exchangeRate",
          lot."baseUnitCost"
        FROM "StockLot" lot
        LEFT JOIN ledger ON ledger."lotId" = lot.id
        WHERE lot.id = ${candidate.lotId}
      `;
      const current = rows[0];
      if (!current) return null;
      const difference = roundStockQuantity(Number(current.difference));
      const quantity = positiveQuantity(difference);
      if (
        quantity <= LEDGER_EPSILON ||
        quantity >= MAX_AUTOMATIC_LEDGER_CORRECTION
      ) return null;

      const occurredAt = new Date();
      const operation = await inventory.startOperation({
        type: "RESTORE_LEDGER_ROUNDING_REPAIR",
        clientRequestId: restoreRepairKey(restoreKey, "rounding", current.lotId),
        occurredAt,
        sourceChannel: "BACKUP_RESTORE"
      });
      await tx.stockMovement.create({
        data: {
          productId: current.productId,
          warehouseId: current.warehouseId,
          lotId: current.lotId,
          operationId: operation.id,
          type: difference > 0
            ? StockMovementType.ADJUSTMENT_IN
            : StockMovementType.ADJUSTMENT_OUT,
          quantity: stockDecimal(quantity),
          unitCost: current.unitCost,
          currencyId: current.currencyId,
          exchangeRate: current.exchangeRate,
          baseUnitCost: current.baseUnitCost,
          referenceType: "RESTORE_LEDGER_ROUNDING_REPAIR",
          referenceId: current.lotId,
          note: "Automatic restore repair: sub-0.1 ledger rounding difference",
          occurredAt
        }
      });

      return { operationId: operation.id, quantity };
    }, { isolationLevel: "Serializable", timeout: 30_000 });

    if (!repaired) continue;
    summary.smallLedgerMismatchesRepaired += 1;
    summary.ledgerQuantityCorrected = roundStockQuantity(
      summary.ledgerQuantityCorrected + repaired.quantity
    );
    if (summary.sampleOperationIds.length < 50) {
      summary.sampleOperationIds.push(repaired.operationId);
    }
  }

  if (summary.negativeLotsRepaired || summary.smallLedgerMismatchesRepaired) {
    await prisma.auditLog.create({
      data: {
        userId: null,
        action: "backup.restore.inventory_repaired",
        entityType: "BackupRestore",
        entityId: restoreKey,
        description: "Negative stock and small ledger differences were repaired during restore",
        metadata: summary
      }
    });
  }

  return summary;
}
