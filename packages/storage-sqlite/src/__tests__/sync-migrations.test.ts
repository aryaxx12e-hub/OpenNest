// @vitest-environment node

import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createSqliteStorage } from "../index";

const AT = "2026-11-15T10:00:00.000Z";
const directories: string[] = [];
const migrationsRoot = fileURLToPath(new URL("../../migrations", import.meta.url));

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "opennest-sqlite-sync-migrations-"));
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

async function applyMigration(database: DatabaseSync, file: string): Promise<void> {
  const source = await readFile(path.join(migrationsRoot, file), "utf8");
  for (const statement of source.split("--> statement-breakpoint")) {
    if (statement.trim().length > 0) {
      database.exec(statement);
    }
  }
}

async function seedVersionTwo(databaseFile: string): Promise<void> {
  const database = new DatabaseSync(databaseFile);

  try {
    database.exec("PRAGMA foreign_keys = ON");
    await applyMigration(database, "0000_icy_living_mummy.sql");
    await applyMigration(database, "0001_fts5.sql");
    database.exec(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash text NOT NULL,
        created_at numeric
      )
    `);
    database
      .prepare('INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES (?, ?)')
      .run("seed-0", 1794535672982);
    database
      .prepare('INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES (?, ?)')
      .run("seed-1", 1794535688087);

    database
      .prepare(
        "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)"
      )
      .run("workspace-1", "Rumah", AT, AT);
    database
      .prepare(
        "INSERT INTO folders (id, workspace_id, parent_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run("folder-1", "workspace-1", null, "Akar", AT, AT);
    database
      .prepare(
        "INSERT INTO files (id, workspace_id, folder_id, name, mime_type, size_bytes, blob_key, checksum, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        "file-1",
        "workspace-1",
        "folder-1",
        "Catatan.pdf",
        "application/pdf",
        2,
        "blob-1",
        "checksum-1",
        AT,
        AT
      );
    database
      .prepare(
        "INSERT INTO notes (id, workspace_id, folder_id, title, content, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run("note-1", "workspace-1", null, "Halo", "Isi", 0, AT, AT);
    database
      .prepare(
        "INSERT INTO tags (id, workspace_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run("tag-1", "workspace-1", "penting", "#111111", AT);
  } finally {
    database.close();
  }
}

async function seedVersionThreeWithOutbox(databaseFile: string): Promise<void> {
  const database = new DatabaseSync(databaseFile);

  try {
    database.exec("PRAGMA foreign_keys = ON");
    await applyMigration(database, "0000_icy_living_mummy.sql");
    await applyMigration(database, "0001_fts5.sql");
    await applyMigration(database, "0002_sync_sidecars.sql");
    database.exec(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash text NOT NULL,
        created_at numeric
      )
    `);
    for (const [hash, createdAt] of [
      ["seed-0", 1794535672982],
      ["seed-1", 1794535688087],
      ["seed-2", 1794757737967],
    ] as const) {
      database
        .prepare('INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES (?, ?)')
        .run(hash, createdAt);
    }

    database
      .prepare(
        "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)"
      )
      .run("workspace-1", "Rumah", AT, AT);
    database
      .prepare(
        "INSERT INTO sync_devices (workspace_id, device_id, registered_at, last_seen_at, last_acked_tombstone_workspace_revision, state, public_key) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run("workspace-1", "device-1", AT, AT, 0, "active", null);
    database
      .prepare(
        "INSERT INTO workspace_sync_state (workspace_id, device_id, remote_workspace_id, last_server_cursor, last_local_workspace_revision, tombstone_floor, last_full_resync_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run("workspace-1", "device-1", null, null, 3, 0, null);
    database
      .prepare(
        "INSERT INTO sync_outbox (op_id, workspace_id, entity_type, entity_id, operation, base_entity_revision, base_workspace_revision, field_patches, payload_hash, created_at, device_id, local_sequence, attempts, state, acked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        "op-1",
        "workspace-1",
        "note",
        "note-1",
        "create",
        0,
        0,
        "{}",
        "a".repeat(64),
        AT,
        "device-1",
        4,
        0,
        "pending",
        null
      );
  } finally {
    database.close();
  }
}

function migrationCount(database: DatabaseSync): number {
  const row = database
    .prepare("SELECT COUNT(*) AS count FROM __drizzle_migrations")
    .get() as { count?: number | bigint } | undefined;

  return Number(row?.count ?? 0);
}

function tableExists(database: DatabaseSync, name: string): boolean {
  return (
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) !== undefined
  );
}

describe("SQLite sync migration", () => {
  it("rolls back every migration statement when one statement fails", async () => {
    const root = await makeRoot();
    const databaseFile = path.join(root, "database.sqlite");
    await seedVersionTwo(databaseFile);

    const blocked = new DatabaseSync(databaseFile);
    blocked.exec("CREATE VIEW sync_meta AS SELECT id FROM workspaces");
    blocked.close();

    const storage = createSqliteStorage({
      databaseFile,
      blobRoot: path.join(root, "blobs"),
    });

    await expect(storage.init()).rejects.toMatchObject({ code: "corrupt_data" });

    const database = new DatabaseSync(databaseFile);

    try {
      expect(migrationCount(database)).toBe(2);
      expect(tableExists(database, "sync_conflict")).toBe(false);
      expect(tableExists(database, "sync_devices")).toBe(false);
      expect(tableExists(database, "sync_field_meta")).toBe(false);
      expect(tableExists(database, "workspace_sync_state")).toBe(false);
    } finally {
      database.close();
    }
  });

  it("rejects a database with partial sync tables but no matching migration", async () => {
    const root = await makeRoot();
    const databaseFile = path.join(root, "database.sqlite");
    await seedVersionTwo(databaseFile);

    const partial = new DatabaseSync(databaseFile);
    partial.exec("CREATE TABLE sync_conflict (conflict_id text PRIMARY KEY NOT NULL)");
    partial.close();

    const storage = createSqliteStorage({
      databaseFile,
      blobRoot: path.join(root, "blobs"),
    });

    await expect(storage.init()).rejects.toMatchObject({ code: "corrupt_data" });
  });

  it("backfills the local sequence high-water from version 3", async () => {
    const root = await makeRoot();
    const databaseFile = path.join(root, "database.sqlite");
    await seedVersionThreeWithOutbox(databaseFile);

    const storage = createSqliteStorage({
      databaseFile,
      blobRoot: path.join(root, "blobs"),
    });
    await storage.init();
    expect(storage.schemaVersion).toBe(4);
    expect(await storage.sync.nextLocalSequence("workspace-1", "device-1")).toBe(5);
    expect(await storage.sync.getWorkspaceState("workspace-1", "device-1")).toMatchObject(
      { lastLocalSequence: 4 }
    );
    await storage.close();
  });

  it("backfills existing rows when migrating from version 2", async () => {
    const root = await makeRoot();
    const databaseFile = path.join(root, "database.sqlite");
    await seedVersionTwo(databaseFile);

    const storage = createSqliteStorage({
      databaseFile,
      blobRoot: path.join(root, "blobs"),
    });
    await storage.init();
    expect(storage.schemaVersion).toBe(4);
    await storage.close();

    const database = new DatabaseSync(databaseFile);

    try {
      const meta = database.prepare("SELECT * FROM sync_meta").all() as Array<{
        entity_type: string;
        entity_revision: number;
        workspace_revision: number;
        origin_device_id: string;
        content_hash: string | null;
      }>;
      expect(meta).toHaveLength(5);
      expect(meta.every((row) => row.entity_revision === 1)).toBe(true);
      expect(meta.every((row) => row.workspace_revision === 0)).toBe(true);

      const states = database
        .prepare("SELECT * FROM workspace_sync_state")
        .all() as Array<{ device_id: string }>;
      expect(states).toHaveLength(1);
      expect(states[0]!.device_id).not.toBe("legacy");

      const devices = database.prepare("SELECT * FROM sync_devices").all() as Array<{
        device_id: string;
      }>;
      expect(devices).toHaveLength(1);
      expect(meta.every((row) => row.origin_device_id === states[0]!.device_id)).toBe(
        true
      );

      const fileMeta = meta.find((row) => row.entity_type === "file");
      expect(fileMeta?.content_hash).toBe("checksum-1");
    } finally {
      database.close();
    }
  });
});
