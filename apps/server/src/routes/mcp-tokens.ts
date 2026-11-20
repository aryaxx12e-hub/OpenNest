import type { IncomingMessage } from "node:http";

import { createAuditLog, type AuditLog } from "../audit/audit-log";
import type { AuthDatabase } from "../auth/auth-db";
import type { McpAuth } from "../mcp/auth";
import { HttpError } from "../errors";
import { roleAllows } from "../http/auth";
import { readJsonBody, sendJson, type Router } from "../http/router";
import { requireCsrf, requireSession, sendNoContent } from "./auth";

const MAX_TOKEN_NAME_LENGTH = 80;

export interface McpTokenRouteDependencies {
  auth: AuthDatabase;
  mcp: McpAuth;
  workspaceId: () => Promise<string | null>;
  audit?: AuditLog;
  now?: () => Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCreateBody(value: unknown): { name: string } | null {
  if (!isRecord(value)) {
    return null;
  }

  for (const key of Object.keys(value)) {
    if (key !== "name") {
      return null;
    }
  }

  if (value.name === undefined) {
    return { name: "MCP client" };
  }

  if (typeof value.name !== "string") {
    return null;
  }

  const name = value.name.trim();

  if (name.length === 0 || name.length > MAX_TOKEN_NAME_LENGTH) {
    return null;
  }

  return { name };
}

function ownerSession(
  request: IncomingMessage,
  dependencies: McpTokenRouteDependencies,
  now: Date
) {
  const session = requireSession(request, dependencies.auth, now);
  requireCsrf(request, session.session);

  if (!roleAllows(session.membership.role, "admin")) {
    throw new HttpError(403, "forbidden", "You are not allowed to perform this action.");
  }

  return session;
}

async function requireWorkspaceId(
  dependencies: McpTokenRouteDependencies
): Promise<string> {
  const workspaceId = await dependencies.workspaceId();

  if (workspaceId === null) {
    throw new HttpError(503, "workspace_unavailable", "The workspace is not available.");
  }

  return workspaceId;
}

export function registerMcpTokenRoutes(
  router: Router,
  dependencies: McpTokenRouteDependencies
): void {
  const audit = dependencies.audit ?? createAuditLog(dependencies.auth);
  const now = dependencies.now ?? (() => new Date());

  router.get("/api/mcp/tokens", async (request, response) => {
    const session = requireSession(request, dependencies.auth, now());

    if (!roleAllows(session.membership.role, "admin")) {
      throw new HttpError(
        403,
        "forbidden",
        "You are not allowed to perform this action."
      );
    }

    const workspaceId = await requireWorkspaceId(dependencies);
    sendJson(response, 200, { tokens: dependencies.mcp.listTokens(workspaceId) });
  });

  router.post("/api/mcp/tokens", async (request, response) => {
    const session = ownerSession(request, dependencies, now());
    const body = parseCreateBody(await readJsonBody(request));

    if (body === null) {
      throw new HttpError(400, "bad_request", "The request body is not valid.");
    }

    const workspaceId = await requireWorkspaceId(dependencies);
    const created = dependencies.mcp.createToken({
      workspaceId,
      createdBy: session.user.id,
      name: body.name,
      now: now(),
    });

    audit.record({
      actorId: session.user.id,
      action: "mcp.token.create",
      targetType: "mcp_token",
      targetId: created.record.id,
      result: "success",
    });

    sendJson(response, 201, created);
  });

  router.delete("/api/mcp/tokens/:tokenId", async (request, response, context) => {
    const session = ownerSession(request, dependencies, now());
    const workspaceId = await requireWorkspaceId(dependencies);
    const tokenId = context.params.tokenId;

    if (tokenId === undefined || tokenId.length === 0) {
      throw new HttpError(404, "not_found", "The MCP token does not exist.");
    }

    if (!dependencies.mcp.revokeToken(workspaceId, tokenId, now())) {
      throw new HttpError(404, "not_found", "The MCP token does not exist.");
    }

    audit.record({
      actorId: session.user.id,
      action: "mcp.token.revoke",
      targetType: "mcp_token",
      targetId: tokenId,
      result: "success",
    });

    sendNoContent(response);
  });
}
