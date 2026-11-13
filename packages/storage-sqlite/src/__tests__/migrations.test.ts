// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { idGenerator, type BlobKey } from "@opennest/core";
import { afterEach, describe, expect, it } from "vitest";

import { createSqliteStorage } from "../index";

const directories: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "opennest-sqlite-migrations-"));
  directories.push(root);

  return root;
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("sqlite migrations", () => {
  it("applies every migration and records the count in user_version", async () => {
    const root = await makeRoot();
    const databaseFile = path.join(root, "database.sqlite");
    const storage = createSqliteStorage({
      databaseFile,
      blobRoot: path.join(root, "blobs"),
    });

    await storage.init();
    expect(storage.schemaVersion).toBe(2);
    await storage.close();

    const database = new DatabaseSync(databaseFile);

    try {
      const version = database.prepare("PRAGMA user_version").get() as
        { user_version?: number } | undefined;
      expect(Number(version?.user_version)).toBe(2);

      const tables = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>;
      const names = tables.map((table) => table.name);

      for (const table of [
        "workspaces",
        "folders",
        "files",
        "notes",
        "tags",
        "file_tags",
        "note_tags",
        "note_links",
      ]) {
        expect(names).toContain(table);
      }

      const triggers = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
        .all() as Array<{ name: string }>;
      expect(triggers.length).toBe(6);
    } finally {
      database.close();
    }
  });

  it("keeps the FTS indexes in sync and reindexes existing rows", async () => {
    const root = await makeRoot();
    const databaseFile = path.join(root, "database.sqlite");
    const blobRoot = path.join(root, "blobs");
    const nextKey = idGenerator(9001);

    const storage = createSqliteStorage({ databaseFile, blobRoot });
    await storage.init();
    const workspace = await storage.workspaces.ensureWorkspace({
      at: "2026-11-12T00:00:00.000Z" as never,
    });
    const note = await storage.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Rencana Liburan",
      content: "Pantai dan gunung",
      at: "2026-11-12T00:00:00.000Z" as never,
    });
    await storage.files.create({
      workspaceId: workspace.id,
      folderId: null,
      name: "anggaran.pdf",
      mimeType: "application/pdf",
      sizeBytes: 3,
      blobKey: nextKey() as BlobKey,
      checksum: null,
      at: "2026-11-12T00:00:00.000Z" as never,
    });

    expect(
      (await storage.search.search({ workspaceId: workspace.id, text: "pantai" })).length
    ).toBe(1);
    expect(
      (await storage.search.search({ workspaceId: workspace.id, text: "anggaran" }))
        .length
    ).toBe(1);

    await storage.search.reindexAll(workspace.id);

    expect(
      (await storage.search.search({ workspaceId: workspace.id, text: "gunung" })).length
    ).toBe(1);

    await storage.notes.update(note.id, {
      content: "Hanya kantor",
      at: "2026-11-12T00:00:01.000Z" as never,
    });

    expect(
      (await storage.search.search({ workspaceId: workspace.id, text: "pantai" })).length
    ).toBe(0);
    expect(
      (await storage.search.search({ workspaceId: workspace.id, text: "kantor" })).length
    ).toBe(1);

    await storage.notes.delete(note.id);

    expect(
      (await storage.search.search({ workspaceId: workspace.id, text: "kantor" })).length
    ).toBe(0);
    await storage.close();
  });
});
