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

function toSqliteValues(params: readonly unknown[]): SQLInputValue[] {
  return params as SQLInputValue[];
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

    await migrate(
      db,
      async (queries) => {
        for (const query of queries) {
          sqlite.exec(query);
        }
      },
      { migrationsFolder: MIGRATIONS_FOLDER }
    );

    const row = sqlite
      .prepare("SELECT COUNT(*) AS count FROM __drizzle_migrations")
      .get() as { count?: number | bigint } | undefined;
    const migrationCount = Number(row?.count ?? 0);

    if (!Number.isInteger(migrationCount) || migrationCount < 0) {
      throw new StorageError("The migration ledger is unreadable.", "corrupt_data");
    }

    sqlite.exec(`PRAGMA user_version = ${migrationCount}`);

    return { sqlite, db, migrationCount };
  } catch (error) {
    sqlite.close();

    throw mapSqliteError(error);
  }
}
