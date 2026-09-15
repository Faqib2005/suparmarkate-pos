import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  backupUploadedFiles,
  getBackupUploadDir,
  restoreUploadedFiles,
  validateUploadedFilesBackup
} from "./backup-assets";

describe("backup upload snapshots", () => {
  let root = "";
  let uploads = "";
  let backupFile = "";
  let previousUploadDir: string | undefined;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "muhaseb-backup-assets-"));
    uploads = path.join(root, "uploads");
    backupFile = path.join(root, "muhaseb-backup-2026-07-29T00-00-00-000Z.dump");
    previousUploadDir = process.env.UPLOAD_DIR;
    process.env.UPLOAD_DIR = uploads;
    await mkdir(path.join(uploads, "products"), { recursive: true });
    await writeFile(path.join(uploads, "products", "tea.jpg"), "original-image", "utf8");
  });

  afterEach(async () => {
    if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previousUploadDir;
    await rm(root, { recursive: true, force: true });
  });

  it("creates and validates a checksummed upload snapshot", async () => {
    const snapshot = await backupUploadedFiles(backupFile);
    const validation = await validateUploadedFilesBackup(backupFile, { required: true });

    expect(snapshot.files).toBe(1);
    expect(snapshot.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(validation).toMatchObject({
      present: true,
      valid: true,
      legacy: false,
      files: 1
    });
  });

  it("restores through staging and replaces uploads only after validation", async () => {
    await backupUploadedFiles(backupFile);
    await writeFile(path.join(uploads, "products", "tea.jpg"), "changed-image", "utf8");
    await writeFile(path.join(uploads, "keep-until-swap.txt"), "current", "utf8");
    const uploadDirectoryBefore = await stat(uploads);

    const result = await restoreUploadedFiles(backupFile, { required: true });
    const uploadDirectoryAfter = await stat(uploads);

    expect(result.restored).toBe(true);
    expect(uploadDirectoryAfter.ino).toBe(uploadDirectoryBefore.ino);
    expect(await readFile(path.join(uploads, "products", "tea.jpg"), "utf8")).toBe(
      "original-image"
    );
    await expect(readFile(path.join(uploads, "keep-until-swap.txt"), "utf8")).rejects.toThrow();
  });

  it("preserves current uploads when a legacy database-only backup has no snapshot", async () => {
    const result = await restoreUploadedFiles(backupFile);

    expect(result).toMatchObject({ restored: false, preserved: true });
    expect(await readFile(path.join(uploads, "products", "tea.jpg"), "utf8")).toBe(
      "original-image"
    );
  });

  it("rejects a missing required upload snapshot without touching current uploads", async () => {
    await expect(restoreUploadedFiles(backupFile, { required: true })).rejects.toThrow(
      "upload snapshot is missing"
    );
    expect(await readFile(path.join(uploads, "products", "tea.jpg"), "utf8")).toBe(
      "original-image"
    );
  });

  it("rejects corrupted files and leaves current uploads untouched", async () => {
    await backupUploadedFiles(backupFile);
    await writeFile(
      path.join(getBackupUploadDir(backupFile), "products", "tea.jpg"),
      "corrupted",
      "utf8"
    );
    await writeFile(path.join(uploads, "products", "tea.jpg"), "current-safe-image", "utf8");

    await expect(restoreUploadedFiles(backupFile, { required: true })).rejects.toThrow(
      "validation failed"
    );
    expect(await readFile(path.join(uploads, "products", "tea.jpg"), "utf8")).toBe(
      "current-safe-image"
    );
  });
});
