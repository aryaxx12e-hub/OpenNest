import { mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import type { PasswordDigest } from "./password";
import { AuthError } from "./errors";

export interface AuthDatabase {
  readonly databaseFile: string;
  readonly sqlite: DatabaseSync;
  close(): void;
}

export interface AuthUserRecord {
  id: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
}

export interface AuthUser {
  id: string;
  email: string;
  createdAt: string;
}

export interface CreateUserInput {
  email: string;
  digest: PasswordDigest;
  now: Date;
}

export interface OpenAuthDatabaseOptions {
  databaseFile: string;
}

const SCHEMA = readFileSync(
  fileURLToPath(new URL("./schema.sql", import.meta.url)),
  "utf8"
);

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function assertEmail(email: string): string {
  const normalized = normalizeEmail(email);

  if (
    normalized.length === 0 ||
    normalized.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    throw new AuthError("validation", "The email address is not valid.");
  }

  return normalized;
}

export function toAuthUser(user: AuthUserRecord): AuthUser {
  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt,
  };
}

export function openAuthDatabase(options: OpenAuthDatabaseOptions): AuthDatabase {
  try {
    mkdirSync(path.dirname(options.databaseFile), { recursive: true, mode: 0o700 });
  } catch (error) {
    throw new AuthError("auth_storage", "The authentication database is unavailable.", {
      cause: error,
    });
  }

  const sqlite = new DatabaseSync(options.databaseFile);

  try {
    sqlite.exec("PRAGMA foreign_keys = ON");
    sqlite.exec("PRAGMA journal_mode = WAL");
    sqlite.exec("PRAGMA busy_timeout = 5000");
    sqlite.exec(SCHEMA);
  } catch (error) {
    sqlite.close();
    throw new AuthError("auth_storage", "The authentication database is unavailable.", {
      cause: error,
    });
  }

  return {
    databaseFile: options.databaseFile,
    sqlite,
    close() {
      sqlite.close();
    },
  };
}

export function withTransaction<T>(database: AuthDatabase, work: () => T): T {
  database.sqlite.exec("BEGIN IMMEDIATE");

  try {
    const result = work();
    database.sqlite.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.sqlite.exec("ROLLBACK");
    } catch {
      // SQLite already rolled the transaction back.
    }

    throw error;
  }
}

export function findUserByEmail(
  database: AuthDatabase,
  email: string
): AuthUserRecord | null {
  const row = database.sqlite
    .prepare(
      "SELECT id, email, password_hash, password_salt, created_at FROM users WHERE email = ?"
    )
    .get(normalizeEmail(email)) as
    | {
        id: string;
        email: string;
        password_hash: string;
        password_salt: string;
        created_at: string;
      }
    | undefined;

  if (row === undefined) {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt,
    createdAt: row.created_at,
  };
}

export function findUserById(
  database: AuthDatabase,
  userId: string
): AuthUserRecord | null {
  const row = database.sqlite
    .prepare(
      "SELECT id, email, password_hash, password_salt, created_at FROM users WHERE id = ?"
    )
    .get(userId) as
    | {
        id: string;
        email: string;
        password_hash: string;
        password_salt: string;
        created_at: string;
      }
    | undefined;

  if (row === undefined) {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt,
    createdAt: row.created_at,
  };
}

export function createUser(
  database: AuthDatabase,
  input: CreateUserInput
): AuthUserRecord {
  const email = assertEmail(input.email);

  if (findUserByEmail(database, email) !== null) {
    throw new AuthError("user_exists", "A user with that email already exists.");
  }

  const user: AuthUserRecord = {
    id: randomUUID(),
    email,
    passwordHash: input.digest.hash,
    passwordSalt: input.digest.salt,
    createdAt: input.now.toISOString(),
  };

  database.sqlite
    .prepare(
      "INSERT INTO users (id, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(user.id, user.email, user.passwordHash, user.passwordSalt, user.createdAt);

  return user;
}
