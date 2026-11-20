import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

import {
  bootstrapOwner,
  expectStatus,
  invite,
  login,
  makeTempDir,
  removeDir,
  seedWorkspace,
  sessionHeaders,
  startServer,
  unique,
} from "./e2e-harness.mjs";

const PASSWORD = "correct horse battery staple";

function canonicalize(value) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }

  throw new TypeError(`Cannot canonicalize ${typeof value}.`);
}

function payloadHash(envelope) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(envelope)))
    .digest("hex");
}

function operation(workspaceId, overrides = {}) {
  const opId = overrides.opId ?? randomUUID();
  const entityId = overrides.entityId ?? randomUUID();
  const entityType = overrides.entityType ?? "note";
  const operationType = overrides.operation ?? "create";
  const fieldPatches = overrides.fieldPatches ?? { title: "Seed", content: "" };

  return {
    opId,
    entityType,
    entityId,
    operation: operationType,
    baseEntityRevision: overrides.baseEntityRevision ?? 0,
    baseWorkspaceRevision: overrides.baseWorkspaceRevision ?? 0,
    fieldPatches,
    payloadHash: payloadHash({
      opId,
      workspaceId,
      entityType,
      entityId,
      operation: operationType,
      fieldPatches,
    }),
    deviceId: overrides.deviceId ?? randomUUID(),
    localSequence: overrides.localSequence ?? 1,
    createdAt: new Date().toISOString(),
  };
}

async function push(base, session, workspaceId, operations) {
  const response = await fetch(`${base}/api/sync/push`, {
    method: "POST",
    headers: sessionHeaders(session),
    body: JSON.stringify({
      protocolVersion: 1,
      workspaceId,
      operations,
    }),
  });

  await expectStatus(response, 200, "sync push");

  return response.json();
}

async function pull(base, session, workspaceId) {
  const response = await fetch(`${base}/api/sync/pull`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: session.cookie },
    body: JSON.stringify({
      protocolVersion: 1,
      workspaceId,
      cursor: null,
      limit: 100,
    }),
  });

  await expectStatus(response, 200, "sync pull");

  return response.json();
}

function uploadForm(name, mimeType, data, fields = {}) {
  const form = new FormData();

  form.set("file", new File([data], name, { type: mimeType }), name);

  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }

  return form;
}

async function upload(base, session, form) {
  return fetch(`${base}/api/files`, {
    method: "POST",
    headers: {
      cookie: session.cookie,
      "x-csrf-token": session.csrfToken,
    },
    body: form,
  });
}

async function run() {
  const dataDir = await makeTempDir("opennest-e2e-sync-");
  let server = null;

  try {
    const seed = await seedWorkspace(dataDir, {
      workspaceName: "E2E sync",
      notes: [{ title: "Seeded note", content: "Seed content" }],
    });
    const email = unique("owner") + "@example.com";

    await bootstrapOwner(dataDir, email, PASSWORD);
    server = await startServer({ dataDir });
    const owner = await login(server.base, email, PASSWORD);
    const editor = await invite(
      server.base,
      owner,
      `${unique("editor")}@example.com`,
      "editor",
      PASSWORD
    );
    const viewer = await invite(
      server.base,
      owner,
      `${unique("viewer")}@example.com`,
      "viewer",
      PASSWORD
    );

    const noteId = randomUUID();
    const create = operation(seed.workspaceId, {
      entityId: noteId,
      fieldPatches: { title: "Shared note", content: "Initial body" },
    });
    const created = await push(server.base, owner, seed.workspaceId, [create]);

    assert.equal(created.applied[0]?.canonicalRevision, 1);
    assert.deepEqual(created.conflicts, []);

    const viewerPush = await fetch(`${server.base}/api/sync/push`, {
      method: "POST",
      headers: sessionHeaders(viewer),
      body: JSON.stringify({
        protocolVersion: 1,
        workspaceId: seed.workspaceId,
        operations: [operation(seed.workspaceId)],
      }),
    });

    await expectStatus(viewerPush, 403, "viewer sync push");
    assert.equal((await viewerPush.json()).error.code, "forbidden");

    const viewerPull = await pull(server.base, viewer, seed.workspaceId);

    assert.ok(viewerPull.operations.some((item) => item.opId === create.opId));

    const offline = operation(seed.workspaceId, {
      entityId: noteId,
      operation: "update",
      baseEntityRevision: 1,
      fieldPatches: { title: "Offline title" },
      deviceId: randomUUID(),
    });
    const online = operation(seed.workspaceId, {
      entityId: noteId,
      operation: "update",
      baseEntityRevision: 1,
      fieldPatches: { title: "Online title" },
      deviceId: randomUUID(),
      localSequence: 2,
    });

    await push(server.base, owner, seed.workspaceId, [offline]);
    const conflict = await push(server.base, editor, seed.workspaceId, [online]);

    assert.equal(conflict.conflicts.length, 1);
    assert.deepEqual(
      {
        fieldPath: conflict.conflicts[0]?.fieldPath,
        localValue: conflict.conflicts[0]?.localValue,
        remoteValue: conflict.conflicts[0]?.remoteValue,
      },
      { fieldPath: "title", localValue: "Offline title", remoteValue: "Online title" }
    );

    const first = await upload(
      server.base,
      owner,
      uploadForm("offline.txt", "text/plain", new TextEncoder().encode("base"))
    );

    await expectStatus(first, 201, "first upload");
    const firstBody = await first.json();
    const updated = await upload(
      server.base,
      owner,
      uploadForm("offline.txt", "text/plain", new TextEncoder().encode("new"), {
        fileId: firstBody.file.id,
        baseVersionId: firstBody.version.id,
      })
    );

    await expectStatus(updated, 201, "update upload");

    const stale = await upload(
      server.base,
      owner,
      uploadForm("offline.txt", "text/plain", new TextEncoder().encode("stale"), {
        fileId: firstBody.file.id,
        baseVersionId: firstBody.version.id,
      })
    );

    await expectStatus(stale, 201, "conflict upload");
    const staleBody = await stale.json();

    assert.equal(staleBody.conflict, true);
    assert.equal(staleBody.conflictOf, firstBody.file.id);
    assert.match(staleBody.file.name, /\(conflict copy\)/);

    const viewerUpload = await upload(
      server.base,
      viewer,
      uploadForm("viewer.txt", "text/plain", new TextEncoder().encode("no"))
    );

    await expectStatus(viewerUpload, 403, "viewer upload");

    console.log("PASS sync E2E: viewer read-only, sync conflict, file conflict copy");
  } finally {
    await server?.stop();
    await removeDir(dataDir);
  }
}

await run();
