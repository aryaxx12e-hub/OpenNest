// @vitest-environment node

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createRateLimiter } from "../../http/rate-limit";
import { createRouter } from "../../http/router";
import type { McpAuth, McpCallRecord, McpTokenRecord } from "../auth";
import { registerMcpRoute, MCP_PROTOCOL_VERSION } from "../server";
import { McpToolError, type McpTools } from "../tools";

const NOW = new Date("2026-11-19T08:00:00.000Z");
const WORKSPACE_ID = "workspace-1";
const TOKEN = "onmcp_test_token_value";
const servers: Server[] = [];

interface TestToken extends McpTokenRecord {
  token: string;
  member: boolean;
}

function tokenRecord(overrides: Partial<TestToken> = {}): TestToken {
  return {
    id: "token-1",
    token: TOKEN,
    workspaceId: WORKSPACE_ID,
    name: "Client",
    prefix: "onmcp_test",
    createdBy: "user-1",
    createdAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 86_400_000).toISOString(),
    revokedAt: null,
    lastUsedAt: null,
    member: true,
    ...overrides,
  };
}

async function setup(
  options: {
    tokens?: TestToken[];
    tools?: Partial<McpTools>;
    limit?: number;
    currentWorkspaceId?: string | null;
    now?: Date;
  } = {}
) {
  const tokens = options.tokens ?? [tokenRecord()];
  const calls: McpCallRecord[] = [];
  const used: string[] = [];
  const mcpAuth: Pick<McpAuth, "resolveToken" | "recordUsage" | "recordCall"> = {
    resolveToken(token) {
      const now = options.now ?? NOW;
      const found = tokens.find((candidate) => candidate.token === token);

      if (
        found === undefined ||
        found.revokedAt !== null ||
        found.expiresAt <= now.toISOString()
      ) {
        return null;
      }

      return found;
    },
    recordUsage(tokenId) {
      used.push(tokenId);
    },
    recordCall(call) {
      calls.push(call);
    },
  };
  const call = vi.fn(async (name: string) => ({ value: name }));
  const tools: McpTools = {
    list: () => [
      {
        name: "list_notes",
        description: "List notes",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      },
      {
        name: "read_note",
        description: "Read note",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      },
      {
        name: "search",
        description: "Search",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      },
      {
        name: "list_files",
        description: "List files",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      },
      {
        name: "read_text_file",
        description: "Read file",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      },
    ],
    call,
    ...options.tools,
  };
  const router = createRouter();

  registerMcpRoute(router, {
    mcpAuth,
    tools,
    currentWorkspaceId: async () => options.currentWorkspaceId ?? WORKSPACE_ID,
    isMember: (userId) =>
      tokens.some((candidate) => candidate.createdBy === userId && candidate.member),
    rateLimiter: createRateLimiter({
      limit: options.limit ?? 20,
      windowMs: 60_000,
      now: () => options.now ?? NOW,
    }),
    now: () => options.now ?? NOW,
  });

  const server = createServer((request, response) => {
    void router.handle(request, response);
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;

  return {
    base: `http://127.0.0.1:${address.port}`,
    calls,
    used,
    call,
  };
}

function request(
  base: string,
  body: unknown,
  token: string | null = TOKEN
): Promise<Response> {
  return fetch(`${base}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
}

async function rpc(base: string, body: unknown, token?: string | null) {
  const response = await request(base, body, token);
  return { response, body: (await response.json()) as Record<string, unknown> };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    )
  );
});

describe("MCP HTTP server", () => {
  it("initializes with a pinned protocol and tool capability", async () => {
    const { base } = await setup();
    const result = await rpc(base, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {} },
    });

    expect(result.response.status).toBe(200);
    expect(result.body).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "OpenNest" },
      },
    });
  });

  it("lists the read-only tools and calls one in the token workspace", async () => {
    const { base, call } = await setup();
    const listed = await rpc(base, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    const called = await rpc(base, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "read_note", arguments: { noteId: "note-1" } },
    });

    expect(listed.body).toMatchObject({ result: { tools: expect.any(Array) } });
    expect(called.response.status).toBe(200);
    expect(called.body).toMatchObject({ result: { content: [{ type: "text" }] } });
    expect(call).toHaveBeenCalledWith(
      "read_note",
      { noteId: "note-1" },
      { workspaceId: WORKSPACE_ID }
    );
  });

  it("rejects missing, invalid, revoked, removed-member, and cross-workspace tokens generically", async () => {
    const cases = [
      await setup({ tokens: [] }),
      await setup({ tokens: [tokenRecord({ revokedAt: NOW.toISOString() })] }),
      await setup({ tokens: [tokenRecord({ member: false })] }),
      await setup({ currentWorkspaceId: "workspace-2" }),
    ];

    for (const [index, test] of cases.entries()) {
      const result = await rpc(
        test.base,
        { jsonrpc: "2.0", id: 10, method: "ping" },
        index === 0 ? "onmcp_invalid" : TOKEN
      );

      expect(result.response.status).toBe(401);
      expect(result.body).toEqual({
        error: {
          code: "unauthorized",
          message: "Authentication is required.",
        },
      });
      expect(JSON.stringify(result.body)).not.toContain(TOKEN);
    }
  });

  it("rate-limits per token without leaking the token", async () => {
    const { base } = await setup({ limit: 2 });

    await rpc(base, { jsonrpc: "2.0", id: 1, method: "ping" });
    await rpc(base, { jsonrpc: "2.0", id: 2, method: "ping" });
    const limited = await rpc(base, { jsonrpc: "2.0", id: 3, method: "ping" });

    expect(limited.response.status).toBe(429);
    expect(limited.response.headers.get("retry-after")).toBeDefined();
    expect(JSON.stringify(limited.body)).not.toContain(TOKEN);
  });

  it("caps tool output at 64 KiB and records metadata-only audit", async () => {
    const { base, calls } = await setup({
      tools: {
        list: () => [],
        call: async () => "x".repeat(64 * 1024 + 1),
      },
    });
    const result = await rpc(base, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "read_note", arguments: { noteId: "note-1" } },
    });

    expect(result.response.status).toBe(200);
    expect(result.body).toMatchObject({
      result: {
        isError: true,
        content: [{ type: "text", text: expect.stringContaining("output_too_large") }],
      },
    });
    expect(JSON.stringify(result.body)).not.toContain("xxxxxxxxxx");
    expect(calls).toEqual([
      expect.objectContaining({
        tokenId: "token-1",
        workspaceId: WORKSPACE_ID,
        tool: "read_note",
        result: "failure",
        errorCode: "output_too_large",
      }),
    ]);
  });

  it("returns tool errors as MCP results and audits failures", async () => {
    const { base, calls } = await setup({
      tools: {
        list: () => [],
        call: async () => {
          throw new McpToolError("not_found", "The requested object was not found.");
        },
      },
    });
    const result = await rpc(base, {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "read_note", arguments: { noteId: "missing" } },
    });

    expect(result.body).toMatchObject({
      result: {
        isError: true,
        content: [{ type: "text", text: expect.stringContaining("not_found") }],
      },
    });
    expect(calls[0]).toMatchObject({ result: "failure", errorCode: "not_found" });
  });

  it("handles notifications, unknown methods, and invalid JSON-RPC", async () => {
    const { base } = await setup();
    const initialized = await request(base, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    const unknown = await rpc(base, {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/execute",
    });
    const invalid = await request(base, { jsonrpc: "1.0", id: 8, method: "ping" });

    expect(initialized.status).toBe(202);
    expect(unknown.response.status).toBe(200);
    expect(unknown.body).toMatchObject({ error: { code: -32601 } });
    expect(invalid.status).toBe(400);
  });
});
