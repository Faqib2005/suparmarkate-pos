import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, statSync } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import {
  backupUploadedFiles,
  restoreUploadedFiles,
  type UploadSnapshotValidation,
  validateUploadedFilesBackup
} from "./backup-assets";
import { getRuntimeServerConfig } from "./runtime-server-config";

const CURRENT_BACKUP_VERSION = 4;

type UploadSnapshotMetadata = {
  files: number;
  linked: number;
  copied: number;
  totalBytes?: number;
  manifestSha256?: string | null;
};

export type NativeBackupMetadata = {
  version: number;
  format: "postgres-custom";
  app: "Muhaseb";
  appVersion?: string;
  schemaVersion?: string | null;
  createdAt: string;
  uploadsIncluded: boolean;
  databaseSizeBytes?: number;
  databaseSha256?: string;
  tableCounts: Record<string, number>;
  uploadSnapshot?: UploadSnapshotMetadata | null;
};

export type NativeBackupValidation = {
  valid: boolean;
  legacy: boolean;
  restoreMode: "full" | "database-only";
  metadata: NativeBackupMetadata;
  database: {
    sizeBytes: number;
    sha256: string;
    checksumMatches: boolean | null;
    archiveEntries: number;
  };
  uploads: UploadSnapshotValidation;
  errors: string[];
  warnings: string[];
};

type ValidationOptions = {
  inspectArchive?: (filePath: string) => Promise<string>;
};

export function getBackupDir() {
  return getRuntimeServerConfig().backupDir;
}

export function formatBackupName(date = new Date()) {
  return `muhaseb-backup-${date.toISOString().replace(/:/g, "-").replace(/\./g, "-")}.dump`;
}

export function assertSafeBackupFilename(filename: string) {
  if (!/^muhaseb-backup-\d{4}-\d{2}-\d{2}T[\d-]+Z\.dump$/.test(filename)) {
    throw new Error("Invalid backup filename");
  }
}

function databaseUrl() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is required for PostgreSQL backup");
  return value;
}

function execute(
  command: string,
  args: string[],
  options: {
    stdinFile?: string;
    stdoutFile?: string;
    captureStdout?: boolean;
    maxStdoutBytes?: number;
    cwd?: string;
  } = {}
) {
  return new Promise<string>((resolve, reject) => {
    const captureStdout = options.captureStdout === true;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      windowsHide: true,
      stdio: [
        options.stdinFile ? "pipe" : "ignore",
        options.stdoutFile || captureStdout ? "pipe" : "ignore",
        "pipe"
      ]
    });
    let stderr = "";
    let stdout = "";
    let stdoutOverflow = false;
    const maxStdoutBytes = options.maxStdoutBytes ?? 8 * 1024 * 1024;

    child.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-8000);
    });
    if (captureStdout) {
      child.stdout?.on("data", (chunk) => {
        if (stdoutOverflow) return;
        stdout += String(chunk);
        if (Buffer.byteLength(stdout, "utf8") > maxStdoutBytes) {
          stdoutOverflow = true;
          child.kill();
        }
      });
    }
    if (options.stdinFile) createReadStream(options.stdinFile).pipe(child.stdin!);
    if (options.stdoutFile) child.stdout!.pipe(createWriteStream(options.stdoutFile));
    child.on("error", (error) => reject(new Error(`${command} could not start: ${error.message}`)));
    child.on("close", (code) => {
      if (stdoutOverflow) {
        reject(new Error(`${command} output exceeded ${maxStdoutBytes} bytes`));
      } else if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`${command} failed with code ${code}: ${stderr.trim()}`));
      }
    });
  });
}

function dockerContainer() {
  return process.env.PG_DOCKER_CONTAINER || "muhaseb_postgres";
}

function dockerDatabaseUrl() {
  return process.env.PG_DOCKER_DATABASE_URL || databaseUrl();
}

async function executeSql(sql: string) {
  const args = ["--dbname", databaseUrl(), "--command", sql];

  try {
    await execute(process.env.PG_PSQL_PATH || "psql", args);
  } catch (error) {
    if (process.env.PG_DOCKER_FALLBACK === "false") throw error;
    await execute("docker", [
      "exec",
      dockerContainer(),
      "psql",
      "--dbname",
      dockerDatabaseUrl(),
      "--command",
      sql
    ]);
  }
}

async function executeSqlScalar(sql: string) {
  const args = ["--tuples-only", "--no-align", "--dbname", databaseUrl(), "--command", sql];

  try {
    return (
      await execute(process.env.PG_PSQL_PATH || "psql", args, { captureStdout: true })
    ).trim();
  } catch (error) {
    if (process.env.PG_DOCKER_FALLBACK === "false") throw error;
    return (
      await execute(
        "docker",
        [
          "exec",
          dockerContainer(),
          "psql",
          "--tuples-only",
          "--no-align",
          "--dbname",
          dockerDatabaseUrl(),
          "--command",
          sql
        ],
        { captureStdout: true }
      )
    ).trim();
  }
}

async function createDump(filePath: string) {
  const args = [
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    "--file",
    filePath,
    "--dbname",
    databaseUrl()
  ];

  try {
    await execute(process.env.PG_DUMP_PATH || "pg_dump", args);
  } catch (error) {
    if (process.env.PG_DOCKER_FALLBACK === "false") throw error;
    await execute(
      "docker",
      [
        "exec",
        dockerContainer(),
        "pg_dump",
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "--dbname",
        dockerDatabaseUrl()
      ],
      { stdoutFile: filePath }
    );
  }
}

async function inspectPostgresArchive(filePath: string) {
  try {
    return await execute(process.env.PG_RESTORE_PATH || "pg_restore", ["--list", filePath], {
      captureStdout: true
    });
  } catch (error) {
    if (process.env.PG_DOCKER_FALLBACK === "false") throw error;
    return execute(
      "docker",
      ["exec", "-i", dockerContainer(), "pg_restore", "--list"],
      { stdinFile: filePath, captureStdout: true }
    );
  }
}

async function restoreDump(filePath: string) {
  await executeSql(`
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid();
  `);

  // pg_restore --clean only removes objects that also exist in the archive.
  // A full restore must reset the application schema so newer destination
  // objects cannot survive an older backup and conflict with migrations.
  await executeSql(`
    DROP SCHEMA IF EXISTS public CASCADE;
    CREATE SCHEMA public AUTHORIZATION CURRENT_USER;
  `);

  const restoreArgs = [
    "--clean",
    "--if-exists",
    "--single-transaction",
    "--exit-on-error",
    "--no-owner",
    "--no-privileges",
    "--dbname",
    databaseUrl()
  ];

  try {
    await execute(process.env.PG_RESTORE_PATH || "pg_restore", [...restoreArgs, filePath]);
  } catch (error) {
    if (process.env.PG_DOCKER_FALLBACK === "false") throw error;
    const dockerRestoreArgs = restoreArgs.map((value, index) =>
      index > 0 && restoreArgs[index - 1] === "--dbname" ? dockerDatabaseUrl() : value
    );
    await execute(
      "docker",
      ["exec", "-i", dockerContainer(), "pg_restore", ...dockerRestoreArgs],
      { stdinFile: filePath }
    );
  }
}

export function backupMetadataPath(filePath: string) {
  return `${filePath}.meta.json`;
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function getAppVersion() {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  const packageLocations = [
    path.resolve(process.cwd(), "package.json"),
    path.resolve(process.cwd(), "apps/api/package.json")
  ];
  for (const packagePath of packageLocations) {
    const raw = await readFile(packagePath, "utf8").catch(() => "");
    if (!raw) continue;
    const parsed = JSON.parse(raw) as { version?: string };
    if (parsed.version) return parsed.version;
  }
  return "unknown";
}

async function getDatabaseSchemaVersion() {
  return (
    (await executeSqlScalar(`
      SELECT migration_name
      FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL
        AND rolled_back_at IS NULL
      ORDER BY finished_at DESC
      LIMIT 1;
    `)) || null
  );
}

async function knownSchemaVersions() {
  const locations = [
    path.resolve(process.cwd(), "prisma/migrations"),
    path.resolve(process.cwd(), "apps/api/prisma/migrations")
  ];
  for (const directory of locations) {
    const rows = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const versions = rows
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    if (versions.length) return versions;
  }
  return [];
}

function apiWorkingDirectory() {
  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), "apps/api")
  ];
  return candidates.find((candidate) =>
    requirePathExists(path.join(candidate, "prisma", "schema.prisma"))
  ) ?? process.cwd();
}

function requirePathExists(target: string) {
  try {
    return statSync(target).isFile();
  } catch {
    return false;
  }
}

export async function applyPostRestoreSchemaAndSeed() {
  const cwd = apiWorkingDirectory();
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : "npm";
  const prefix = npmCli ? [npmCli] : [];
  await execute(command, [...prefix, "run", "prisma", "--", "migrate", "deploy"], { cwd });
  await execute(command, [...prefix, "run", "seed"], { cwd });
}

function fallbackMetadata(createdAt: string): NativeBackupMetadata {
  return {
    version: 0,
    format: "postgres-custom",
    app: "Muhaseb",
    createdAt,
    uploadsIncluded: false,
    tableCounts: {}
  };
}

async function readMetadataFile(filePath: string) {
  const raw = await readFile(backupMetadataPath(filePath), "utf8").catch(() => "");
  if (!raw) return { metadata: null, raw: "" };
  return { metadata: JSON.parse(raw) as NativeBackupMetadata, raw };
}

export async function readBackupMetadata(filePath: string): Promise<NativeBackupMetadata> {
  const fileStat = await stat(filePath);
  const { metadata } = await readMetadataFile(filePath);
  return metadata ?? fallbackMetadata(fileStat.mtime.toISOString());
}

function archiveEntryCount(toc: string) {
  return toc
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith(";")).length;
}

export async function validateNativeBackup(
  filePath: string,
  options: ValidationOptions = {}
): Promise<NativeBackupValidation> {
  await access(filePath);
  const fileStat = await stat(filePath);
  const errors: string[] = [];
  const warnings: string[] = [];
  let metadata: NativeBackupMetadata;
  let hasMetadata = true;

  try {
    const parsed = await readMetadataFile(filePath);
    hasMetadata = Boolean(parsed.metadata);
    metadata = parsed.metadata ?? fallbackMetadata(fileStat.mtime.toISOString());
  } catch (error) {
    metadata = fallbackMetadata(fileStat.mtime.toISOString());
    errors.push(
      `Backup metadata is invalid: ${error instanceof Error ? error.message : "invalid JSON"}`
    );
  }

  if (!hasMetadata) {
    warnings.push(
      "Legacy backup has no metadata; restore is limited to database-only and current uploads will be preserved"
    );
  } else {
    if (metadata.app !== "Muhaseb") errors.push("Backup was not created by Muhaseb");
    if (metadata.format !== "postgres-custom") errors.push("Unsupported backup format");
    if (!Number.isInteger(metadata.version) || metadata.version < 1) {
      errors.push("Backup metadata version is invalid");
    }
    if (metadata.version > CURRENT_BACKUP_VERSION) {
      errors.push(`Backup version ${metadata.version} is newer than this server supports`);
    }
    if (!metadata.createdAt || Number.isNaN(Date.parse(metadata.createdAt))) {
      errors.push("Backup creation date is invalid");
    }
    if (typeof metadata.uploadsIncluded !== "boolean") {
      errors.push("Backup uploadsIncluded flag is invalid");
    }
    if (!metadata.tableCounts || typeof metadata.tableCounts !== "object") {
      errors.push("Backup table counts are invalid");
    }
  }

  let toc = "";
  try {
    toc = await (options.inspectArchive ?? inspectPostgresArchive)(filePath);
    if (!archiveEntryCount(toc)) errors.push("PostgreSQL archive contains no restore entries");
  } catch (error) {
    errors.push(
      `PostgreSQL archive validation failed: ${
        error instanceof Error ? error.message : "pg_restore --list failed"
      }`
    );
  }

  const sha256 = await sha256File(filePath);
  const checksumMatches = metadata.databaseSha256
    ? metadata.databaseSha256 === sha256
    : null;
  if (checksumMatches === false) errors.push("Database backup checksum does not match metadata");
  if (hasMetadata && metadata.version >= CURRENT_BACKUP_VERSION && !metadata.databaseSha256) {
    errors.push("Database backup checksum is missing from metadata");
  } else if (!metadata.databaseSha256) {
    warnings.push("Backup has no database checksum; archive structure was validated instead");
  } else if (!/^[a-f0-9]{64}$/.test(metadata.databaseSha256)) {
    errors.push("Database backup checksum format is invalid");
  }
  if (
    metadata.databaseSizeBytes !== undefined &&
    metadata.databaseSizeBytes !== fileStat.size
  ) {
    errors.push("Database backup size does not match metadata");
  }

  const versions = await knownSchemaVersions();
  const latestKnownVersion = versions.at(-1) ?? null;
  if (metadata.schemaVersion && !versions.includes(metadata.schemaVersion)) {
    if (latestKnownVersion && metadata.schemaVersion > latestKnownVersion) {
      errors.push(
        `Backup schema ${metadata.schemaVersion} is newer than server schema ${latestKnownVersion}`
      );
    } else {
      warnings.push(`Backup schema ${metadata.schemaVersion} is not present in this release`);
    }
  }

  let uploads: UploadSnapshotValidation = {
    present: false,
    valid: true,
    legacy: false,
    files: 0,
    totalBytes: 0,
    manifestSha256: null,
    errors: []
  };
  try {
    uploads = await validateUploadedFilesBackup(filePath, {
      required: hasMetadata && metadata.uploadsIncluded
    });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Upload snapshot validation failed");
  }

  if (
    metadata.uploadSnapshot?.manifestSha256 &&
    uploads.manifestSha256 &&
    metadata.uploadSnapshot.manifestSha256 !== uploads.manifestSha256
  ) {
    errors.push("Upload manifest checksum does not match backup metadata");
  }
  if (
    hasMetadata &&
    metadata.version >= CURRENT_BACKUP_VERSION &&
    metadata.uploadsIncluded &&
    !metadata.uploadSnapshot?.manifestSha256
  ) {
    errors.push("Upload manifest checksum is missing from backup metadata");
  }
  if (
    metadata.uploadSnapshot?.files !== undefined &&
    uploads.present &&
    metadata.uploadSnapshot.files !== uploads.files
  ) {
    errors.push("Upload file count does not match backup metadata");
  }
  if (
    metadata.uploadSnapshot?.totalBytes !== undefined &&
    uploads.present &&
    metadata.uploadSnapshot.totalBytes !== uploads.totalBytes
  ) {
    errors.push("Upload total size does not match backup metadata");
  }
  if (uploads.legacy) {
    warnings.push("Upload snapshot uses a legacy manifest without per-file checksums");
  }

  return {
    valid: errors.length === 0,
    legacy: !hasMetadata || metadata.version < CURRENT_BACKUP_VERSION,
    restoreMode:
      hasMetadata && metadata.uploadsIncluded === true ? "full" : "database-only",
    metadata,
    database: {
      sizeBytes: fileStat.size,
      sha256,
      checksumMatches,
      archiveEntries: archiveEntryCount(toc)
    },
    uploads,
    errors,
    warnings
  };
}

export async function createNativeBackup(options: { includeUploads?: boolean } = {}) {
  const backupDir = getBackupDir();
  await mkdir(backupDir, { recursive: true });
  const filename = formatBackupName();
  const filePath = path.join(backupDir, filename);
  const includeUploads =
    options.includeUploads ?? process.env.BACKUP_UPLOADS_ENABLED !== "false";

  try {
    await createDump(filePath);
    const toc = await inspectPostgresArchive(filePath);
    if (!archiveEntryCount(toc)) throw new Error("Created PostgreSQL archive is empty");

    const fileStat = await stat(filePath);
    const databaseSha256 = await sha256File(filePath);
    const uploadSnapshot = includeUploads ? await backupUploadedFiles(filePath) : null;

    const metadata: NativeBackupMetadata = {
      version: CURRENT_BACKUP_VERSION,
      format: "postgres-custom",
      app: "Muhaseb",
      appVersion: await getAppVersion(),
      schemaVersion: await getDatabaseSchemaVersion(),
      createdAt: new Date().toISOString(),
      uploadsIncluded: includeUploads,
      databaseSizeBytes: fileStat.size,
      databaseSha256,
      tableCounts: {},
      uploadSnapshot
    };
    await writeFile(
      backupMetadataPath(filePath),
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8"
    );

    const validation = await validateNativeBackup(filePath, {
      inspectArchive: async () => toc
    });
    if (!validation.valid) {
      throw new Error(`Created backup failed validation: ${validation.errors.join("; ")}`);
    }

    return { filename, filePath, metadata, validation };
  } catch (error) {
    await Promise.all([
      rm(filePath, { force: true }),
      rm(backupMetadataPath(filePath), { force: true }),
      rm(`${filePath}-uploads`, { recursive: true, force: true })
    ]);
    throw error;
  }
}

export async function restoreNativeBackup(
  filePath: string,
  options: { validation?: NativeBackupValidation } = {}
) {
  const validation = options.validation ?? (await validateNativeBackup(filePath));
  if (!validation.valid) {
    throw new Error(`Backup validation failed: ${validation.errors.join("; ")}`);
  }

  await restoreDump(filePath);
  const uploadResult = await restoreUploadedFiles(filePath, {
    required: validation.restoreMode === "full"
  });
  return { validation, uploadResult };
}

export async function deleteBackupMetadata(filePath: string) {
  await rm(backupMetadataPath(filePath), { force: true });
}
