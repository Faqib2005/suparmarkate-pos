import { describe, expect, it } from "vitest";
import { StockMovementType } from "../generated/prisma/enums";
import {
  classifyInventoryEvidence,
  confirmIndependentCounts,
  signedStockMovement,
} from "./inventory-verification";

const cutoff = new Date("2026-08-23T04:30:00.000Z");

describe("inventory verification evidence", () => {
  it("requires two independent counters at one cutoff", () => {
    const result = confirmIndependentCounts(
      [
        { counterUserId: "u1", checkpointType: "OPENING", checkpointKey: "open", cutoffAt: cutoff, quantityBase: 50 },
        { counterUserId: "u2", checkpointType: "OPENING", checkpointKey: "open", cutoffAt: cutoff, quantityBase: 50.0001 },
      ],
      "OPENING",
      0.001,
    );
    expect(result.quantity).toBe(50.0001);
    expect(result.counterUserIds).toEqual(["u1", "u2"]);
  });

  it("rejects counts outside the registered precision", () => {
    expect(() =>
      confirmIndependentCounts(
        [
          { counterUserId: "u1", checkpointType: "CLOSING", checkpointKey: "close", cutoffAt: cutoff, quantityBase: 40 },
          { counterUserId: "u2", checkpointType: "CLOSING", checkpointKey: "close", cutoffAt: cutoff, quantityBase: 41 },
        ],
        "CLOSING",
        0.0001,
      ),
    ).toThrow(/اختلاف/);
  });

  it("distinguishes system ledger mismatch from physical variance", () => {
    expect(
      classifyInventoryEvidence({ expectedClosing: 45, systemClosing: 44, physicalClosing: 44, precisionBase: 0.0001 }),
    ).toEqual({ classification: "SYSTEM_LEDGER_MISMATCH", discrepancy: -1 });
    expect(
      classifyInventoryEvidence({ expectedClosing: 45, systemClosing: 45, physicalClosing: 44, precisionBase: 0.0001 }),
    ).toEqual({ classification: "PHYSICAL_VARIANCE", discrepancy: -1 });
    expect(
      classifyInventoryEvidence({ expectedClosing: 45, systemClosing: 45, physicalClosing: 45, precisionBase: 0.0001 }),
    ).toEqual({ classification: "MATCHED", discrepancy: 0 });
  });

  it("signs every stock movement direction correctly", () => {
    expect(signedStockMovement(StockMovementType.PURCHASE, 5)).toBe(5);
    expect(signedStockMovement(StockMovementType.SALE, 2)).toBe(-2);
    expect(signedStockMovement(StockMovementType.SALE_RETURN, 1)).toBe(1);
    expect(signedStockMovement(StockMovementType.PURCHASE_RETURN, 1)).toBe(-1);
    expect(signedStockMovement(StockMovementType.TRANSFER_IN, 3)).toBe(3);
    expect(signedStockMovement(StockMovementType.TRANSFER_OUT, 3)).toBe(-3);
    expect(signedStockMovement(StockMovementType.DAMAGE, 1)).toBe(-1);
  });
});
