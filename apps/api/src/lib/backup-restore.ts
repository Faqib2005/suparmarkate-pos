import path from "node:path";
import type { AuthUser } from "./auth";
import { cacheDeleteByPattern } from "./cache";
import { runIntegrityAudit, type IntegrityAuditReport } from "./integrity-audit";
import { setMaintenanceMode } from "./maintenance-mode";
import { waitForPersistentJobWorkerIdle } from "./persistent-jobs";
import {
  repairRestoredInventory,
  type PostRestoreInventoryRepairSummary
} from "./post-restore-inventory-repair";
import {
  applyPostRestoreSchemaAndSeed,
  createNativeBackup,
  getBackupDir,
  restoreNativeBackup,
  type NativeBackupValidation,
  validateNativeBackup
} from "./postgres-backup";
import { prisma } from "./prisma";

export type RestoreActor = Pick<AuthUser, "id" | "username" | "displayName"> & {
  ipAddress?: string | null;
  userAgent?: string | null;
};

type SafetyBackup = Awaited<ReturnType<typeof createNativeBackup>>;

export type BackupRestoreResult = {
  filename: string;
  safetyBackup: string;
  restoreMode: NativeBackupValidation["restoreMode"];
  integrity: IntegrityAuditReport["summary"];
  sessionsRevoked: number;
  inventoryRepair: PostRestoreInventoryRepairSummary;
};

export class BackupRestoreError extends Error {
  readonly safetyBackup: string | null;
  readonly rollback: "not-required" | "completed" | "failed";
  readonly causeMessage: string;
  readonly rollbackError: string | null;

  constructor(input: {
    message: string;
    safetyBackup: string | null;
    rollback: BackupRestoreError["rollback"];
    causeMessage: string;
    rollbackError?: string | null;
  }) {
    super(input.message);
    this.name = "BackupRestoreError";
    this.safetyBackup = input.safetyBackup;
    this.rollback = input.rollback;
    this.causeMessage = input.causeMessage;
    this.rollbackError = input.rollbackError ?? null;
  }
}

type RestoreDependencies = {
  validateBackup: (filePath: string) => Promise<NativeBackupValidation>;
  createSafetyBackup: () => Promise<SafetyBackup>;
  restoreBackup: (
    filePath: string,
    validation: NativeBackupValidation
  ) => Promise<unknown>;
  applySchemaAndSeed: () => Promise<void>;
  repairInventory: (restoreKey: string) => Promise<PostRestoreInventoryRepairSummary>;
  disconnectDatabase: () => Promise<void>;
  clearCaches: () => Promise<void>;
  revokeSessions: () => Promise<number>;
  integrityAudit: (label: string) => Promise<IntegrityAuditReport>;
  recordAudit: (input: {
    action: string;
    filename: string;
    safetyBackup: string | null;
    actor: RestoreActor;
    rollback: string;
    details?: Record<string, unknown>;
  }) => Promise<void>;
  setMaintenance: (reason: string | null) => void;
  waitForBackgroundIdle: () => Promise<void>;
};

let restoreInProgress = false;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function clearRestoreCaches() {
  await Promise.all([
    cacheDeleteByPattern("dashboard:*"),
    cacheDeleteByPattern("reports:*"),
    cacheDeleteByPattern("alerts:*"),
    cacheDeleteByPattern("pos:*")
  ]);
}

async function revokeAllSessions() {
  const result = await prisma.userSession.updateMany({
    where: { revokedAt: null },
    data: { revokedAt: new Date() }
  });
  return result.count;
}

async function recordRestoreAudit(input: Parameters<RestoreDependencies["recordAudit"]>[0]) {
  await prisma.auditLog.create({
    data: {
      userId: null,
      action: input.action,
      entityType: "Backup",
      entityId: input.filename,
      description:
        input.action === "backup.restore.completed"
          ? "PostgreSQL backup restored and verified"
          : "PostgreSQL backup restore failed",
      ipAddress: input.actor.ipAddress ?? null,
      userAgent: input.actor.userAgent ?? null,
      metadata: {
        filename: input.filename,
        safetyBackup: input.safetyBackup,
        rollback: input.rollback,
        requestedBy: {
          id: input.actor.id,
          username: input.actor.username,
          displayName: input.actor.displayName
        },
        ...(input.details ?? {})
      }
    }
  });
}

const defaultDependencies: RestoreDependencies = {
  validateBackup: validateNativeBackup,
  createSafetyBackup: () => createNativeBackup({ includeUploads: true }),
  restoreBackup: (filePath, validation) =>
    restoreNativeBackup(filePath, { validation }),
  applySchemaAndSeed: applyPostRestoreSchemaAndSeed,
  repairInventory: repairRestoredInventory,
  disconnectDatabase: () => prisma.$disconnect(),
  clearCaches: clearRestoreCaches,
  revokeSessions: revokeAllSessions,
  integrityAudit: (label) => runIntegrityAudit(prisma, { label }),
  recordAudit: recordRestoreAudit,
  setMaintenance: setMaintenanceMode,
  waitForBackgroundIdle: waitForPersistentJobWorkerIdle
};

async function applyRestoredState(input: {
  filePath: string;
  validation: NativeBackupValidation;
  label: string;
  repairInventory: boolean;
  restoreKey: string;
  dependencies: RestoreDependencies;
}) {
  const dependencies = input.dependencies;
  await dependencies.disconnectDatabase();
  await dependencies.restoreBackup(input.filePath, input.validation);
  await dependencies.applySchemaAndSeed();
  const inventoryRepair = input.repairInventory
    ? await dependencies.repairInventory(input.restoreKey)
    : {
        negativeLotsRepaired: 0,
        negativeQuantityCorrected: 0,
        smallLedgerMismatchesRepaired: 0,
        ledgerQuantityCorrected: 0,
        sampleOperationIds: []
      };
  await dependencies.clearCaches();
  const sessionsRevoked = await dependencies.revokeSessions();
  const integrity = await dependencies.integrityAudit(input.label);
  if (integrity.summary.status !== "pass") {
    const issueCodes = integrity.issues
      .filter((issue) => issue.severity === "blocker")
      .map((issue) => issue.code)
      .join(", ");
    throw new Error(`Restored database failed integrity audit: ${issueCodes || "unknown blocker"}`);
  }
  return { sessionsRevoked, integrity, inventoryRepair };
}

export function isBackupRestoreInProgress() {
  return restoreInProgress;
}

export async function executeBackupRestore(
  input: {
    filename: string;
    actor: RestoreActor;
    initialValidation?: NativeBackupValidation;
  },
  dependencies: RestoreDependencies = defaultDependencies
): Promise<BackupRestoreResult> {
  if (restoreInProgress) {
    throw new BackupRestoreError({
      message: "Another backup restore is already in progress",
      safetyBackup: null,
      rollback: "not-required",
      causeMessage: "restore already in progress"
    });
  }

  restoreInProgress = true;
  let maintenanceEnabled = false;
  let safetyBackup: SafetyBackup | null = null;
  let targetMutationStarted = false;
  const filePath = path.join(getBackupDir(), input.filename);

  try {
    const initialValidation =
      input.initialValidation ?? (await dependencies.validateBackup(filePath));
    if (!initialValidation.valid) {
      throw new BackupRestoreError({
        message: `Backup validation failed: ${initialValidation.errors.join("; ")}`,
        safetyBackup: null,
        rollback: "not-required",
        causeMessage: initialValidation.errors.join("; ")
      });
    }

    dependencies.setMaintenance(`restoring ${input.filename}`);
    maintenanceEnabled = true;
    await dependencies.waitForBackgroundIdle();
    safetyBackup = await dependencies.createSafetyBackup();

    const lockedValidation = await dependencies.validateBackup(filePath);
    if (!lockedValidation.valid) {
      throw new Error(`Backup validation failed: ${lockedValidation.errors.join("; ")}`);
    }
    if (lockedValidation.database.sha256 !== initialValidation.database.sha256) {
      throw new Error("Backup file changed after validation; restore was cancelled");
    }

    targetMutationStarted = true;
    const applied = await applyRestoredState({
      filePath,
      validation: lockedValidation,
      label: `restore:${input.filename}`,
      repairInventory: true,
      restoreKey: `${input.filename}:${lockedValidation.database.sha256}`,
      dependencies
    });

    await dependencies.recordAudit({
      action: "backup.restore.completed",
      filename: input.filename,
      safetyBackup: safetyBackup.filename,
      actor: input.actor,
      rollback: "not-required",
      details: {
        restoreMode: lockedValidation.restoreMode,
        integrity: applied.integrity.summary,
        sessionsRevoked: applied.sessionsRevoked,
        inventoryRepair: applied.inventoryRepair
      }
    });

    return {
      filename: input.filename,
      safetyBackup: safetyBackup.filename,
      restoreMode: lockedValidation.restoreMode,
      integrity: applied.integrity.summary,
      sessionsRevoked: applied.sessionsRevoked,
      inventoryRepair: applied.inventoryRepair
    };
  } catch (error) {
    if (error instanceof BackupRestoreError) throw error;

    const causeMessage = errorMessage(error);
    if (!safetyBackup || !targetMutationStarted) {
      throw new BackupRestoreError({
        message: `Backup restore failed before database replacement: ${causeMessage}`,
        safetyBackup: safetyBackup?.filename ?? null,
        rollback: "not-required",
        causeMessage
      });
    }

    try {
      const safetyValidation = await dependencies.validateBackup(safetyBackup.filePath);
      if (!safetyValidation.valid) {
        throw new Error(`Safety backup is invalid: ${safetyValidation.errors.join("; ")}`);
      }
      const rollbackApplied = await applyRestoredState({
        filePath: safetyBackup.filePath,
        validation: safetyValidation,
        label: `restore-rollback:${input.filename}`,
        repairInventory: false,
        restoreKey: `rollback:${safetyBackup.filename}`,
        dependencies
      });
      await dependencies.recordAudit({
        action: "backup.restore.failed",
        filename: input.filename,
        safetyBackup: safetyBackup.filename,
        actor: input.actor,
        rollback: "completed",
        details: {
          cause: causeMessage,
          rollbackIntegrity: rollbackApplied.integrity.summary,
          sessionsRevoked: rollbackApplied.sessionsRevoked
        }
      });
      throw new BackupRestoreError({
        message: `Backup restore failed, and the safety backup was restored: ${causeMessage}`,
        safetyBackup: safetyBackup.filename,
        rollback: "completed",
        causeMessage
      });
    } catch (rollbackError) {
      if (rollbackError instanceof BackupRestoreError) throw rollbackError;
      const rollbackMessage = errorMessage(rollbackError);
      throw new BackupRestoreError({
        message:
          `CRITICAL: backup restore and automatic rollback both failed. ` +
          `Restore ${safetyBackup.filename} manually. Cause: ${causeMessage}. ` +
          `Rollback error: ${rollbackMessage}`,
        safetyBackup: safetyBackup.filename,
        rollback: "failed",
        causeMessage,
        rollbackError: rollbackMessage
      });
    }
  } finally {
    if (maintenanceEnabled) dependencies.setMaintenance(null);
    restoreInProgress = false;
  }
}
