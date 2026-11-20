import assert from "node:assert/strict";

import { WebSocket } from "ws";
import * as Y from "yjs";

import {
  bootstrapOwner,
  delay,
  invite,
  login,
  makeTempDir,
  removeDir,
  seedWorkspace,
  startServer,
  unique,
  waitFor,
} from "./e2e-harness.mjs";

const PASSWORD = "correct horse battery staple";
const TEXT_KEY = "markdown";

function collaborationUrl(base, noteId) {
  return `${base.replace(/^http/, "ws")}/api/collaboration?noteId=${encodeURIComponent(noteId)}`;
}

function createClient({ base, noteId, cookie, label }) {
  const document = new Y.Doc();
  const pending = [];
  const errors = [];
  const messages = [];
  let socket = null;
  let ready = false;
  let presence = [];

  document.on("update", (update, origin) => {
    if (origin === "remote") {
      return;
    }

    if (socket !== null && socket.readyState === WebSocket.OPEN && ready) {
      socket.send(update);
    } else {
      pending.push(update);
    }
  });

  async function connect() {
    socket = new WebSocket(collaborationUrl(base, noteId), {
      origin: base,
      headers: { cookie },
    });
    ready = false;

    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        Y.applyUpdate(document, new Uint8Array(data), "remote");
        return;
      }

      const message = JSON.parse(data.toString());

      messages.push(message);

      if (message.type === "ready") {
        ready = true;
        return;
      }

      if (message.type === "presence") {
        presence = message.participants;
        return;
      }

      if (message.type === "error") {
        errors.push(message.code);
      }
    });
    socket.on("close", () => {
      ready = false;
    });

    await waitFor(() => ready, `${label} ready`);

    if (pending.length > 0) {
      const queued = pending.splice(0);

      for (const update of queued) {
        socket.send(update);
      }
    }
  }

  return {
    document,
    errors,
    messages,
    get presence() {
      return presence;
    },
    get ready() {
      return ready;
    },
    connect,
    edit(callback) {
      callback(document.getText(TEXT_KEY));
    },
    text() {
      return document.getText(TEXT_KEY).toString();
    },
    close() {
      socket?.close();
      socket = null;
      ready = false;
    },
  };
}

async function run() {
  const dataDir = await makeTempDir("opennest-e2e-collaboration-");
  let server = null;

  try {
    const seed = await seedWorkspace(dataDir, {
      workspaceName: "E2E collaboration",
      notes: [{ title: "Live note", content: "Hello" }],
    });
    const noteId = seed.notes[0]?.id;
    const email = unique("owner") + "@example.com";

    assert.ok(noteId, "seed note is missing");

    await bootstrapOwner(dataDir, email, PASSWORD);
    server = await startServer({ dataDir });
    const ownerSession = await login(server.base, email, PASSWORD);
    const editorSession = await invite(
      server.base,
      ownerSession,
      `${unique("editor")}@example.com`,
      "editor",
      PASSWORD
    );
    const viewerSession = await invite(
      server.base,
      ownerSession,
      `${unique("viewer")}@example.com`,
      "viewer",
      PASSWORD
    );

    const owner = createClient({
      base: server.base,
      noteId,
      cookie: ownerSession.cookie,
      label: "owner",
    });
    const editor = createClient({
      base: server.base,
      noteId,
      cookie: editorSession.cookie,
      label: "editor",
    });

    await owner.connect();
    await editor.connect();

    await waitFor(() => owner.presence.length === 2, "owner sees editor presence");
    await waitFor(() => editor.presence.length === 2, "editor sees owner presence");
    assert.ok(editor.messages.some((message) => message.type === "ready"));

    editor.edit((text) => text.insert(text.length, " from editor"));
    await waitFor(
      () => owner.text() === "Hello from editor",
      "owner receives the editor update"
    );

    owner.edit((text) => text.insert(text.length, " from owner"));
    await waitFor(
      () => editor.text() === "Hello from editor from owner",
      "editor receives the owner update"
    );

    editor.close();
    await waitFor(() => owner.presence.length === 1, "owner sees editor leave");

    editor.edit((text) => text.insert(text.length, " offline"));
    await delay(100);
    assert.ok(!owner.text().includes("offline"));

    await editor.connect();
    await waitFor(() => owner.presence.length === 2, "owner sees editor reconnect");
    await waitFor(
      () => owner.text() === "Hello from editor from owner offline",
      "owner receives the reconnected offline update"
    );
    assert.equal(editor.text(), "Hello from editor from owner offline");

    const viewer = createClient({
      base: server.base,
      noteId,
      cookie: viewerSession.cookie,
      label: "viewer",
    });

    await viewer.connect();
    assert.ok(
      viewer.messages.some(
        (message) => message.type === "ready" && message.readOnly === true
      )
    );
    const beforeWrite = owner.text();

    viewer.edit((text) => text.insert(0, "hacked "));
    await waitFor(() => viewer.errors.includes("forbidden"), "viewer write rejection");
    await delay(100);
    assert.equal(owner.text(), beforeWrite);
    assert.ok(!owner.text().includes("hacked"));

    owner.close();
    editor.close();
    viewer.close();

    console.log(
      "PASS collaboration E2E: two editors, presence, reconnect, offline update, viewer denial"
    );
  } finally {
    await server?.stop();
    await removeDir(dataDir);
  }
}

await run();
