// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openAuthDatabase, type AuthDatabase } from "../auth-db";
import { bootstrapOwner } from "../membership";
import {
  SESSION_TTL_MS,
  createSession,
  revokeSession,
  revokeUserSessions,
  sha256Hex,
  verifySession,
} from "../session";

const NOW = new Date("2026-11-18T10:00:00.000Z");
const roots: string[] = [];
const databases: AuthDatabase[] = [];

async function makeDatabase(): Promise<AuthDatabase> {
  const root = await mkdtemp(path.join(tmpdir(), "opennest-auth-session-"));
  roots.push(root);
  const database = openAuthDatabase({
    databaseFile: path.join(root, "auth.sqlite"),
  });
  databases.push(database);
  return database;
}

async function makeOwner(database: AuthDatabase): Promise<string> {
  const owner = await bootstrapOwner(
    database,
    {
      email: "owner@example.com",
      password: "correct horse battery staple",
    },
    NOW
  );

  return owner.user.id;
}

afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
  }
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("sessions", () => {
  it("creates a 32-byte token and stores only its SHA-256 hash", async () => {
    const database = await makeDatabase();
    const userId = await makeOwner(database);

    const { token, session } = createSession(database, userId, NOW);

    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(session.userId).toBe(userId);
    expect(session.expiresAt).toBe(
      new Date(NOW.getTime() + SESSION_TTL_MS).toISOString()
    );

    const row = database.sqlite
      .prepare("SELECT token_hash FROM sessions WHERE id = ?")
      .get(session.id) as { token_hash?: string } | undefined;

    expect(row?.token_hash).toBe(sha256Hex(token));
    expect(row?.token_hash).not.toBe(token);
    expect(
      JSON.stringify(database.sqlite.prepare("SELECT * FROM sessions").all())
    ).not.toContain(token);
  });

  it("verifies a live session and rejects unknown tokens", async () => {
    const database = await makeDatabase();
    const userId = await makeOwner(database);
    const { token } = createSession(database, userId, NOW);

    expect(verifySession(database, token, new Date(NOW.getTime() + 1000))).toMatchObject({
      userId,
    });
    expect(verifySession(database, "unknown-token", NOW)).toBeNull();
  });

  it("rejects expired sessions", async () => {
    const database = await makeDatabase();
    const userId = await makeOwner(database);
    const { token } = createSession(database, userId, NOW);

    expect(
      verifySession(database, token, new Date(NOW.getTime() + SESSION_TTL_MS))
    ).toBeNull();
    expect(
      verifySession(database, token, new Date(NOW.getTime() + SESSION_TTL_MS - 1))
    ).not.toBeNull();
  });

  it("rejects revoked sessions and revokes every active session for a user", async () => {
    const database = await makeDatabase();
    const userId = await makeOwner(database);
    const first = createSession(database, userId, NOW);
    const second = createSession(database, userId, NOW);

    expect(revokeSession(database, first.token, NOW)).toBe(true);
    expect(revokeSession(database, first.token, NOW)).toBe(false);
    expect(verifySession(database, first.token, NOW)).toBeNull();
    expect(verifySession(database, second.token, NOW)).not.toBeNull();

    expect(revokeUserSessions(database, userId, NOW)).toBe(1);
    expect(verifySession(database, second.token, NOW)).toBeNull();
  });

  it("never puts a token in an error string", async () => {
    const database = await makeDatabase();
    const userId = await makeOwner(database);
    const { token } = createSession(database, userId, NOW);
    let message = "";

    try {
      verifySession(database, token, new Date(NOW.getTime() + SESSION_TTL_MS));
    } catch (error) {
      message = String(error);
    }

    expect(message).not.toContain(token);
  });
});
