// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openAuthDatabase, createUser, type AuthDatabase } from "../../auth/auth-db";
import { openMcpAuth, type McpAuth } from "../auth";

const NOW = new Date("2026-11-19T08:00:00.000Z");
const WORKSPACE_ID = "workspace-1";
const OTHER_WORKSPACE_ID = "workspace-2";
const roots: string[] = [];
const databases: AuthDatabase[] = [];

async function setup(): Promise<{ auth: AuthDatabase; mcp: McpAuth; userId: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "opennest-mcp-auth-"));
  roots.push(root);
  const auth = openAuthDatabase({ databaseFile: path.join(root, "auth.sqlite") });
  databases.push(auth);
  const user = createUser(auth, {
    email: "owner@example.com",
    digest: { hash: "a".repeat(64), salt: "b".repeat(32) },
    now: NOW,
  });
  const mcp = openMcpAuth(auth);

  return { auth, mcp, userId: user.id };
}

afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
  }

  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("MCP tokens", () => {
  it("creates a token once and stores only its hash and prefix", async () => {
    const { auth, mcp, userId } = await setup();
    const created = mcp.createToken({
      workspaceId: WORKSPACE_ID,
      createdBy: userId,
      name: "Laptop client",
      now: NOW,
    });

    expect(created.token).toMatch(/^onmcp_[A-Za-z0-9_-]{32,}$/);
    expect(created.record).toMatchObject({
      workspaceId: WORKSPACE_ID,
      name: "Laptop client",
      createdBy: userId,
    });
    expect(JSON.stringify(created.record)).not.toContain(created.token);

    const row = auth.sqlite
      .prepare("SELECT token_hash, token_prefix FROM mcp_tokens WHERE id = ?")
      .get(created.record.id) as { token_hash: string; token_prefix: string };

    expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.token_hash).not.toContain(created.token);
    expect(created.token.startsWith(row.token_prefix)).toBe(true);
    expect(mcp.listTokens(WORKSPACE_ID)).toEqual([created.record]);
  });

  it("resolves a live token and refuses missing, revoked, expired, and wrong-workspace tokens", async () => {
    const { mcp, userId } = await setup();
    const created = mcp.createToken({
      workspaceId: WORKSPACE_ID,
      createdBy: userId,
      now: NOW,
      ttlMs: 24 * 60 * 60 * 1000,
    });

    expect(mcp.resolveToken(created.token, NOW)).toMatchObject({
      id: created.record.id,
      workspaceId: WORKSPACE_ID,
    });
    expect(mcp.resolveToken("onmcp_missing", NOW)).toBeNull();
    expect(
      mcp.resolveToken(created.token, new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1000))
    ).toBeNull();

    expect(mcp.revokeToken(OTHER_WORKSPACE_ID, created.record.id, NOW)).toBe(false);
    expect(mcp.revokeToken(WORKSPACE_ID, created.record.id, NOW)).toBe(true);
    expect(mcp.resolveToken(created.token, NOW)).toBeNull();
    expect(mcp.revokeToken(WORKSPACE_ID, created.record.id, NOW)).toBe(false);
  });

  it("records token usage and content-free call audit records", async () => {
    const { auth, mcp, userId } = await setup();
    const created = mcp.createToken({
      workspaceId: WORKSPACE_ID,
      createdBy: userId,
      now: NOW,
    });

    mcp.recordUsage(created.record.id, new Date(NOW.getTime() + 1_000));
    mcp.recordCall(
      {
        tokenId: created.record.id,
        workspaceId: WORKSPACE_ID,
        tool: "read_note",
        result: "success",
        durationMs: 12,
        errorCode: null,
      },
      NOW
    );

    expect(mcp.resolveToken(created.token, NOW)?.lastUsedAt).toBe(
      new Date(NOW.getTime() + 1_000).toISOString()
    );

    const rows = auth.sqlite
      .prepare(
        "SELECT token_id, workspace_id, tool, result, duration_ms, error_code FROM mcp_audit"
      )
      .all() as Array<Record<string, unknown>>;

    expect(rows).toEqual([
      {
        token_id: created.record.id,
        workspace_id: WORKSPACE_ID,
        tool: "read_note",
        result: "success",
        duration_ms: 12,
        error_code: null,
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain(created.token);
  });
});
