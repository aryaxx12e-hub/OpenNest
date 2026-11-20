import type { IncomingMessage, ServerResponse } from "node:http";

import { createRateLimiter, type RateLimiter } from "../http/rate-limit";
import { readJsonBody, sendJson, type Router } from "../http/router";
import type { McpAuth } from "./auth";
import { McpToolError, type McpTools } from "./tools";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MAX_MCP_OUTPUT_BYTES = 64 * 1024;
export const MAX_MCP_REQUEST_BYTES = 64 * 1024;
export const MCP_RATE_LIMIT = 120;
export const MCP_RATE_WINDOW_MS = 60_000;

export interface McpRouteDependencies {
  mcpAuth: Pick<McpAuth, "resolveToken" | "recordUsage" | "recordCall">;
  tools: Pick<McpTools, "list" | "call">;
  currentWorkspaceId: () => Promise<string | null>;
  isMember: (userId: string) => boolean;
  rateLimiter?: RateLimiter;
  now?: () => Date;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

type JsonRpcId = string | number | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;

  if (typeof header !== "string") {
    return null;
  }

  const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim());

  return match?.[1] ?? null;
}

function unauthorized(response: ServerResponse): void {
  response.setHeader("www-authenticate", "Bearer");
  sendJson(response, 401, {
    error: {
      code: "unauthorized",
      message: "Authentication is required.",
    },
  });
}

function parseRpcRequest(value: unknown): JsonRpcRequest | null {
  if (!isRecord(value) || value.jsonrpc !== "2.0" || typeof value.method !== "string") {
    return null;
  }

  const id = value.id;

  if (
    id !== undefined &&
    id !== null &&
    typeof id !== "string" &&
    typeof id !== "number"
  ) {
    return null;
  }

  return {
    jsonrpc: "2.0",
    ...(id === undefined ? {} : { id }),
    method: value.method,
    ...(value.params === undefined ? {} : { params: value.params }),
  };
}

function sendRpcError(
  response: ServerResponse,
  id: JsonRpcId,
  code: number,
  message: string
): void {
  sendJson(response, 200, {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
}

function sendNotification(response: ServerResponse): void {
  response.writeHead(202, {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end();
}

function toolErrorText(code: string, message: string): string {
  return JSON.stringify({ error: { code, message } });
}

function sendToolResult(
  response: ServerResponse,
  id: JsonRpcId,
  payload: unknown,
  isError: boolean
): boolean {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);

  if (Buffer.byteLength(text, "utf8") > MAX_MCP_OUTPUT_BYTES) {
    return false;
  }

  sendJson(response, 200, {
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text }],
      ...(isError ? { isError: true } : {}),
    },
  });

  return true;
}

export function registerMcpRoute(
  router: Router,
  dependencies: McpRouteDependencies
): void {
  const now = dependencies.now ?? (() => new Date());
  const rateLimiter =
    dependencies.rateLimiter ??
    createRateLimiter({
      limit: MCP_RATE_LIMIT,
      windowMs: MCP_RATE_WINDOW_MS,
      now,
    });

  router.post("/api/mcp", async (request, response) => {
    const rawToken = bearerToken(request);

    if (rawToken === null) {
      unauthorized(response);
      return;
    }

    const resolvedAt = now();
    const token = dependencies.mcpAuth.resolveToken(rawToken, resolvedAt);

    if (
      token === null ||
      token.revokedAt !== null ||
      token.expiresAt <= resolvedAt.toISOString() ||
      !dependencies.isMember(token.createdBy)
    ) {
      unauthorized(response);
      return;
    }

    const workspaceId = await dependencies.currentWorkspaceId();

    if (workspaceId === null || token.workspaceId !== workspaceId) {
      unauthorized(response);
      return;
    }

    const limit = rateLimiter.consume(token.id);

    if (!limit.allowed) {
      response.setHeader("retry-after", String(limit.retryAfterSeconds));
      sendJson(response, 429, {
        error: {
          code: "rate_limited",
          message: "Too many MCP requests. Try again later.",
        },
      });
      return;
    }

    const body = await readJsonBody(request, {
      maxBytes: MAX_MCP_REQUEST_BYTES,
    });
    const rpc = parseRpcRequest(body);

    if (rpc === null) {
      sendJson(response, 400, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid Request" },
      });
      return;
    }

    if (rpc.id === undefined) {
      sendNotification(response);
      return;
    }

    dependencies.mcpAuth.recordUsage(token.id, now());

    if (rpc.method === "initialize") {
      sendJson(response, 200, {
        jsonrpc: "2.0",
        id: rpc.id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "OpenNest", version: "0.1.0" },
        },
      });
      return;
    }

    if (rpc.method === "ping") {
      sendJson(response, 200, { jsonrpc: "2.0", id: rpc.id, result: {} });
      return;
    }

    if (rpc.method === "tools/list") {
      sendJson(response, 200, {
        jsonrpc: "2.0",
        id: rpc.id,
        result: { tools: dependencies.tools.list() },
      });
      return;
    }

    if (rpc.method !== "tools/call") {
      sendRpcError(response, rpc.id, -32601, "Method not found");
      return;
    }

    const params = rpc.params;

    if (
      !isRecord(params) ||
      typeof params.name !== "string" ||
      (params.arguments !== undefined && !isRecord(params.arguments))
    ) {
      sendRpcError(response, rpc.id, -32602, "Invalid params");
      return;
    }

    const started = performance.now();
    let payload: unknown;
    let errorCode: string | null = null;

    try {
      payload = await dependencies.tools.call(params.name, params.arguments ?? {}, {
        workspaceId: token.workspaceId,
      });
    } catch (error) {
      if (error instanceof McpToolError) {
        errorCode = error.code;
        payload = toolErrorText(error.code, error.message);
      } else {
        errorCode = "tool_failed";
        payload = toolErrorText("tool_failed", "The tool call failed.");
      }
    }

    const durationMs = Math.max(0, Math.round(performance.now() - started));
    const text = typeof payload === "string" ? payload : JSON.stringify(payload);

    if (Buffer.byteLength(text, "utf8") > MAX_MCP_OUTPUT_BYTES) {
      errorCode = "output_too_large";
      payload = toolErrorText("output_too_large", "The tool output is too large.");

      try {
        dependencies.mcpAuth.recordCall(
          {
            tokenId: token.id,
            workspaceId: token.workspaceId,
            tool: params.name,
            result: "failure",
            durationMs,
            errorCode,
          },
          now()
        );
      } catch {
        errorCode = "tool_failed";
      }

      if (!sendToolResult(response, rpc.id, payload, true)) {
        sendRpcError(response, rpc.id, -32603, "Internal error");
      }
      return;
    }

    try {
      dependencies.mcpAuth.recordCall(
        {
          tokenId: token.id,
          workspaceId: token.workspaceId,
          tool: params.name,
          result: errorCode === null ? "success" : "failure",
          durationMs,
          errorCode,
        },
        now()
      );
    } catch {
      errorCode = "audit_failed";
    }

    if (!sendToolResult(response, rpc.id, payload, errorCode !== null)) {
      sendRpcError(response, rpc.id, -32603, "Internal error");
    }
  });
}
