import assert from "node:assert/strict";

import {
  bootstrapOwner,
  expectStatus,
  login,
  makeTempDir,
  removeDir,
  seedWorkspace,
  sessionHeaders,
  startServer,
  unique,
} from "./e2e-harness.mjs";

const PASSWORD = "correct horse battery staple";
const SECRET = "Other workspace secret that must never leak.";

async function mcp(base, token, body) {
  const response = await fetch(`${base}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  return { response, body: await response.json() };
}

async function createToken(base, session) {
  const response = await fetch(`${base}/api/mcp/tokens`, {
    method: "POST",
    headers: sessionHeaders(session),
    body: JSON.stringify({ name: "E2E client" }),
  });

  await expectStatus(response, 201, "create MCP token");

  return response.json();
}

async function run() {
  const dataDir = await makeTempDir("opennest-e2e-mcp-");
  let server = null;

  try {
    const seed = await seedWorkspace(dataDir, {
      workspaceName: "E2E MCP",
      notes: [{ title: "MCP note", content: "Workspace A content." }],
    });
    const noteId = seed.notes[0]?.id;
    const email = unique("owner") + "@example.com";

    assert.ok(noteId, "seed note is missing");

    await bootstrapOwner(dataDir, email, PASSWORD);
    server = await startServer({ dataDir, mcpEnabled: true });
    const owner = await login(server.base, email, PASSWORD);
    const listed = await fetch(`${server.base}/api/mcp/tokens`, {
      headers: { cookie: owner.cookie },
    });

    await expectStatus(listed, 200, "list MCP tokens");
    assert.deepEqual((await listed.json()).tokens, []);

    const created = await createToken(server.base, owner);

    assert.match(created.token, /^onmcp_/);
    assert.ok(!JSON.stringify(created.record).includes(created.token));

    const initialized = await mcp(server.base, created.token, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {} },
    });

    assert.equal(initialized.response.status, 200);
    assert.equal(initialized.body.result.protocolVersion, "2025-06-18");

    const tools = await mcp(server.base, created.token, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });

    assert.equal(tools.body.result.tools.length, 5);

    const note = await mcp(server.base, created.token, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "read_note", arguments: { noteId } },
    });
    const payload = JSON.parse(note.body.result.content[0].text);

    assert.equal(payload.content, "Workspace A content.");

    await server.stop();
    server = null;

    const expanded = await seedWorkspace(dataDir, {
      extraWorkspaces: [
        {
          name: "Other workspace",
          notes: [{ title: "Other note", content: SECRET }],
        },
      ],
    });
    const otherNoteId = expanded.extraWorkspaces[0]?.notes[0]?.id;

    assert.ok(otherNoteId, "other workspace note is missing");

    server = await startServer({ dataDir, mcpEnabled: true });

    const denied = await mcp(server.base, created.token, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "read_note", arguments: { noteId: otherNoteId } },
    });
    const serialized = JSON.stringify(denied.body);

    assert.equal(denied.response.status, 401);
    assert.equal(denied.body.error.code, "unauthorized");
    assert.ok(!serialized.includes(SECRET));
    assert.ok(!serialized.includes(otherNoteId));

    console.log(
      "PASS MCP E2E: owner token, read-only tools, workspace-scoped read, cross-workspace denial"
    );
  } finally {
    await server?.stop();
    await removeDir(dataDir);
  }
}

await run();
