import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { AuthDatabase } from "../auth/auth-db";
import { sha256Hex } from "../auth/session";

export const MCP_TOKEN_PREFIX = "onmcp_";
export const MCP_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;
const MAX_TOKEN_LENGTH = 256;
const MAX_NAME_LENGTH = 80;

const SCHEMA = readFileSync(
  fileURLToPath(new URL("./schema.sql", import.meta.url)),
  "utf8"
);

export interface McpTokenRecord {
  id: string;
  workspaceId: string;
  name: string;
  prefix: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

export interface CreatedMcpToken {
  token: string;
  record: McpTokenRecord;
}

export interface McpCallRecord {
  tokenId: string;
  workspaceId: string;
  tool: string;
  result: "success" | "failure";
  durationMs: number;
  errorCode: string | null;
}

export interface McpAuth {
  createToken(input: {
    workspaceId: string;
    createdBy: string;
    name?: string;
    now?: Date;
    ttlMs?: number;
  }): CreatedMcpToken;
  listTokens(workspaceId: string): McpTokenRecord[];
  revokeToken(workspaceId: string, tokenId: string, now?: Date): boolean;
  resolveToken(token: string, now?: Date): McpTokenRecord | null;
  recordUsage(tokenId: string, now?: Date): void;
  recordCall(call: McpCallRecord, now?: Date): void;
}

interface TokenRow {
  id: string;
  workspace_id: string;
  name: string;
  token_prefix: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
}

function toRecord(row: TokenRow): McpTokenRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    prefix: row.token_prefix,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
  };
}

function validName(value: string | undefined): string {
  const name = (value ?? "MCP client").trim();

  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    throw new Error("The MCP token name is not valid.");
  }

  return name;
}

export function openMcpAuth(database: AuthDatabase): McpAuth {
  database.sqlite.exec(SCHEMA);

  return {
    createToken(input) {
      const now = input.now ?? new Date();
      const ttlMs = input.ttlMs ?? MCP_TOKEN_TTL_MS;

      if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) {
        throw new Error("The MCP token lifetime is not valid.");
      }

      const token = `${MCP_TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
      const record: McpTokenRecord = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        name: validName(input.name),
        prefix: token.slice(0, MCP_TOKEN_PREFIX.length + 10),
        createdBy: input.createdBy,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
        revokedAt: null,
        lastUsedAt: null,
      };

      database.sqlite
        .prepare(
          "INSERT INTO mcp_tokens (id, workspace_id, name, token_hash, token_prefix, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          record.id,
          record.workspaceId,
          record.name,
          sha256Hex(token),
          record.prefix,
          record.createdBy,
          record.createdAt,
          record.expiresAt
        );

      return { token, record };
    },

    listTokens(workspaceId) {
      const rows = database.sqlite
        .prepare(
          "SELECT id, workspace_id, name, token_prefix, created_by, created_at, expires_at, revoked_at, last_used_at FROM mcp_tokens WHERE workspace_id = ? ORDER BY created_at, rowid"
        )
        .all(workspaceId) as unknown as TokenRow[];

      return rows.map(toRecord);
    },

    revokeToken(workspaceId, tokenId, now = new Date()) {
      const result = database.sqlite
        .prepare(
          "UPDATE mcp_tokens SET revoked_at = ? WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL"
        )
        .run(now.toISOString(), tokenId, workspaceId);

      return Number(result.changes) > 0;
    },

    resolveToken(token, now = new Date()) {
      if (token.length < MCP_TOKEN_PREFIX.length || token.length > MAX_TOKEN_LENGTH) {
        return null;
      }

      const row = database.sqlite
        .prepare(
          "SELECT id, workspace_id, name, token_prefix, created_by, created_at, expires_at, revoked_at, last_used_at FROM mcp_tokens WHERE token_hash = ?"
        )
        .get(sha256Hex(token)) as TokenRow | undefined;

      if (row === undefined || row.revoked_at !== null) {
        return null;
      }

      if (row.expires_at <= now.toISOString()) {
        return null;
      }

      return toRecord(row);
    },

    recordUsage(tokenId, now = new Date()) {
      database.sqlite
        .prepare("UPDATE mcp_tokens SET last_used_at = ? WHERE id = ?")
        .run(now.toISOString(), tokenId);
    },

    recordCall(call, now = new Date()) {
      database.sqlite
        .prepare(
          "INSERT INTO mcp_audit (id, token_id, workspace_id, tool, result, duration_ms, error_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          randomUUID(),
          call.tokenId,
          call.workspaceId,
          call.tool,
          call.result,
          call.durationMs,
          call.errorCode,
          now.toISOString()
        );
    },
  };
}
