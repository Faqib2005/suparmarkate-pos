import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executeBackupRestore } from "./backup-restore";
import { getUploadDir } from "./backup-assets";
import {
  createNativeBackup,
  getBackupDir,
  validateNativeBackup
} from "./postgres-backup";
import { prisma } from "./prisma";

const runBackupIntegration = process.env.RUN_BACKUP_INTEGRATION === "true";

describe.skipIf(!runBackupIntegration)("PostgreSQL backup restore integration", () => {
  const beforeAction = `BACKUP_TEST_BEFORE_${Date.now()}`;
  const afterAction = `BACKUP_TEST_AFTER_${Date.now()}`;
  const newerSchemaProbe = `RestoreNewerSchemaProbe_${Date.now()}`;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL || "";
    if (!databaseUrl.includes("supermarket_test")) {
      throw new Error("Backup integration tests may only run against the supermarket_test database");
    }
    if (!getBackupDir().toLocaleLowerCase("en").includes("backup-integration")) {
      throw new Error("BACKUP_DIR must point to a disposable backup-integration directory");
    }
    if (!getUploadDir().toLocaleLowerCase("en").includes("upload-integration")) {
      throw new Error("UPLOAD_DIR must point to a disposable upload-integration directory");
    }

    await Promise.all([
      rm(getBackupDir(), { recursive: true, force: true }),
      rm(getUploadDir(), { recursive: true, force: true })
    ]);
    await mkdir(getUploadDir(), { recursive: true });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await Promise.all([
      rm(getBackupDir(), { recursive: true, force: true }),
      rm(getUploadDir(), { recursive: true, force: true })
    ]);
  });

  it("restores database and uploads, deploys migrations, and records an independent audit", async () => {
    await prisma.auditLog.create({
      data: { action: beforeAction, description: "must survive target restore" }
    });
    await writeFile(path.join(getUploadDir(), "receipt.txt"), "before-backup", "utf8");

    const target = await createNativeBackup({ includeUploads: true });
    await new Promise((resolve) => setTimeout(resolve, 5));

    await prisma.auditLog.create({
      data: { action: afterAction, description: "must disappear after target restore" }
    });
    await prisma.$executeRawUnsafe(`CREATE TABLE "${newerSchemaProbe}" ("id" TEXT PRIMARY KEY)`);
    await writeFile(path.join(getUploadDir(), "receipt.txt"), "after-backup", "utf8");

    const validation = await validateNativeBackup(target.filePath);
    expect(validation.valid).toBe(true);

    const result = await executeBackupRestore({
      filename: target.filename,
      initialValidation: validation,
      actor: {
        id: "integration-admin",
        username: "integration-admin",
        displayName: "Integration Admin"
      }
    });

    expect(result.integrity.status).toBe("pass");
    expect(result.restoreMode).toBe("full");
    expect(await readFile(path.join(getUploadDir(), "receipt.txt"), "utf8")).toBe(
      "before-backup"
    );
    expect(await prisma.auditLog.count({ where: { action: beforeAction } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: afterAction } })).toBe(0);
    const newerTable = await prisma.$queryRawUnsafe<Array<{ table_name: string | null }>>(
      `SELECT to_regclass('public."${newerSchemaProbe}"')::TEXT AS table_name`
    );
    expect(newerTable[0]?.table_name).toBeNull();
    expect(
      await prisma.auditLog.count({
        where: {
          action: "backup.restore.completed",
          entityId: target.filename
        }
      })
    ).toBe(1);
    await expect(access(target.filePath)).resolves.toBeUndefined();
  }, 180_000);
});
