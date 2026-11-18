// @vitest-environment node

import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { idGenerator, type BlobKey } from "@opennest/core";
import { afterEach, describe, expect, it } from "vitest";

import { createSqliteStorage } from "../index";

const AT = "2026-11-18T10:00:00.000Z" as never;
const open: Array<ReturnType<typeof createSqliteStorage>> = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((storage) => storage.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "opennest-sqlite-startup-"));
  roots.push(root);
  return root;
}

describe("SQLite startup recovery", () => {
  it("removes orphan blobs and stale temp files when reopening", async () => {
    const root = await makeRoot();
    const databaseFile = path.join(root, "database.sqlite");
    const blobRoot = path.join(root, "blobs");
    const nextKey = idGenerator(130);
    const kept = nextKey() as BlobKey;
    const orphan = nextKey() as BlobKey;

    const first = createSqliteStorage({ databaseFile, blobRoot });
    open.push(first);
    await first.init();
    const workspace = await first.workspaces.ensureWorkspace({ at: AT });
    await first.files.create({
      workspaceId: workspace.id,
      folderId: null,
      name: "kept.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
      blobKey: kept,
      checksum: null,
      at: AT,
    });
    await first.blobs.put(kept, new Uint8Array([1]));
    await first.blobs.put(orphan, new Uint8Array([2]));
    await first.close();

    const temp = path.join(
      blobRoot,
      "blobs",
      kept.slice(0, 2),
      `.${kept}.${randomUUID()}.tmp`
    );
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await writeFile(temp, new Uint8Array([3]));
    await utimes(temp, old, old);

    const reopened = createSqliteStorage({ databaseFile, blobRoot });
    open.push(reopened);
    await reopened.init();

    expect(await reopened.blobs.has(kept)).toBe(true);
    expect(await reopened.blobs.has(orphan)).toBe(false);
    await expect(access(temp)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes a fresh temporary file when staleTempAgeMs is zero", async () => {
    const root = await makeRoot();
    const databaseFile = path.join(root, "database.sqlite");
    const blobRoot = path.join(root, "blobs");
    const kept = idGenerator(131)() as BlobKey;

    const first = createSqliteStorage({ databaseFile, blobRoot });
    open.push(first);
    await first.init();
    const workspace = await first.workspaces.ensureWorkspace({ at: AT });
    await first.files.create({
      workspaceId: workspace.id,
      folderId: null,
      name: "kept.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
      blobKey: kept,
      checksum: null,
      at: AT,
    });
    await first.blobs.put(kept, new Uint8Array([1]));
    await first.close();

    const temp = path.join(
      blobRoot,
      "blobs",
      kept.slice(0, 2),
      `.${kept}.${randomUUID()}.tmp`
    );
    await writeFile(temp, new Uint8Array([2]));

    const reopened = createSqliteStorage({
      databaseFile,
      blobRoot,
      staleTempAgeMs: 0,
    });
    open.push(reopened);
    await reopened.init();

    expect(await reopened.blobs.has(kept)).toBe(true);
    await expect(access(temp)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("closes a failed open and allows a retry", async () => {
    const root = await makeRoot();
    const blobRoot = path.join(root, "blobs");
    const storage = createSqliteStorage({
      databaseFile: path.join(root, "database.sqlite"),
      blobRoot,
    });
    open.push(storage);

    await writeFile(blobRoot, "not a directory");

    await expect(storage.init()).rejects.toBeDefined();

    await rm(blobRoot, { force: true });
    await mkdir(blobRoot, { recursive: true });
    await storage.init();

    expect(storage.schemaVersion).toBeGreaterThan(0);
    await storage.close();
  });
});
