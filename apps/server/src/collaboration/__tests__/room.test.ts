// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import type { CollaborationStore, CollaborationSnapshot } from "@opennest/core";
import {
  createCollaborationDocument,
  encodeDocumentState,
} from "@opennest/collaboration";
import { afterEach, describe, expect, it } from "vitest";

import { openAuthDatabase, type AuthDatabase } from "../../auth/auth-db";
import { bootstrapOwner } from "../../auth/membership";
import { createSession } from "../../auth/session";
import { authenticateCollaborationHandshake, CollaborationAuthError } from "../auth";
import {
  CollaborationRoom,
  type CollaborationConnection,
  type CollaborationMember,
} from "../room";

const NOW = new Date("2026-11-19T12:00:00.000Z");
const PUBLIC_URL = "https://notes.example.com";
const WORKSPACE_ID = "workspace-a";
const NOTE_ID = "note-1";

class TestConnection implements CollaborationConnection {
  readonly id: string;
  readonly messages: Array<Uint8Array | string> = [];
  closed = false;

  constructor(id: string) {
    this.id = id;
  }

  send(message: Uint8Array | string): void {
    this.messages.push(message);
  }

  close(): void {
    this.closed = true;
  }
}

class TestStore implements CollaborationStore {
  snapshot: CollaborationSnapshot | null;
  readonly writes: Array<{
    noteId: string;
    state: { content: string; updatedAt: string };
    metadata: { workspaceId: string; at: string };
  }> = [];
  failWrites = false;

  constructor(snapshot: CollaborationSnapshot | null = snapshotFor(WORKSPACE_ID)) {
    this.snapshot = snapshot;
  }

  async loadSnapshot(noteId: string): Promise<CollaborationSnapshot | null> {
    return this.snapshot?.noteId === noteId ? { ...this.snapshot } : null;
  }

  async writeSnapshot(
    noteId: string,
    state: { content: string; updatedAt: string },
    metadata: { workspaceId: string; at: string }
  ): Promise<void> {
    if (this.failWrites) {
      throw new Error("snapshot failed");
    }

    this.writes.push({ noteId, state, metadata });
    this.snapshot = {
      noteId: noteId as CollaborationSnapshot["noteId"],
      workspaceId: metadata.workspaceId as CollaborationSnapshot["workspaceId"],
      content: state.content,
      updatedAt: state.updatedAt as CollaborationSnapshot["updatedAt"],
    };
  }
}

function snapshotFor(workspaceId: string): CollaborationSnapshot {
  return {
    noteId: NOTE_ID as CollaborationSnapshot["noteId"],
    workspaceId: workspaceId as CollaborationSnapshot["workspaceId"],
    content: "Hello",
    updatedAt: NOW.toISOString() as CollaborationSnapshot["updatedAt"],
  };
}

function member(
  role: "owner" | "editor" | "viewer",
  connection: CollaborationConnection
): CollaborationMember {
  return {
    userId: "user-1",
    displayName: "Editor",
    role,
    connection,
  };
}

async function openRoom(
  store = new TestStore(),
  options: { snapshotIntervalMs?: number; maxUpdatesPerMinute?: number } = {}
): Promise<CollaborationRoom> {
  const room = new CollaborationRoom({
    workspaceId: WORKSPACE_ID,
    noteId: NOTE_ID,
    store,
    now: () => NOW,
    snapshotIntervalMs: options.snapshotIntervalMs ?? 60_000,
    maxUpdatesPerMinute: options.maxUpdatesPerMinute,
  });

  await room.open();

  return room;
}

function updateWith(text: string): Uint8Array {
  const document = createCollaborationDocument("Hello");
  document.getText("markdown").insert(5, text);

  return encodeDocumentState(document);
}

function authRequest(options: {
  cookie?: string;
  origin?: string;
  url?: string;
}): IncomingMessage {
  return {
    headers: {
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
      ...(options.origin === undefined ? {} : { origin: options.origin }),
    },
    url: options.url ?? "/api/collaboration?noteId=note-1",
  } as IncomingMessage;
}

const roots: string[] = [];
const auths: AuthDatabase[] = [];

async function authFixture(): Promise<{
  auth: AuthDatabase;
  token: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "opennest-collaboration-"));
  roots.push(root);
  const auth = openAuthDatabase({
    databaseFile: path.join(root, "auth.sqlite"),
  });
  auths.push(auth);
  const { user } = await bootstrapOwner(
    auth,
    {
      email: "owner@example.com",
      password: "correct horse battery staple",
    },
    NOW
  );
  const session = createSession(auth, user.id, NOW);

  return { auth, token: session.token };
}

afterEach(async () => {
  for (const auth of auths.splice(0)) {
    auth.close();
  }

  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("collaboration handshake", () => {
  it("rejects an unauthenticated handshake", async () => {
    const { auth } = await authFixture();

    expect(() =>
      authenticateCollaborationHandshake(authRequest({ origin: PUBLIC_URL }), {
        auth,
        publicUrl: PUBLIC_URL,
        now: () => NOW,
      })
    ).toThrowError(CollaborationAuthError);

    try {
      authenticateCollaborationHandshake(authRequest({ origin: PUBLIC_URL }), {
        auth,
        publicUrl: PUBLIC_URL,
        now: () => NOW,
      });
    } catch (error) {
      expect(error).toMatchObject({ status: 401 });
    }
  });

  it("rejects a cross-origin handshake", async () => {
    const { auth, token } = await authFixture();

    expect(() =>
      authenticateCollaborationHandshake(
        authRequest({
          cookie: `opennest_session=${token}`,
          origin: "https://attacker.example.com",
        }),
        {
          auth,
          publicUrl: PUBLIC_URL,
          now: () => NOW,
        }
      )
    ).toThrowError(CollaborationAuthError);
  });

  it("resolves an authenticated member", async () => {
    const { auth, token } = await authFixture();

    const identity = authenticateCollaborationHandshake(
      authRequest({
        cookie: `opennest_session=${token}`,
        origin: PUBLIC_URL,
      }),
      {
        auth,
        publicUrl: PUBLIC_URL,
        now: () => NOW,
      }
    );

    expect(identity).toMatchObject({
      userId: expect.any(String),
      role: "owner",
      displayName: "owner@example.com",
    });
  });
});

describe("collaboration room", () => {
  it("rejects a note from another workspace without disclosing it", async () => {
    const room = new CollaborationRoom({
      workspaceId: WORKSPACE_ID,
      noteId: NOTE_ID,
      store: new TestStore(snapshotFor("workspace-b")),
    });

    await expect(room.open()).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("lets a viewer join read-only and rejects updates", async () => {
    const store = new TestStore();
    const room = await openRoom(store);
    const editor = new TestConnection("editor-connection");
    const viewer = new TestConnection("viewer-connection");

    await room.join(member("editor", editor));
    const joined = await room.join(member("viewer", viewer));

    expect(joined.role).toBe("viewer");
    expect(joined.readOnly).toBe(true);

    const result = await room.applyUpdate(viewer.id, updateWith(" viewer"));

    expect(result).toEqual({ accepted: false, reason: "forbidden" });
    expect(store.snapshot?.content).toBe("Hello");
  });

  it("rejects oversized updates", async () => {
    const room = await openRoom();
    const editor = new TestConnection("editor-connection");
    await room.join(member("editor", editor));

    const result = await room.applyUpdate(editor.id, new Uint8Array(256 * 1024 + 1));

    expect(result).toEqual({ accepted: false, reason: "too_large" });
  });

  it("rate limits updates per connection", async () => {
    const store = new TestStore();
    const room = await openRoom(store, { maxUpdatesPerMinute: 2 });
    const editor = new TestConnection("editor-connection");
    await room.join(member("editor", editor));

    expect(await room.applyUpdate(editor.id, updateWith(" one"))).toEqual({
      accepted: true,
    });
    expect(await room.applyUpdate(editor.id, updateWith(" two"))).toEqual({
      accepted: true,
    });
    expect(await room.applyUpdate(editor.id, updateWith(" three"))).toEqual({
      accepted: false,
      reason: "rate_limited",
    });
  });

  it("snapshots a dirty room on the interval", async () => {
    const store = new TestStore();
    const room = await openRoom(store, { snapshotIntervalMs: 10 });
    const editor = new TestConnection("editor-connection");
    await room.join(member("editor", editor));

    await room.applyUpdate(editor.id, updateWith(" live"));
    await waitFor(() => store.writes.length > 0);

    expect(store.writes[0]?.state.content).toContain("Hello live");
    await room.destroy();
  });

  it("snapshots on the last disconnect and does not persist presence", async () => {
    const store = new TestStore();
    const room = await openRoom(store);
    const editor = new TestConnection("editor-connection");
    await room.join(member("editor", editor));

    await room.applyUpdate(editor.id, updateWith(" live"));
    expect(room.participants()).toHaveLength(1);

    await room.leave(editor.id);

    expect(room.participants()).toEqual([]);
    expect(store.writes).toHaveLength(1);
    expect(store.writes[0]?.state.content).toContain("Hello live");
    expect(JSON.stringify(store.writes[0])).not.toContain("Editor");
  });

  it("keeps a dirty room dirty when a snapshot fails", async () => {
    const store = new TestStore();
    const room = await openRoom(store, { snapshotIntervalMs: 60_000 });
    const editor = new TestConnection("editor-connection");
    await room.join(member("editor", editor));
    await room.applyUpdate(editor.id, updateWith(" live"));
    store.failWrites = true;

    await expect(room.snapshot()).rejects.toThrow("snapshot failed");

    store.failWrites = false;
    await room.snapshot();
    expect(store.writes).toHaveLength(1);
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for a snapshot.");
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
