import { generateId } from "@opennest/core";

import { SyncError } from "./errors";
import { payloadHash } from "./hash";
import { DEFAULT_SYNC_POLICY, canonicalIdList, type SyncPolicy } from "./policy";
import type {
  PreparedSyncChange,
  SyncChange,
  SyncHashEnvelope,
  SyncStore,
} from "./store";
import type { SyncOutboxRow } from "./types";

export interface PrepareSyncChangesInput {
  changes: readonly SyncChange[];
  policy?: SyncPolicy;
}

export interface RecordPreparedSyncChangesInput {
  changes: readonly PreparedSyncChange[];
  policy?: SyncPolicy;
  workspaceRevision?: number;
}

export interface RecordSyncChangesInput {
  changes: readonly SyncChange[];
  policy?: SyncPolicy;
  workspaceRevision?: number;
}

function canonicalizePatches(patches: Record<string, unknown>): Record<string, unknown> {
  const next = { ...patches };
  for (const field of ["tagIds", "targetNoteIds"]) {
    const value = next[field];
    if (
      Array.isArray(value) &&
      value.every((item): item is string => typeof item === "string")
    ) {
      next[field] = canonicalIdList(value);
    }
  }
  return next;
}

export async function prepareSyncChanges(
  input: PrepareSyncChangesInput
): Promise<PreparedSyncChange[]> {
  const policy = input.policy ?? DEFAULT_SYNC_POLICY;
  return Promise.all(
    input.changes.map(async (change) => {
      const fieldPatches = canonicalizePatches(change.fieldPatches);
      const opId = change.opId ?? generateId();
      const envelope: SyncHashEnvelope = {
        opId,
        workspaceId: change.workspaceId,
        entityType: change.entityType,
        entityId: change.entityId,
        operation: change.operation,
        fieldPatches,
      };
      return {
        ...change,
        fieldPatches,
        opId,
        payloadHash: policy.outbox.enabled ? await payloadHash(envelope) : null,
      };
    })
  );
}

export async function recordPreparedSyncChanges(
  store: SyncStore,
  input: RecordPreparedSyncChangesInput
): Promise<{ workspaceRevision: number }> {
  const policy = input.policy ?? DEFAULT_SYNC_POLICY;
  const [first] = input.changes;
  if (first === undefined) {
    return { workspaceRevision: input.workspaceRevision ?? 0 };
  }

  const workspaceId = first.workspaceId;
  if (input.changes.some((change) => change.workspaceId !== workspaceId)) {
    throw new SyncError(
      "A sync batch must contain exactly one workspace.",
      "invalid_sync_state"
    );
  }

  const device = await store.getOrCreateDevice(workspaceId, first.at);
  const state = await store.getOrCreateWorkspaceState(
    workspaceId,
    device.deviceId,
    first.at
  );
  if (
    device.state === "revoked" ||
    device.lastAckedTombstoneWorkspaceRevision < state.tombstoneFloor
  ) {
    throw new SyncError(
      "The device cannot write to this workspace.",
      "invalid_sync_state"
    );
  }

  const currentWorkspaceRevision = state.lastLocalWorkspaceRevision;
  let changes = input.changes;
  let existingOutbox: SyncOutboxRow[] = [];
  let nextLocalSequence = state.lastLocalSequence + 1;

  if (policy.outbox.enabled) {
    const cutoff = Date.now() - policy.outbox.retentionMs;
    for (const row of await store.listOutbox(workspaceId)) {
      if (row.state !== "acked") continue;
      const ackedAt = Date.parse(row.ackedAt ?? row.createdAt);
      if (ackedAt < cutoff) {
        await store.deleteOutbox(row.opId);
      }
    }

    existingOutbox = await store.listOutbox(workspaceId);
    const seen = new Set(existingOutbox.map((row) => row.opId));
    changes = changes.filter((change) => {
      if (seen.has(change.opId)) return false;
      seen.add(change.opId);
      return true;
    });

    if (changes.length === 0) {
      return { workspaceRevision: currentWorkspaceRevision };
    }
    if (changes.some((change) => change.payloadHash === null)) {
      throw new SyncError(
        "An enabled outbox requires a payload hash.",
        "invalid_sync_state"
      );
    }
    if (existingOutbox.length + changes.length > policy.outbox.maxRows) {
      throw new SyncError("The sync outbox is full.", "outbox_full");
    }
    const existingSequence = existingOutbox
      .filter((row) => row.deviceId === device.deviceId)
      .reduce((max, row) => Math.max(max, row.localSequence), 0);
    nextLocalSequence = Math.max(state.lastLocalSequence, existingSequence) + 1;
  }

  for (const change of changes) {
    if (change.operation === "delete") continue;
    const tombstone = await store.getTombstone(
      workspaceId,
      change.entityType,
      change.entityId
    );
    if (tombstone !== null) {
      throw new SyncError(
        "The entity is tombstoned and cannot be written.",
        "tombstoned_entity"
      );
    }
  }

  const nextWorkspaceRevision = input.workspaceRevision ?? currentWorkspaceRevision + 1;
  const baseWorkspaceRevision =
    input.workspaceRevision === undefined
      ? currentWorkspaceRevision
      : Math.max(0, input.workspaceRevision - 1);

  for (const change of changes) {
    const previousMeta = await store.getEntityMeta(
      workspaceId,
      change.entityType,
      change.entityId
    );
    const baseEntityRevision = previousMeta?.entityRevision ?? 0;
    const entityRevision = baseEntityRevision + 1;
    const isDelete = change.operation === "delete";
    const deletedAt =
      change.operation === "delete"
        ? change.at
        : change.operation === "restore"
          ? null
          : (previousMeta?.deletedAt ?? null);

    await store.putEntityMeta({
      workspaceId,
      entityType: change.entityType,
      entityId: change.entityId,
      entityRevision,
      workspaceRevision: nextWorkspaceRevision,
      originDeviceId: device.deviceId,
      updatedAt: change.at,
      deletedAt,
      contentHash: change.contentHash,
    });

    for (const fieldPath of Object.keys(change.fieldPatches)) {
      const previousField = await store.getFieldMeta(
        workspaceId,
        change.entityType,
        change.entityId,
        fieldPath
      );
      await store.putFieldMeta({
        workspaceId,
        entityType: change.entityType,
        entityId: change.entityId,
        fieldPath,
        fieldRevision: (previousField?.fieldRevision ?? 0) + 1,
        workspaceRevision: nextWorkspaceRevision,
        originDeviceId: device.deviceId,
        updatedAt: change.at,
        deletedAt: null,
      });
    }

    if (isDelete) {
      for (const field of await store.listFieldMeta(workspaceId)) {
        if (
          field.entityType !== change.entityType ||
          field.entityId !== change.entityId
        ) {
          continue;
        }
        await store.putFieldMeta({ ...field, deletedAt: change.at });
      }
      await store.putTombstone({
        tombstoneId: generateId(),
        workspaceId,
        entityType: change.entityType,
        entityId: change.entityId,
        deletedAt: change.at,
        deletedByDeviceId: device.deviceId,
        tombstoneWorkspaceRevision: nextWorkspaceRevision,
        state: "active",
        compactedAt: null,
      });
    }

    if (policy.outbox.enabled) {
      await store.appendOutbox({
        opId: change.opId,
        workspaceId,
        entityType: change.entityType,
        entityId: change.entityId,
        operation: change.operation,
        baseEntityRevision,
        baseWorkspaceRevision,
        fieldPatches: change.fieldPatches,
        payloadHash: change.payloadHash as string,
        createdAt: change.at,
        deviceId: device.deviceId,
        localSequence: nextLocalSequence,
        attempts: 0,
        state: "pending",
        ackedAt: null,
      });
      nextLocalSequence += 1;
    }
  }

  await store.putWorkspaceState({
    ...state,
    lastLocalWorkspaceRevision: nextWorkspaceRevision,
    lastLocalSequence: policy.outbox.enabled
      ? nextLocalSequence - 1
      : state.lastLocalSequence,
  });

  return { workspaceRevision: nextWorkspaceRevision };
}

export async function recordSyncChanges(
  store: SyncStore,
  input: RecordSyncChangesInput
): Promise<{ workspaceRevision: number }> {
  const prepared = await prepareSyncChanges({
    changes: input.changes,
    policy: input.policy,
  });
  return recordPreparedSyncChanges(store, {
    changes: prepared,
    policy: input.policy,
    workspaceRevision: input.workspaceRevision,
  });
}
