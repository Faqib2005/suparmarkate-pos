import { describe, expect, it, vi } from "vitest";
import {
  BackupRestoreError,
  executeBackupRestore,
  type RestoreActor
} from "./backup-restore";
import type { IntegrityAuditReport } from "./integrity-audit";
import type { NativeBackupValidation } from "./postgres-backup";

const actor: RestoreActor = {
  id: "admin-1",
  username: "admin",
  displayName: "Admin"
};

function validation(sha256: string): NativeBackupValidation {
  return {
    valid: true,
    legacy: false,
    restoreMode: "full",
    metadata: {
      version: 4,
      format: "postgres-custom",
      app: "Muhaseb",
      createdAt: "2026-07-29T00:00:00.000Z",
      uploadsIncluded: true,
      tableCounts: {}
    },
    database: {
      sizeBytes: 10,
      sha256,
      checksumMatches: true,
      archiveEntries: 2
    },
    uploads: {
      present: true,
      valid: true,
      legacy: false,
      files: 1,
      totalBytes: 10,
      manifestSha256: "manifest",
      errors: []
    },
    errors: [],
    warnings: []
  };
}

function audit(status: "pass" | "blocked" = "pass"): IntegrityAuditReport {
  return {
    formatVersion: 1,
    label: "test",
    generatedAt: "2026-07-29T00:00:00.000Z",
    database: {
      name: "test",
      serverVersion: "16",
      latestMigration: null,
      latestMigrationFinishedAt: null
    },
    metrics: {
      unbalancedJournals: status === "blocked" ? 1 : 0,
      salesMissingCogs: 0,
      negativeStockBalances: 0,
      negativeStockLots: 0,
      stockBalanceMismatches: 0,
      salesMissingBaseSnapshot: 0,
      moneyTransactionsMissingBaseSnapshot: 0,
      journalLinesMissingBaseSnapshot: 0,
      activeBaseCurrencies: 1,
      activeAfnBaseCurrencies: 1,
      duplicateJournalSources: 0,
      duplicateNormalizedBarcodeGroups: 0,
      barcodesMissingNormalizedValue: 0,
      stockLotsAboveInitial: 0,
      stockMovementLedgerMismatches: 0,
      inactiveStockLocations: 0,
      incompleteStockMovementSnapshots: 0,
      stockMovementsMissingOperation: 0,
      stockMovementsMissingOccurredAt: 0,
      partialInventoryOperations: 0,
      attendanceLocalDateCollisions: 0,
      attendanceLocalDateMismatches: 0
    },
    issues:
      status === "blocked"
        ? [
            {
              code: "UNBALANCED_JOURNALS",
              severity: "blocker",
              count: 1,
              description: "test"
            }
          ]
        : [],
    summary: { status, blockers: status === "blocked" ? 1 : 0, warnings: 0 },
    businessSnapshot: {
      counts: {
        products: 0,
        stockLots: 0,
        stockMovements: 0,
        sales: 0,
        saleReturns: 0,
        purchases: 0,
        purchaseReturns: 0,
        journalEntries: 0
      },
      totals: {
        stockQuantityBase: "0",
        stockValueBase: "0",
        journalBaseDebit: "0",
        journalBaseCredit: "0",
        completedSaleBaseTotal: "0",
        completedPurchaseBaseTotal: "0"
      },
      fingerprint: "test"
    }
  };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  const events: string[] = [];
  const targetValidation = validation("target-sha");
  const safetyValidation = validation("safety-sha");
  const deps = {
    validateBackup: vi.fn(async (filePath: string) => {
      events.push(filePath.includes("safety.dump") ? "validate-safety" : "validate-target");
      return filePath.includes("safety.dump") ? safetyValidation : targetValidation;
    }),
    createSafetyBackup: vi.fn(async () => {
      events.push("safety-backup");
      return {
        filename: "safety.dump",
        filePath: "C:\\backup\\safety.dump",
        metadata: safetyValidation.metadata,
        validation: safetyValidation
      };
    }),
    restoreBackup: vi.fn(async (filePath: string) => {
      events.push(filePath.includes("safety.dump") ? "restore-safety" : "restore-target");
    }),
    applySchemaAndSeed: vi.fn(async () => {
      events.push("migrate-seed");
    }),
    repairInventory: vi.fn(async () => {
      events.push("repair-inventory");
      return {
        negativeLotsRepaired: 1,
        negativeQuantityCorrected: 8,
        smallLedgerMismatchesRepaired: 1,
        ledgerQuantityCorrected: 0.0002,
        sampleOperationIds: ["repair-operation"]
      };
    }),
    disconnectDatabase: vi.fn(async () => {
      events.push("disconnect");
    }),
    clearCaches: vi.fn(async () => {
      events.push("clear-cache");
    }),
    revokeSessions: vi.fn(async () => {
      events.push("revoke-sessions");
      return 2;
    }),
    integrityAudit: vi.fn(async () => {
      events.push("integrity");
      return audit();
    }),
    recordAudit: vi.fn(async (input: { rollback: string }) => {
      events.push(`audit-${input.rollback}`);
    }),
    setMaintenance: vi.fn((reason: string | null) => {
      events.push(reason ? "maintenance-on" : "maintenance-off");
    }),
    waitForBackgroundIdle: vi.fn(async () => {
      events.push("background-idle");
    }),
    ...overrides
  };
  return { deps: deps as any, events };
}

describe("backup restore orchestration", () => {
  it("runs safety backup, restore, migrations, audit and session revocation in order", async () => {
    const { deps, events } = dependencies();
    const result = await executeBackupRestore(
      { filename: "muhaseb-backup-2026-07-29T00-00-00-000Z.dump", actor },
      deps
    );

    expect(result).toMatchObject({
      safetyBackup: "safety.dump",
      restoreMode: "full",
      sessionsRevoked: 2
    });
    expect(events).toEqual([
      "validate-target",
      "maintenance-on",
      "background-idle",
      "safety-backup",
      "validate-target",
      "disconnect",
      "restore-target",
      "migrate-seed",
      "repair-inventory",
      "clear-cache",
      "revoke-sessions",
      "integrity",
      "audit-not-required",
      "maintenance-off"
    ]);
    expect(result.inventoryRepair).toMatchObject({
      negativeLotsRepaired: 1,
      smallLedgerMismatchesRepaired: 1
    });
  });

  it("does not create a safety backup or enter maintenance for invalid input", async () => {
    const invalid = { ...validation("target"), valid: false, errors: ["bad checksum"] };
    const { deps, events } = dependencies({
      validateBackup: vi.fn(async () => invalid)
    });

    await expect(
      executeBackupRestore(
        { filename: "muhaseb-backup-2026-07-29T00-00-00-000Z.dump", actor },
        deps
      )
    ).rejects.toMatchObject({
      rollback: "not-required",
      safetyBackup: null
    });
    expect(events).toEqual([]);
    expect(deps.createSafetyBackup).not.toHaveBeenCalled();
  });

  it("automatically restores the safety backup after a target integrity failure", async () => {
    let auditCount = 0;
    const { deps, events } = dependencies({
      integrityAudit: vi.fn(async () => {
        auditCount += 1;
        events.push("integrity");
        return auditCount === 1 ? audit("blocked") : audit("pass");
      })
    });

    await expect(
      executeBackupRestore(
        { filename: "muhaseb-backup-2026-07-29T00-00-00-000Z.dump", actor },
        deps
      )
    ).rejects.toMatchObject({
      rollback: "completed",
      safetyBackup: "safety.dump"
    });
    expect(events).toContain("restore-safety");
    expect(deps.repairInventory).toHaveBeenCalledTimes(1);
    expect(events.at(-2)).toBe("audit-completed");
    expect(events.at(-1)).toBe("maintenance-off");
  });

  it("returns a critical error when both restore and rollback fail", async () => {
    let restoreCount = 0;
    const { deps } = dependencies({
      restoreBackup: vi.fn(async () => {
        restoreCount += 1;
        throw new Error(restoreCount === 1 ? "target failed" : "safety failed");
      })
    });

    try {
      await executeBackupRestore(
        { filename: "muhaseb-backup-2026-07-29T00-00-00-000Z.dump", actor },
        deps
      );
      throw new Error("Expected restore to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BackupRestoreError);
      expect(error).toMatchObject({
        rollback: "failed",
        safetyBackup: "safety.dump",
        rollbackError: "safety failed"
      });
    }
  });
});
