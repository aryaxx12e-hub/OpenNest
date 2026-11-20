// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openAuthDatabase, type AuthDatabase } from "../../auth/auth-db";
import { createAuditLog, type AuditEntry } from "../audit-log";

const NOW = new Date("2026-11-18T10:00:00.000Z");
const roots: string[] = [];
const databases: AuthDatabase[] = [];

async function makeDatabase(): Promise<AuthDatabase> {
  const root = await mkdtemp(path.join(tmpdir(), "opennest-audit-"));
  roots.push(root);
  const database = openAuthDatabase({
    databaseFile: path.join(root, "auth.sqlite"),
  });
  databases.push(database);
  return database;
}

afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
  }
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("audit log", () => {
  it("records actor, action, target, result, and timestamp", async () => {
    const database = await makeDatabase();
    const audit = createAuditLog(database);

    const first = audit.record(
      {
        actorId: "user-1",
        action: "member.invite",
        targetType: "invite",
        targetId: "invite-1",
        result: "success",
      },
      NOW
    );
    const second = audit.record(
      {
        actorId: null,
        action: "auth.login",
        targetType: "session",
        targetId: null,
        result: "failure",
      },
      new Date(NOW.getTime() + 1000)
    );

    expect(first.createdAt).toBe(NOW.toISOString());
    expect(second.createdAt).toBe(new Date(NOW.getTime() + 1000).toISOString());
    expect(audit.list()).toEqual([first, second]);
  });

  it("stores only the fixed metadata fields and drops extra content", async () => {
    const database = await makeDatabase();
    const audit = createAuditLog(database);
    const noteText = "private note text";
    const fileBytes = "raw-file-bytes";
    const password = "secret-password";
    const token = "session-token";
    const aiContent = "private AI content";
    const entry = {
      actorId: "user-1",
      action: "member.revoke",
      targetType: "member",
      targetId: "user-2",
      result: "success",
      noteText,
      fileBytes,
      password,
      token,
      aiContent,
    } as unknown as AuditEntry;

    audit.record(entry, NOW);

    const raw = JSON.stringify(database.sqlite.prepare("SELECT * FROM audit_log").all());

    expect(raw).toContain("member.revoke");
    expect(raw).not.toContain(noteText);
    expect(raw).not.toContain(fileBytes);
    expect(raw).not.toContain(password);
    expect(raw).not.toContain(token);
    expect(raw).not.toContain(aiContent);
  });

  it("is idempotent when initialized again", async () => {
    const database = await makeDatabase();
    const first = createAuditLog(database);
    const second = createAuditLog(database);

    first.record(
      {
        actorId: "user-1",
        action: "bootstrap.owner",
        targetType: "member",
        targetId: "user-1",
        result: "success",
      },
      NOW
    );

    expect(second.list()).toHaveLength(1);
  });
});
