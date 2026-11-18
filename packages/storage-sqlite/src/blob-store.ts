import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { assertSafeBlobKey, type BlobKey, type BlobStore } from "@opennest/core";

const BLOB_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const META_SUFFIX = ".meta.json";

export const DEFAULT_STALE_TEMP_AGE_MS = 24 * 60 * 60 * 1000;

export interface FileSystemBlobStoreConfig {
  rootDir: string;
}

export interface BlobReconcileOptions {
  staleTempAgeMs?: number;
  now?: () => number;
}

export interface BlobReconcileResult {
  removedBlobs: number;
  removedMetadata: number;
  removedTemporaryFiles: number;
}

function isTemporaryFile(name: string): boolean {
  return name.startsWith(".") && name.endsWith(".tmp");
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

export class FileSystemBlobStore implements BlobStore {
  readonly rootDir: string;

  constructor(config: FileSystemBlobStoreConfig) {
    this.rootDir = path.resolve(config.rootDir);
  }

  private blobsDir(): string {
    return path.join(this.rootDir, "blobs");
  }

  private filePath(key: BlobKey): string {
    return path.join(this.blobsDir(), key.slice(0, 2), key);
  }

  private metaPath(key: BlobKey): string {
    return `${this.filePath(key)}${META_SUFFIX}`;
  }

  async put(key: BlobKey, data: Blob | Uint8Array): Promise<void> {
    assertSafeBlobKey(key);

    const target = this.filePath(key);
    const directory = path.dirname(target);
    const bytes =
      data instanceof Uint8Array
        ? new Uint8Array(data)
        : new Uint8Array(await data.arrayBuffer());
    const mimeType = data instanceof Uint8Array ? "" : data.type;

    await mkdir(directory, { recursive: true });

    const temporary = path.join(directory, `.${key}.${randomUUID()}.tmp`);
    await writeFile(temporary, bytes, { mode: 0o600 });
    await rename(temporary, target);

    if (mimeType.length > 0) {
      const metadataTemporary = path.join(directory, `.${key}.${randomUUID()}.meta.tmp`);
      await writeFile(metadataTemporary, JSON.stringify({ type: mimeType }), {
        mode: 0o600,
      });
      await rename(metadataTemporary, this.metaPath(key));
    } else {
      await rm(this.metaPath(key), { force: true });
    }
  }

  async get(key: BlobKey): Promise<Blob | null> {
    assertSafeBlobKey(key);

    let bytes: Uint8Array;

    try {
      bytes = new Uint8Array(await readFile(this.filePath(key)));
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }

      throw error;
    }

    let mimeType = "";

    try {
      const metadata = JSON.parse(await readFile(this.metaPath(key), "utf8")) as {
        type?: unknown;
      };

      if (typeof metadata.type === "string") {
        mimeType = metadata.type;
      }
    } catch (error) {
      if (!isNotFound(error)) {
        mimeType = "";
      }
    }

    return new Blob([Uint8Array.from(bytes)], { type: mimeType });
  }

  async delete(key: BlobKey): Promise<void> {
    assertSafeBlobKey(key);

    await rm(this.filePath(key), { force: true });
    await rm(this.metaPath(key), { force: true });
  }

  async has(key: BlobKey): Promise<boolean> {
    assertSafeBlobKey(key);

    try {
      await access(this.filePath(key));
      return true;
    } catch (error) {
      if (isNotFound(error)) {
        return false;
      }

      throw error;
    }
  }

  async usage(): Promise<{ bytes: number; items: number }> {
    const root = this.blobsDir();
    let entries: import("node:fs").Dirent[];

    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (isNotFound(error)) {
        return { bytes: 0, items: 0 };
      }

      throw error;
    }

    let bytes = 0;
    let items = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const files = await readdir(path.join(root, entry.name), { withFileTypes: true });

      for (const file of files) {
        if (!file.isFile() || !BLOB_FILE.test(file.name)) {
          continue;
        }

        const info = await stat(path.join(root, entry.name, file.name));
        bytes += info.size;
        items += 1;
      }
    }

    return { bytes, items };
  }

  async reconcile(
    knownKeys: BlobKey[],
    options: BlobReconcileOptions = {}
  ): Promise<BlobReconcileResult> {
    const known = new Set<string>();

    for (const key of knownKeys) {
      assertSafeBlobKey(key);
      known.add(key);
    }

    const staleTempAgeMs = options.staleTempAgeMs ?? DEFAULT_STALE_TEMP_AGE_MS;
    const now = options.now?.() ?? Date.now();
    const root = this.blobsDir();
    let entries: import("node:fs").Dirent[];

    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (isNotFound(error)) {
        return { removedBlobs: 0, removedMetadata: 0, removedTemporaryFiles: 0 };
      }

      throw error;
    }

    let removedBlobs = 0;
    let removedMetadata = 0;
    let removedTemporaryFiles = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const directory = path.join(root, entry.name);
      const files = await readdir(directory, { withFileTypes: true });

      for (const file of files) {
        if (!file.isFile()) {
          continue;
        }

        const filePath = path.join(directory, file.name);

        if (isTemporaryFile(file.name)) {
          const info = await stat(filePath);

          if (now - info.mtimeMs >= staleTempAgeMs) {
            await rm(filePath, { force: true });
            removedTemporaryFiles += 1;
          }

          continue;
        }

        const isBlob = BLOB_FILE.test(file.name);
        const isMeta = file.name.endsWith(META_SUFFIX);

        if (!isBlob && !isMeta) {
          continue;
        }

        const key = isMeta ? file.name.slice(0, -META_SUFFIX.length) : file.name;

        if (known.has(key)) {
          continue;
        }

        await rm(filePath, { force: true });

        if (isBlob) {
          removedBlobs += 1;
        } else {
          removedMetadata += 1;
        }
      }
    }

    return { removedBlobs, removedMetadata, removedTemporaryFiles };
  }

  async purgeOrphans(knownKeys: BlobKey[]): Promise<number> {
    const known = new Set<string>(knownKeys);
    const root = this.blobsDir();
    let entries: import("node:fs").Dirent[];

    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (isNotFound(error)) {
        return 0;
      }

      throw error;
    }

    let removed = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const directory = path.join(root, entry.name);
      const files = await readdir(directory, { withFileTypes: true });

      for (const file of files) {
        if (!file.isFile()) {
          continue;
        }

        const isBlob = BLOB_FILE.test(file.name);
        const isMeta = file.name.endsWith(META_SUFFIX);

        if (!isBlob && !isMeta) {
          continue;
        }

        const key = isMeta ? file.name.slice(0, -META_SUFFIX.length) : file.name;

        if (known.has(key)) {
          continue;
        }

        await rm(path.join(directory, file.name), { force: true });

        if (isBlob) {
          removed += 1;
        }
      }
    }

    return removed;
  }
}
