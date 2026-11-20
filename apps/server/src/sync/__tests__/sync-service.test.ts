// @vitest-environment node

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { IsoDate } from "@opennest/core";
import { createSqliteStorage } from "@opennest/storage-sqlite";
import { payloadHash } from "@opennest/sync";
import {
  SYNC_PROTOCOL_VERSION,
  type PullRequest,
  type PushRequest,
  type PushResponse,
  type SyncEntityType,
  type SyncOperation,
  type SyncOperationType,
} from "@opennest/sync-protocol";
import { afterEach, describe, expect, it } from "vitest";

import type { Role } from "../../auth/membership";
import { createSyncService, SyncServiceError } from "../sync-service";
import { openSyncStore, type SyncStore } from "../sync-store";

const NOW = new Date("2026-11-19T12:00:00.000Z");
const DEVICE_ID = randomUUID();
const OTHER_DEVICE_ID = randomUUID();
const OWNER = { userId: randomUUID(), role: "owner" as const };

interface OperationOverrides {
  entityType?: SyncEntityType;
  entityId?: string;
  operation?: SyncOperationType;
  baseEntityRevision?: number;
  baseWorkspaceRevision?: number;
  fieldPatches?: Record<string, unknown>;
  deviceId?: string;
}

interface Fixture {
  root: string;
  databaseFile: string;
  workspaceId: string;
  store: SyncStore;
  service: ReturnType<typeof createSyncService>;
  theOperation: (overrides?: OperationOverrides) => Promise<SyncOperation>;
}

const roots: string[] = [];
const stores: SyncStore[] = [];

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "opennest-sync-service-"));
  roots.push(root);
  const databaseFile = path.join(root, "workspace.sqlite");
  const storage = createSqliteStorage({
    databaseFile,
    blobRoot: path.join(root, "blobs"),
  });

  await storage.init();

  let workspaceId: string;

  try {
    const workspace = await storage.workspaces.create({
      name: "Shared workspace",
      at: NOW.toISOString() as IsoDate,
    });
    workspaceId = workspace.id;
  } finally {
    await storage.close();
  }

  const store = openSyncStore({ databaseFile });
  stores.push(store);
  const service = createSyncService({ store, now: () => NOW });
  let sequence = 0;

  async function theOperation(
    overrides: OperationOverrides = {}
  ): Promise<SyncOperation> {
    sequence += 1;
    const opId = randomUUID();
    const entityType = overrides.entityType ?? "note";
    const entityId = overrides.entityId ?? randomUUID();
    const operationType = overrides.operation ?? "create";
    const fieldPatches = overrides.fieldPatches ?? { title: "Note", content: "" };
    const operation = {
      opId,
      workspaceId,
      entityType,
      entityId,
      operation: operationType,
      baseEntityRevision: overrides.baseEntityRevision ?? 0,
      baseWorkspaceRevision: overrides.baseWorkspaceRevision ?? 0,
      fieldPatches,
      payloadHash: await payloadHash({
        opId,
        workspaceId,
        entityType,
        entityId,
        operation: operationType,
        fieldPatches,
      }),
      deviceId: overrides.deviceId ?? DEVICE_ID,
      localSequence: sequence,
      createdAt: NOW.toISOString() as IsoDate,
    };

    return operation;
  }

  return {
    root,
    databaseFile,
    workspaceId,
    store,
    service,
    theOperation,
  };
}

function requestFor(workspaceId: string, operations: SyncOperation[]): PushRequest {
  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    workspaceId: workspaceId as PushRequest["workspaceId"],
    operations,
  };
}

function push(
  fixture: Fixture,
  operations: SyncOperation[],
  role: Role = "owner",
  workspaceId = fixture.workspaceId
): Promise<PushResponse> {
  return fixture.service.push(requestFor(workspaceId, operations), {
    userId: OWNER.userId,
    role,
  });
}

function queryRows<T>(
  databaseFile: string,
  sql: string,
  ...params: Array<string | number>
): T[] {
  const database = new DatabaseSync(databaseFile, { readOnly: true });

  try {
    return database.prepare(sql).all(...params) as T[];
  } finally {
    database.close();
  }
}

async function expectSyncError(
  promise: Promise<unknown>,
  code: string,
  status: number
): Promise<void> {
  let caught: unknown;

  try {
    await promise;
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(SyncServiceError);
  expect(caught).toMatchObject({ code, status });
}

afterEach(async () => {
  for (const store of stores.splice(0)) {
    store.close();
  }

  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("sync service authority", () => {
  it("applies a create operation and records one canonical revision", async () => {
    const fixture = await createFixture();
    const operation = await fixture.theOperation();
    const response = await push(fixture, [operation]);

    expect(response).toEqual({
      protocolVersion: SYNC_PROTOCOL_VERSION,
      workspaceId: fixture.workspaceId,
      applied: [
        {
          opId: operation.opId,
          canonicalRevision: 1,
          entityRevision: 1,
          fieldRevisions: { title: 1, content: 1 },
          replayed: false,
          appliedAt: NOW.toISOString(),
        },
      ],
      conflicts: [],
      rejected: [],
    });

    expect(
      queryRows<{ title: string; content: string }>(
        fixture.databaseFile,
        "SELECT title, content FROM notes WHERE id = ?",
        operation.entityId
      )
    ).toEqual([{ title: "Note", content: "" }]);
    expect(
      queryRows<{ canonical_revision: number }>(
        fixture.databaseFile,
        "SELECT canonical_revision FROM sync_authority_state WHERE workspace_id = ?",
        fixture.workspaceId
      )
    ).toEqual([{ canonical_revision: 1 }]);
    expect(
      queryRows<{ entity_revision: number }>(
        fixture.databaseFile,
        "SELECT entity_revision FROM sync_meta WHERE entity_id = ?",
        operation.entityId
      )
    ).toEqual([{ entity_revision: 1 }]);
  });

  it("materializes folders, tags, files, notes, relations, and workspace names", async () => {
    const fixture = await createFixture();
    const folderId = randomUUID();
    const tagId = randomUUID();
    const fileId = randomUUID();
    const targetNoteId = randomUUID();
    const noteId = randomUUID();
    const operations = [
      await fixture.theOperation({
        entityType: "folder",
        entityId: folderId,
        fieldPatches: { name: "Projects", parentId: null },
      }),
      await fixture.theOperation({
        entityType: "tag",
        entityId: tagId,
        fieldPatches: { name: "Work", color: "#112233" },
      }),
      await fixture.theOperation({
        entityType: "file",
        entityId: fileId,
        fieldPatches: {
          name: "brief.txt",
          folderId,
          mimeType: "text/plain",
          sizeBytes: 4,
          blobKey: randomUUID(),
          checksum: "a".repeat(64),
          tagIds: [tagId],
        },
      }),
      await fixture.theOperation({
        entityType: "note",
        entityId: targetNoteId,
        fieldPatches: { title: "Target", content: "", folderId, tagIds: [tagId] },
      }),
      await fixture.theOperation({
        entityType: "note",
        entityId: noteId,
        fieldPatches: {
          title: "Source",
          content: "Linked",
          pinned: true,
          folderId,
          tagIds: [tagId],
          targetNoteIds: [targetNoteId],
        },
      }),
      await fixture.theOperation({
        entityType: "workspace",
        entityId: fixture.workspaceId,
        operation: "update",
        fieldPatches: { name: "Renamed workspace" },
      }),
    ];

    const response = await push(fixture, operations);

    expect(response.applied.map((item) => item.canonicalRevision)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(
      queryRows<{ name: string }>(
        fixture.databaseFile,
        "SELECT name FROM folders WHERE id = ?",
        folderId
      )
    ).toEqual([{ name: "Projects" }]);
    expect(
      queryRows<{ name: string; color: string }>(
        fixture.databaseFile,
        "SELECT name, color FROM tags WHERE id = ?",
        tagId
      )
    ).toEqual([{ name: "Work", color: "#112233" }]);
    expect(
      queryRows<{ name: string; folder_id: string }>(
        fixture.databaseFile,
        "SELECT name, folder_id FROM files WHERE id = ?",
        fileId
      )
    ).toEqual([{ name: "brief.txt", folder_id: folderId }]);
    expect(
      queryRows<{ tag_id: string }>(
        fixture.databaseFile,
        "SELECT tag_id FROM file_tags WHERE file_id = ?",
        fileId
      )
    ).toEqual([{ tag_id: tagId }]);
    expect(
      queryRows<{ title: string; pinned: number }>(
        fixture.databaseFile,
        "SELECT title, pinned FROM notes WHERE id = ?",
        noteId
      )
    ).toEqual([{ title: "Source", pinned: 1 }]);
    expect(
      queryRows<{ tag_id: string }>(
        fixture.databaseFile,
        "SELECT tag_id FROM note_tags WHERE note_id = ?",
        noteId
      )
    ).toEqual([{ tag_id: tagId }]);
    expect(
      queryRows<{ target_note_id: string }>(
        fixture.databaseFile,
        "SELECT target_note_id FROM note_links WHERE source_note_id = ?",
        noteId
      )
    ).toEqual([{ target_note_id: targetNoteId }]);
    expect(
      queryRows<{ name: string }>(
        fixture.databaseFile,
        "SELECT name FROM workspaces WHERE id = ?",
        fixture.workspaceId
      )
    ).toEqual([{ name: "Renamed workspace" }]);
  });

  it("replays an accepted operation with its original result", async () => {
    const fixture = await createFixture();
    const operation = await fixture.theOperation();
    const first = await push(fixture, [operation]);
    const replay = await push(fixture, [
      { ...operation, fieldPatches: { title: "Changed replay", content: "ignored" } },
    ]);

    expect(first.applied[0]).toMatchObject({
      opId: operation.opId,
      canonicalRevision: 1,
      replayed: false,
    });
    expect(replay.applied[0]).toEqual({
      ...first.applied[0],
      replayed: true,
    });
    expect(
      queryRows<{ count: number }>(
        fixture.databaseFile,
        "SELECT COUNT(*) AS count FROM sync_applied_operations"
      )
    ).toEqual([{ count: 1 }]);
    expect(
      queryRows<{ title: string }>(
        fixture.databaseFile,
        "SELECT title FROM notes WHERE id = ?",
        operation.entityId
      )
    ).toEqual([{ title: "Note" }]);
    expect(
      queryRows<{ canonical_revision: number }>(
        fixture.databaseFile,
        "SELECT canonical_revision FROM sync_authority_state WHERE workspace_id = ?",
        fixture.workspaceId
      )
    ).toEqual([{ canonical_revision: 1 }]);
  });

  it("advances the canonical revision once per operation and pages pulls", async () => {
    const fixture = await createFixture();
    const first = await fixture.theOperation({
      fieldPatches: { title: "First", content: "" },
    });
    const second = await fixture.theOperation({
      fieldPatches: { title: "Second", content: "" },
    });
    const response = await push(fixture, [first, second]);

    expect(response.applied.map((applied) => applied.canonicalRevision)).toEqual([1, 2]);

    const firstPage = await fixture.service.pull(
      {
        protocolVersion: SYNC_PROTOCOL_VERSION,
        workspaceId: fixture.workspaceId as PushRequest["workspaceId"],
        cursor: null,
        limit: 1,
      },
      { userId: OWNER.userId, role: "viewer" }
    );

    expect(firstPage.operations.map((operation) => operation.opId)).toEqual([first.opId]);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await fixture.service.pull(
      {
        protocolVersion: SYNC_PROTOCOL_VERSION,
        workspaceId: fixture.workspaceId as PushRequest["workspaceId"],
        cursor: firstPage.nextCursor,
        limit: 1,
      },
      { userId: OWNER.userId, role: "viewer" }
    );

    expect(secondPage.operations.map((operation) => operation.opId)).toEqual([
      second.opId,
    ]);
    expect(secondPage.nextCursor).toBeNull();
  });

  it("rejects a viewer push before writing", async () => {
    const fixture = await createFixture();
    const operation = await fixture.theOperation();

    await expectSyncError(push(fixture, [operation], "viewer"), "forbidden", 403);
    expect(
      queryRows<{ count: number }>(
        fixture.databaseFile,
        "SELECT COUNT(*) AS count FROM notes"
      )
    ).toEqual([{ count: 0 }]);
    expect(
      queryRows<{ count: number }>(
        fixture.databaseFile,
        "SELECT COUNT(*) AS count FROM sync_authority_state"
      )
    ).toEqual([{ count: 0 }]);
  });

  it("rejects a workspace that is not the shared workspace", async () => {
    const fixture = await createFixture();
    const operation = await fixture.theOperation();
    const otherWorkspaceId = randomUUID();

    await expectSyncError(
      push(fixture, [operation], "owner", otherWorkspaceId),
      "not_found",
      404
    );
    expect(
      queryRows<{ count: number }>(
        fixture.databaseFile,
        "SELECT COUNT(*) AS count FROM notes"
      )
    ).toEqual([{ count: 0 }]);
  });

  it("preserves both values when a content field conflicts", async () => {
    const fixture = await createFixture();
    const noteId = randomUUID();
    const create = await fixture.theOperation({
      entityId: noteId,
      fieldPatches: { title: "Original", content: "Body" },
    });
    await push(fixture, [create]);

    const local = await fixture.theOperation({
      entityId: noteId,
      operation: "update",
      baseEntityRevision: 1,
      fieldPatches: { title: "Mine" },
    });
    await push(fixture, [local]);

    const remote = await fixture.theOperation({
      entityId: noteId,
      operation: "update",
      baseEntityRevision: 1,
      fieldPatches: { title: "Theirs" },
      deviceId: OTHER_DEVICE_ID,
    });
    const response = await push(fixture, [remote]);

    expect(response.applied[0]).toMatchObject({
      opId: remote.opId,
      canonicalRevision: 3,
      entityRevision: 3,
      fieldRevisions: { title: 3 },
    });
    expect(response.conflicts).toEqual([
      expect.objectContaining({
        entityType: "note",
        entityId: noteId,
        fieldPath: "title",
        localOpId: local.opId,
        remoteOpId: remote.opId,
        localFieldRevision: 2,
        remoteFieldRevision: 3,
        localValue: "Mine",
        remoteValue: "Theirs",
        localDeviceId: DEVICE_ID,
        remoteDeviceId: OTHER_DEVICE_ID,
      }),
    ]);
    expect(
      queryRows<{ title: string }>(
        fixture.databaseFile,
        "SELECT title FROM notes WHERE id = ?",
        noteId
      )
    ).toEqual([{ title: "Theirs" }]);
    expect(
      queryRows<{ local_value: string; remote_value: string; state: string }>(
        fixture.databaseFile,
        "SELECT local_value, remote_value, state FROM sync_conflict WHERE entity_id = ?",
        noteId
      )
    ).toEqual([
      {
        local_value: JSON.stringify("Mine"),
        remote_value: JSON.stringify("Theirs"),
        state: "open",
      },
    ]);
  });

  it("does not resurrect a tombstoned entity without a restore", async () => {
    const fixture = await createFixture();
    const noteId = randomUUID();
    const create = await fixture.theOperation({
      entityId: noteId,
      fieldPatches: { title: "Doomed", content: "" },
    });
    await push(fixture, [create]);
    const remove = await fixture.theOperation({
      entityId: noteId,
      operation: "delete",
      baseEntityRevision: 1,
      fieldPatches: {},
    });
    await push(fixture, [remove]);

    expect(
      queryRows<{ count: number }>(
        fixture.databaseFile,
        "SELECT COUNT(*) AS count FROM notes WHERE id = ?",
        noteId
      )
    ).toEqual([{ count: 0 }]);
    expect(
      queryRows<{ state: string }>(
        fixture.databaseFile,
        "SELECT state FROM sync_tombstone WHERE entity_id = ?",
        noteId
      )
    ).toEqual([{ state: "active" }]);

    const staleUpdate = await fixture.theOperation({
      entityId: noteId,
      operation: "update",
      baseEntityRevision: 2,
      fieldPatches: { title: "Zombie" },
    });

    await expectSyncError(push(fixture, [staleUpdate]), "tombstoned_entity", 409);
    expect(
      queryRows<{ count: number }>(
        fixture.databaseFile,
        "SELECT COUNT(*) AS count FROM notes WHERE id = ?",
        noteId
      )
    ).toEqual([{ count: 0 }]);
    expect(
      queryRows<{ canonical_revision: number }>(
        fixture.databaseFile,
        "SELECT canonical_revision FROM sync_authority_state WHERE workspace_id = ?",
        fixture.workspaceId
      )
    ).toEqual([{ canonical_revision: 2 }]);

    const restore = await fixture.theOperation({
      entityId: noteId,
      operation: "restore",
      baseEntityRevision: 2,
      fieldPatches: { title: "Restored", content: "" },
    });
    const restored = await push(fixture, [restore]);

    expect(restored.applied[0]).toMatchObject({
      canonicalRevision: 3,
      entityRevision: 3,
    });
    expect(
      queryRows<{ title: string }>(
        fixture.databaseFile,
        "SELECT title FROM notes WHERE id = ?",
        noteId
      )
    ).toEqual([{ title: "Restored" }]);
    expect(
      queryRows<{ count: number }>(
        fixture.databaseFile,
        "SELECT COUNT(*) AS count FROM sync_tombstone WHERE entity_id = ?",
        noteId
      )
    ).toEqual([{ count: 0 }]);
  });

  it("rejects restoring an entity that is not deleted", async () => {
    const fixture = await createFixture();
    const noteId = randomUUID();
    const create = await fixture.theOperation({
      entityId: noteId,
      fieldPatches: { title: "Live", content: "" },
    });
    await push(fixture, [create]);
    const restore = await fixture.theOperation({
      entityId: noteId,
      operation: "restore",
      baseEntityRevision: 1,
      fieldPatches: { title: "Overwritten", content: "" },
    });

    await expectSyncError(push(fixture, [restore]), "invalid_operation", 400);
    expect(
      queryRows<{ title: string }>(
        fixture.databaseFile,
        "SELECT title FROM notes WHERE id = ?",
        noteId
      )
    ).toEqual([{ title: "Live" }]);
    expect(
      queryRows<{ canonical_revision: number }>(
        fixture.databaseFile,
        "SELECT canonical_revision FROM sync_authority_state WHERE workspace_id = ?",
        fixture.workspaceId
      )
    ).toEqual([{ canonical_revision: 1 }]);
  });

  it("rejects a payload whose hash does not match", async () => {
    const fixture = await createFixture();
    const operation = await fixture.theOperation();
    const tampered = { ...operation, payloadHash: "0".repeat(64) };

    await expectSyncError(push(fixture, [tampered]), "invalid_payload_hash", 400);
    expect(
      queryRows<{ count: number }>(
        fixture.databaseFile,
        "SELECT COUNT(*) AS count FROM notes"
      )
    ).toEqual([{ count: 0 }]);
  });

  it("rejects a batch from more than one device", async () => {
    const fixture = await createFixture();
    const first = await fixture.theOperation();
    const second = await fixture.theOperation({ deviceId: OTHER_DEVICE_ID });

    await expectSyncError(push(fixture, [first, second]), "invalid_operation", 400);
    expect(
      queryRows<{ count: number }>(
        fixture.databaseFile,
        "SELECT COUNT(*) AS count FROM notes"
      )
    ).toEqual([{ count: 0 }]);
  });

  it("rejects an invalid cursor", async () => {
    const fixture = await createFixture();

    await expectSyncError(
      fixture.service.pull(
        {
          protocolVersion: SYNC_PROTOCOL_VERSION,
          workspaceId: fixture.workspaceId as PushRequest["workspaceId"],
          cursor: "not-a-cursor" as PullRequest["cursor"],
          limit: 10,
        },
        { userId: OWNER.userId, role: "viewer" }
      ),
      "invalid_cursor",
      400
    );
  });
});
