import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  copyFile,
  link,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";

export type UploadManifestEntry = {
  relativePath: string;
  size: number;
  mtimeMs: number;
  sha256?: string;
};

type UploadManifest = {
  version: 2;
  createdAt: string;
  files: UploadManifestEntry[];
};

const RESTORE_WORK_DIRECTORY_PREFIX = ".muhaseb-restore-";

export type UploadSnapshotValidation = {
  present: boolean;
  valid: boolean;
  legacy: boolean;
  files: number;
  totalBytes: number;
  manifestSha256: string | null;
  errors: string[];
};

export function getUploadDir() {
  return path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads"));
}

export function getBackupUploadDir(backupFilePath: string) {
  return `${backupFilePath}-uploads`;
}

function manifestPath(directory: string) {
  return path.join(directory, ".manifest.json");
}

async function exists(target: string) {
  return access(target).then(
    () => true,
    () => false
  );
}

function portableRelativePath(value: string) {
  return value.split(path.sep).join("/");
}

function safeAbsolutePath(root: string, relativePath: string) {
  const normalized = relativePath.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.includes("\0") ||
    path.posix.isAbsolute(normalized) ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new Error(`Unsafe upload manifest path: ${relativePath}`);
  }

  const absolute = path.resolve(root, ...normalized.split("/"));
  const relation = path.relative(root, absolute);
  if (relation.startsWith("..") || path.isAbsolute(relation)) {
    throw new Error(`Upload manifest path leaves its snapshot: ${relativePath}`);
  }
  return absolute;
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

async function walk(directory: string, root = directory): Promise<UploadManifestEntry[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const rows: UploadManifestEntry[] = [];

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (directory === root && entry.name.startsWith(RESTORE_WORK_DIRECTORY_PREFIX)) {
        continue;
      }
      rows.push(...(await walk(absolute, root)));
    } else if (entry.isFile() && entry.name !== ".manifest.json") {
      const fileStat = await stat(absolute);
      rows.push({
        relativePath: portableRelativePath(path.relative(root, absolute)),
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        sha256: await sha256File(absolute)
      });
    }
  }

  return rows.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function parseManifest(raw: string) {
  const parsed = JSON.parse(raw) as UploadManifest | UploadManifestEntry[];
  const legacy = Array.isArray(parsed);
  const files = legacy ? parsed : parsed.files;

  if (!Array.isArray(files)) {
    throw new Error("Upload manifest does not contain a file list");
  }

  const seen = new Set<string>();
  for (const file of files) {
    if (
      !file ||
      typeof file.relativePath !== "string" ||
      !Number.isFinite(file.size) ||
      file.size < 0 ||
      !Number.isFinite(file.mtimeMs)
    ) {
      throw new Error("Upload manifest contains an invalid entry");
    }
    const key = file.relativePath.replaceAll("\\", "/").toLocaleLowerCase("en");
    if (seen.has(key)) throw new Error(`Duplicate upload manifest path: ${file.relativePath}`);
    seen.add(key);
  }

  return { files, legacy };
}

async function readManifest(directory: string | null) {
  if (!directory) return { files: [], legacy: false };
  const raw = await readFile(manifestPath(directory), "utf8");
  return parseManifest(raw);
}

async function previousSnapshot(destination: string) {
  const parent = path.dirname(destination);
  const candidates = (await readdir(parent, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".dump-uploads"))
    .map((entry) => path.join(parent, entry.name))
    .filter((directory) => directory !== destination);

  const rows = await Promise.all(
    candidates.map(async (directory) => ({ directory, modified: (await stat(directory)).mtimeMs }))
  );
  return rows.sort((left, right) => right.modified - left.modified)[0]?.directory ?? null;
}

async function swapDirectory(staging: string, destination: string) {
  const previous = `${destination}.pre-restore-${randomUUID()}`;
  let movedPrevious = false;

  try {
    if (await exists(destination)) {
      await rename(destination, previous);
      movedPrevious = true;
    }
    await rename(staging, destination);
  } catch (error) {
    if (movedPrevious) {
      await rm(destination, { recursive: true, force: true }).catch(() => undefined);
      await rename(previous, destination);
    }
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }

  if (movedPrevious) {
    await rm(previous, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function replaceMountedDirectoryContents(staging: string, destination: string) {
  const rollbackName = [
    RESTORE_WORK_DIRECTORY_PREFIX,
    "previous-",
    randomUUID()
  ].join("");
  const rollback = path.join(destination, rollbackName);
  const stagingName = path.basename(staging);
  const installedNames: string[] = [];
  let committed = false;
  let rollbackCompleted = false;

  await mkdir(destination, { recursive: true });
  await mkdir(rollback, { recursive: true });

  try {
    const currentNames = (await readdir(destination)).filter(
      (name) =>
        name !== stagingName &&
        name !== rollbackName &&
        !name.startsWith(RESTORE_WORK_DIRECTORY_PREFIX)
    );
    for (const name of currentNames) {
      await rename(path.join(destination, name), path.join(rollback, name));
    }

    for (const name of await readdir(staging)) {
      await rename(path.join(staging, name), path.join(destination, name));
      installedNames.push(name);
    }
    committed = true;
  } catch (restoreError) {
    try {
      for (const name of installedNames.reverse()) {
        await rm(path.join(destination, name), { recursive: true, force: true });
      }
      for (const name of await readdir(rollback)) {
        await rename(path.join(rollback, name), path.join(destination, name));
      }
      rollbackCompleted = true;
    } catch (rollbackError) {
      throw new AggregateError(
        [restoreError, rollbackError],
        "Upload restore failed and the previous upload contents could not be fully restored"
      );
    }
    throw restoreError;
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    if (committed || rollbackCompleted) {
      await rm(rollback, { recursive: true, force: true }).catch(() => undefined);
    }
  }

}

async function validateUploadDirectory(directory: string): Promise<UploadSnapshotValidation> {
  if (!(await exists(directory))) {
    return {
      present: false,
      valid: false,
      legacy: false,
      files: 0,
      totalBytes: 0,
      manifestSha256: null,
      errors: ["Upload snapshot directory is missing"]
    };
  }

  const errors: string[] = [];
  let files: UploadManifestEntry[] = [];
  let legacy = false;
  let rawManifest = "";

  try {
    rawManifest = await readFile(manifestPath(directory), "utf8");
    ({ files, legacy } = parseManifest(rawManifest));
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Upload manifest is invalid");
  }

  for (const file of files) {
    try {
      const absolute = safeAbsolutePath(directory, file.relativePath);
      const fileStat = await stat(absolute);
      if (!fileStat.isFile()) {
        errors.push(`${file.relativePath}: expected a file`);
        continue;
      }
      if (fileStat.size !== file.size) {
        errors.push(`${file.relativePath}: size does not match manifest`);
        continue;
      }
      if (file.sha256 && (await sha256File(absolute)) !== file.sha256) {
        errors.push(`${file.relativePath}: checksum does not match manifest`);
      }
    } catch (error) {
      errors.push(
        `${file.relativePath}: ${error instanceof Error ? error.message : "file validation failed"}`
      );
    }
  }

  return {
    present: true,
    valid: errors.length === 0,
    legacy: legacy || files.some((file) => !file.sha256),
    files: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    manifestSha256: rawManifest
      ? createHash("sha256").update(rawManifest, "utf8").digest("hex")
      : null,
    errors
  };
}

export async function validateUploadedFilesBackup(
  backupFilePath: string,
  options: { required?: boolean } = {}
) {
  const result = await validateUploadDirectory(getBackupUploadDir(backupFilePath));
  if (options.required && !result.present) {
    throw new Error("Backup metadata requires uploads, but the upload snapshot is missing");
  }
  if (result.present && !result.valid) {
    throw new Error(`Upload snapshot validation failed: ${result.errors.join("; ")}`);
  }
  return result;
}

export async function backupUploadedFiles(backupFilePath: string) {
  const source = getUploadDir();
  const destination = getBackupUploadDir(backupFilePath);
  const staging = `${destination}.staging-${randomUUID()}`;
  const previous = await previousSnapshot(destination);
  const previousManifest = previous
    ? new Map((await readManifest(previous)).files.map((entry) => [entry.relativePath, entry]))
    : new Map<string, UploadManifestEntry>();
  const files = await walk(source);
  let linked = 0;
  let copied = 0;

  await mkdir(staging, { recursive: true });

  try {
    for (const file of files) {
      const sourceFile = safeAbsolutePath(source, file.relativePath);
      const destinationFile = safeAbsolutePath(staging, file.relativePath);
      await mkdir(path.dirname(destinationFile), { recursive: true });
      const previousFile = previous ? safeAbsolutePath(previous, file.relativePath) : "";
      const old = previousManifest.get(file.relativePath);

      if (
        old &&
        old.size === file.size &&
        old.sha256 &&
        file.sha256 &&
        old.sha256 === file.sha256
      ) {
        try {
          await link(previousFile, destinationFile);
          linked += 1;
          continue;
        } catch {
          // Hard links are an optimization only; copies work across volumes.
        }
      }

      await copyFile(sourceFile, destinationFile);
      copied += 1;
    }

    const manifest: UploadManifest = {
      version: 2,
      createdAt: new Date().toISOString(),
      files
    };
    await writeFile(manifestPath(staging), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const validation = await validateUploadDirectory(staging);
    if (!validation.valid) {
      throw new Error(`Upload snapshot validation failed: ${validation.errors.join("; ")}`);
    }

    await swapDirectory(staging, destination);
    return {
      files: files.length,
      linked,
      copied,
      totalBytes: validation.totalBytes,
      manifestSha256: validation.manifestSha256
    };
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function restoreUploadedFiles(
  backupFilePath: string,
  options: { required?: boolean } = {}
) {
  const source = getBackupUploadDir(backupFilePath);
  const sourceValidation = await validateUploadedFilesBackup(backupFilePath, options);
  if (!sourceValidation.present) {
    return { restored: false, preserved: true, validation: sourceValidation };
  }

  const destination = getUploadDir();
  const staging = path.join(
    destination,
    [RESTORE_WORK_DIRECTORY_PREFIX, "staging-", randomUUID()].join("")
  );
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  try {
    const { files } = await readManifest(source);
    for (const file of files) {
      const sourceFile = safeAbsolutePath(source, file.relativePath);
      const destinationFile = safeAbsolutePath(staging, file.relativePath);
      await mkdir(path.dirname(destinationFile), { recursive: true });
      await copyFile(sourceFile, destinationFile);
    }

    const stagingFiles = await walk(staging);
    const expectedByPath = new Map(files.map((file) => [file.relativePath, file]));
    for (const staged of stagingFiles) {
      const expected = expectedByPath.get(staged.relativePath);
      if (
        !expected ||
        expected.size !== staged.size ||
        (expected.sha256 && expected.sha256 !== staged.sha256)
      ) {
        throw new Error(`Staged upload file failed validation: ${staged.relativePath}`);
      }
    }
    if (stagingFiles.length !== files.length) {
      throw new Error("Staged upload file count does not match the backup manifest");
    }

    await replaceMountedDirectoryContents(staging, destination);
    return { restored: true, preserved: false, validation: sourceValidation };
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function deleteUploadedFilesBackup(backupFilePath: string) {
  await rm(getBackupUploadDir(backupFilePath), { recursive: true, force: true });
}
