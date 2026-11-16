import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { StorageError } from "@opennest/core";
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { migrate } from "drizzle-orm/sqlite-proxy/migrator";

import { mapSqliteError } from "./errors";
import * as schema from "./schema";

export type SqliteDatabase = SqliteRemoteDatabase<typeof schema>;

export interface OpenDatabaseResult {
  sqlite: DatabaseSync;
  db: SqliteDatabase;
  migrationCount: number;
}

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations", import.meta.url));
const SYNC_TABLES = [
  "sync_meta",
  "sync_field_meta",
  "sync_outbox",
  "workspace_sync_state",
  "sync_tombstone",
  "sync_conflict",
  "sync_devices",
] as const;

function toSqliteValues(params: readonly unknown[]): SQLInputValue[] {
  return params as SQLInputValue[];
}

function tableExists(sqlite: DatabaseSync, name: string): boolean {
  return (
    sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) !== undefined
  );
}

function readMigrationCount(sqlite: DatabaseSync): number {
  if (!tableExists(sqlite, "__drizzle_migrations")) {
    return 0;
  }

  const row = sqlite
    .prepare("SELECT COUNT(*) AS count FROM __drizzle_migrations")
    .get() as { count?: number | bigint } | undefined;

  return Number(row?.count ?? 0);
}

function rejectPartialSyncSchema(sqlite: DatabaseSync): void {
  const migrationCount = readMigrationCount(sqlite);

  if (migrationCount < 3 && SYNC_TABLES.some((name) => tableExists(sqlite, name))) {
    throw new StorageError(
      "The sync migration ledger does not match the existing tables.",
      "corrupt_data"
    );
  }
}

function runMigrationQueries(sqlite: DatabaseSync, queries: readonly string[]): void {
  sqlite.exec("BEGIN IMMEDIATE");

  try {
    for (const query of queries) {
      sqlite.exec(query);
    }

    sqlite.exec("COMMIT");
  } catch (error) {
    try {
      sqlite.exec("ROLLBACK");
    } catch {
      // The transaction was already rolled back by SQLite.
    }

    throw error;
  }
}

export async function openDatabase(databaseFile: string): Promise<OpenDatabaseResult> {
  const sqlite = new DatabaseSync(databaseFile);

  try {
    sqlite.exec("PRAGMA foreign_keys = ON");
    sqlite.exec("PRAGMA journal_mode = WAL");
    sqlite.exec("PRAGMA busy_timeout = 5000");

    const db = drizzle(
      async (query, params, method) => {
        const statement = sqlite.prepare(query);
        const values = toSqliteValues(params);

        if (method === "run") {
          statement.run(...values);

          return { rows: [] };
        }

        if (method === "get") {
          const row = statement.get(...values);

          return { rows: row === undefined ? [] : [Object.values(row)] };
        }

        return {
          rows: statement.all(...values).map((row) => Object.values(row)),
        };
      },
      { schema, casing: "snake_case" }
    );

    rejectPartialSyncSchema(sqlite);

    await migrate(
      db,
      async (queries) => {
        runMigrationQueries(sqlite, queries);
      },
      { migrationsFolder: MIGRATIONS_FOLDER }
    );

    const migrationCount = readMigrationCount(sqlite);

    if (!Number.isInteger(migrationCount) || migrationCount < 0) {
      throw new StorageError("The migration ledger is unreadable.", "corrupt_data");
    }

    if (!SYNC_TABLES.every((name) => tableExists(sqlite, name))) {
      throw new StorageError("The sync schema is incomplete.", "corrupt_data");
    }

    sqlite.exec(`PRAGMA user_version = ${migrationCount}`);

    return { sqlite, db, migrationCount };
  } catch (error) {
    sqlite.close();

    throw mapSqliteError(error);
  }
}
