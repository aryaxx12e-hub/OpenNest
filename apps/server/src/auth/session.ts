import { createHash, randomBytes, randomUUID } from "node:crypto";

import { findUserById, type AuthDatabase } from "./auth-db";
import { AuthError } from "./errors";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_TOKEN_BYTES = 32;

export interface SessionRecord {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  csrfHash: string | null;
}

export interface CreatedSession {
  token: string;
  session: SessionRecord;
}

interface SessionRow {
  id: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  csrf_hash: string | null;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function toSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    csrfHash: row.csrf_hash,
  };
}

export function createSession(
  database: AuthDatabase,
  userId: string,
  now: Date = new Date()
): CreatedSession {
  if (findUserById(database, userId) === null) {
    throw new AuthError("not_found", "The user does not exist.");
  }

  const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
  const session: SessionRecord = {
    id: randomUUID(),
    userId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    revokedAt: null,
    csrfHash: null,
  };

  database.sqlite
    .prepare(
      "INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(
      session.id,
      session.userId,
      sha256Hex(token),
      session.createdAt,
      session.expiresAt
    );

  return { token, session };
}

export function verifySession(
  database: AuthDatabase,
  token: string,
  now: Date = new Date()
): SessionRecord | null {
  if (token.length === 0) {
    return null;
  }

  const row = database.sqlite
    .prepare(
      "SELECT id, user_id, created_at, expires_at, revoked_at, csrf_hash FROM sessions WHERE token_hash = ?"
    )
    .get(sha256Hex(token)) as SessionRow | undefined;

  if (row === undefined || row.revoked_at !== null) {
    return null;
  }

  if (row.expires_at <= now.toISOString()) {
    return null;
  }

  return toSession(row);
}

export function revokeSession(
  database: AuthDatabase,
  token: string,
  now: Date = new Date()
): boolean {
  if (token.length === 0) {
    return false;
  }

  const result = database.sqlite
    .prepare(
      "UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL"
    )
    .run(now.toISOString(), sha256Hex(token));

  return Number(result.changes) > 0;
}

export function revokeUserSessions(
  database: AuthDatabase,
  userId: string,
  now: Date = new Date()
): number {
  const result = database.sqlite
    .prepare(
      "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL"
    )
    .run(now.toISOString(), userId);

  return Number(result.changes);
}

export function setSessionCsrf(
  database: AuthDatabase,
  sessionId: string,
  csrfHash: string
): void {
  database.sqlite
    .prepare("UPDATE sessions SET csrf_hash = ? WHERE id = ?")
    .run(csrfHash, sessionId);
}
