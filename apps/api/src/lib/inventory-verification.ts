import { StockMovementType } from "../generated/prisma/enums";
import { roundStockQuantity } from "./stock-quantity";

export type VerificationCount = {
  counterUserId: string;
  checkpointType: string;
  checkpointKey: string;
  cutoffAt: Date;
  quantityBase: unknown;
};

export function signedStockMovement(type: StockMovementType, quantity: number) {
  const inbound =
    type === StockMovementType.OPENING_STOCK ||
    type === StockMovementType.PURCHASE ||
    type === StockMovementType.SALE_RETURN ||
    type === StockMovementType.ADJUSTMENT_IN ||
    type === StockMovementType.TRANSFER_IN;
  return roundStockQuantity(inbound ? quantity : -quantity);
}

export function confirmIndependentCounts(
  counts: VerificationCount[],
  checkpointType: "OPENING" | "CLOSING",
  precisionBase: number,
) {
  const selected = counts.filter((entry) => entry.checkpointType === checkpointType);
  if (selected.length < 2) {
    throw new Error(`حداقل دو شمارش مستقل برای ${checkpointType} لازم است.`);
  }
  const checkpointKeys = new Set(selected.map((entry) => entry.checkpointKey));
  const counters = new Set(selected.map((entry) => entry.counterUserId));
  const cutoffs = new Set(selected.map((entry) => entry.cutoffAt.getTime()));
  if (checkpointKeys.size !== 1 || cutoffs.size !== 1) {
    throw new Error(`شمارش‌های ${checkpointType} باید checkpoint و cutoff یکسان داشته باشند.`);
  }
  if (counters.size < 2) {
    throw new Error(`دو کاربر متفاوت باید شمارش ${checkpointType} را ثبت کنند.`);
  }

  const values = selected.map((entry) => Number(entry.quantityBase));
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (maximum - minimum > precisionBase + 0.0000001) {
    throw new Error(
      `شمارش‌های ${checkpointType} به اندازه ${roundStockQuantity(maximum - minimum)} اختلاف دارند.`,
    );
  }
  return {
    quantity: roundStockQuantity(values.reduce((sum, value) => sum + value, 0) / values.length),
    cutoffAt: selected[0]!.cutoffAt,
    checkpointKey: selected[0]!.checkpointKey,
    counterUserIds: [...counters],
  };
}

export function classifyInventoryEvidence(input: {
  expectedClosing: number;
  systemClosing: number;
  physicalClosing: number;
  precisionBase: number;
}) {
  const systemVariance = roundStockQuantity(input.systemClosing - input.expectedClosing);
  const physicalVariance = roundStockQuantity(input.physicalClosing - input.systemClosing);
  if (Math.abs(systemVariance) > input.precisionBase) {
    return { classification: "SYSTEM_LEDGER_MISMATCH", discrepancy: systemVariance };
  }
  if (Math.abs(physicalVariance) > input.precisionBase) {
    return { classification: "PHYSICAL_VARIANCE", discrepancy: physicalVariance };
  }
  return { classification: "MATCHED", discrepancy: 0 };
}
