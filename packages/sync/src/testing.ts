import { generateId } from "@opennest/core";

import { SyncError } from "./errors";
import { mergeFieldCandidate, type FieldCandidate, type MergeOutcome } from "./merge";
import { recordSyncChanges } from "./recorder";
import type { SyncStore } from "./store";
import type {
  SyncConflictRow,
  SyncDeviceRow,
  SyncEntityType,
  SyncFieldMetaRow,
  SyncMetaRow,
  SyncOperation,
  SyncOutboxRow,
  SyncTombstoneRow,
  WorkspaceSyncStateRow,
} from "./types";

function key(...parts: string[]): string {
  return parts.join("\u0000");
}

function clone<T>(value: T): T {
  return { ...value };
}

class MemorySyncStore implements SyncStore {
  private installationDeviceId: string | null = null;
  private readonly devices = new Map<string, SyncDeviceRow>();
  private readonly states = new Map<string, WorkspaceSyncStateRow>();
  private readonly entityMeta = new Map<string, SyncMetaRow>();
  private readonly fieldMeta = new Map<string, SyncFieldMetaRow>();
  private readonly outbox = new Map<string, SyncOutboxRow>();
  private readonly tombstones = new Map<string, SyncTombstoneRow>();
  private readonly conflicts = new Map<string, SyncConflictRow>();

  async seedDevice(
    workspaceId: string,
    deviceId: string,
    at: string,
    overrides: Partial<
      Pick<SyncDeviceRow, "state" | "lastAckedTombstoneWorkspaceRevision">
    > = {}
  ): Promise<void> {
    this.installationDeviceId = deviceId;
    this.devices.set(key(workspaceId, deviceId), {
      workspaceId,
      deviceId,
      registeredAt: at,
      lastSeenAt: at,
      lastAckedTombstoneWorkspaceRevision:
        overrides.lastAckedTombstoneWorkspaceRevision ?? 0,
      state: overrides.state ?? "active",
      publicKey: null,
    });
  }

  async getOrCreateDevice(workspaceId: string, at: string): Promise<SyncDeviceRow> {
    const existing = [...this.devices.values()].find(
      (row) => row.workspaceId === workspaceId
    );
    if (existing) return clone(existing);

    if (this.installationDeviceId === null) {
      const first = [...this.devices.values()][0];
      this.installationDeviceId = first?.deviceId ?? generateId();
    }
    const row: SyncDeviceRow = {
      workspaceId,
      deviceId: this.installationDeviceId,
      registeredAt: at,
      lastSeenAt: at,
      lastAckedTombstoneWorkspaceRevision: 0,
      state: "active",
      publicKey: null,
    };
    this.devices.set(key(workspaceId, row.deviceId), row);
    return clone(row);
  }

  async getDevice(workspaceId: string, deviceId: string): Promise<SyncDeviceRow | null> {
    const row = this.devices.get(key(workspaceId, deviceId));
    return row ? clone(row) : null;
  }

  async listDevices(workspaceId: string): Promise<SyncDeviceRow[]> {
    return [...this.devices.values()]
      .filter((row) => row.workspaceId === workspaceId)
      .map(clone);
  }

  async getWorkspaceState(
    workspaceId: string,
    deviceId: string
  ): Promise<WorkspaceSyncStateRow | null> {
    const row = this.states.get(key(workspaceId, deviceId));
    return row ? clone(row) : null;
  }

  async getOrCreateWorkspaceState(
    workspaceId: string,
    deviceId: string,
    at: string
  ): Promise<WorkspaceSyncStateRow> {
    const existing = this.states.get(key(workspaceId, deviceId));
    if (existing) return clone(existing);

    const stateRevision = [...this.states.values()]
      .filter((row) => row.workspaceId === workspaceId)
      .reduce((max, row) => Math.max(max, row.lastLocalWorkspaceRevision), 0);
    const entityRevision = [...this.entityMeta.values()]
      .filter((row) => row.workspaceId === workspaceId)
      .reduce((max, row) => Math.max(max, row.workspaceRevision), 0);
    const row: WorkspaceSyncStateRow = {
      workspaceId,
      deviceId,
      remoteWorkspaceId: null,
      lastServerCursor: null,
      lastLocalWorkspaceRevision: Math.max(stateRevision, entityRevision),
      lastLocalSequence: 0,
      tombstoneFloor: 0,
      lastFullResyncAt: at,
    };
    this.states.set(key(workspaceId, deviceId), row);
    return clone(row);
  }

  async putWorkspaceState(row: WorkspaceSyncStateRow): Promise<void> {
    this.states.set(key(row.workspaceId, row.deviceId), clone(row));
  }

  async hasRemoteTarget(workspaceId: string): Promise<boolean> {
    return [...this.states.values()].some(
      (row) => row.workspaceId === workspaceId && row.remoteWorkspaceId !== null
    );
  }

  async getEntityMeta(
    workspaceId: string,
    entityType: SyncEntityType,
    entityId: string
  ): Promise<SyncMetaRow | null> {
    const row = this.entityMeta.get(key(workspaceId, entityType, entityId));
    return row ? clone(row) : null;
  }

  async listEntityMeta(workspaceId: string): Promise<SyncMetaRow[]> {
    return [...this.entityMeta.values()]
      .filter((row) => row.workspaceId === workspaceId)
      .map(clone);
  }

  async putEntityMeta(row: SyncMetaRow): Promise<void> {
    this.entityMeta.set(key(row.workspaceId, row.entityType, row.entityId), {
      ...row,
    });
  }

  async getFieldMeta(
    workspaceId: string,
    entityType: SyncEntityType,
    entityId: string,
    fieldPath: string
  ): Promise<SyncFieldMetaRow | null> {
    const row = this.fieldMeta.get(key(workspaceId, entityType, entityId, fieldPath));
    return row ? clone(row) : null;
  }

  async listFieldMeta(workspaceId: string): Promise<SyncFieldMetaRow[]> {
    return [...this.fieldMeta.values()]
      .filter((row) => row.workspaceId === workspaceId)
      .map(clone);
  }

  async putFieldMeta(row: SyncFieldMetaRow): Promise<void> {
    this.fieldMeta.set(
      key(row.workspaceId, row.entityType, row.entityId, row.fieldPath),
      { ...row }
    );
  }

  async appendOutbox(row: SyncOutboxRow): Promise<void> {
    if (this.outbox.has(row.opId)) {
      throw new SyncError("Outbox operation already exists.", "invalid_sync_state");
    }

    this.outbox.set(row.opId, {
      ...row,
      fieldPatches: { ...row.fieldPatches },
    });

    const state = this.states.get(key(row.workspaceId, row.deviceId));
    this.states.set(key(row.workspaceId, row.deviceId), {
      ...(state ?? {
        workspaceId: row.workspaceId,
        deviceId: row.deviceId,
        remoteWorkspaceId: null,
        lastServerCursor: null,
        lastLocalWorkspaceRevision: 0,
        tombstoneFloor: 0,
        lastFullResyncAt: null,
      }),
      lastLocalSequence: Math.max(state?.lastLocalSequence ?? 0, row.localSequence),
    });
  }

  async listOutbox(workspaceId: string): Promise<SyncOutboxRow[]> {
    return [...this.outbox.values()]
      .filter((row) => row.workspaceId === workspaceId)
      .map((row) => ({ ...row, fieldPatches: { ...row.fieldPatches } }));
  }

  async nextLocalSequence(workspaceId: string, deviceId: string): Promise<number> {
    const state = this.states.get(key(workspaceId, deviceId));
    return (state?.lastLocalSequence ?? 0) + 1;
  }

  async deleteOutbox(opId: string): Promise<void> {
    this.outbox.delete(opId);
  }

  async getTombstone(
    workspaceId: string,
    entityType: SyncEntityType,
    entityId: string
  ): Promise<SyncTombstoneRow | null> {
    const row = this.tombstones.get(key(workspaceId, entityType, entityId));
    return row ? clone(row) : null;
  }

  async listTombstones(workspaceId: string): Promise<SyncTombstoneRow[]> {
    return [...this.tombstones.values()]
      .filter((row) => row.workspaceId === workspaceId)
      .map(clone);
  }

  async putTombstone(row: SyncTombstoneRow): Promise<void> {
    this.tombstones.set(key(row.workspaceId, row.entityType, row.entityId), {
      ...row,
    });
  }

  async listConflicts(
    workspaceId: string,
    state?: "open" | "resolved"
  ): Promise<SyncConflictRow[]> {
    return [...this.conflicts.values()]
      .filter(
        (row) =>
          row.workspaceId === workspaceId && (state === undefined || row.state === state)
      )
      .map(clone);
  }

  async putConflict(row: SyncConflictRow): Promise<void> {
    this.conflicts.set(row.conflictId, clone(row));
  }

  async resolveConflict(
    conflictId: string,
    input: {
      resolution: "local" | "remote" | "merged" | "copy";
      resolvedAt: string;
      resolvedByDeviceId: string;
    }
  ): Promise<SyncConflictRow> {
    if (input.resolution === "merged" || input.resolution === "copy") {
      throw new SyncError(
        "This resolution requires the sync UI gate.",
        "unsupported_resolution"
      );
    }
    const row = this.conflicts.get(conflictId);
    if (row === undefined) {
      throw new SyncError("Conflict not found.", "invalid_sync_state");
    }
    const resolved: SyncConflictRow = {
      ...row,
      state: "resolved",
      resolution: input.resolution,
      resolvedAt: input.resolvedAt,
      resolvedByDeviceId: input.resolvedByDeviceId,
    };
    this.conflicts.set(conflictId, resolved);
    return clone(resolved);
  }

  async clearWorkspace(workspaceId: string): Promise<void> {
    for (const map of [
      this.devices,
      this.states,
      this.entityMeta,
      this.fieldMeta,
      this.outbox,
      this.tombstones,
      this.conflicts,
    ]) {
      for (const [rowKey, row] of map) {
        if (row.workspaceId === workspaceId) map.delete(rowKey);
      }
    }
  }
}

export function createMemorySyncStore(): SyncStore {
  return new MemorySyncStore();
}

export async function seedDevice(
  store: SyncStore,
  workspaceId: string,
  deviceId: string,
  at: string,
  overrides: Partial<
    Pick<SyncDeviceRow, "state" | "lastAckedTombstoneWorkspaceRevision">
  > = {}
): Promise<void> {
  if (!(store instanceof MemorySyncStore)) {
    throw new SyncError("seedDevice requires a memory sync store.", "invalid_sync_state");
  }
  await store.seedDevice(workspaceId, deviceId, at, overrides);
}

export interface SimulateTwoDeviceMergeInput {
  workspaceId: string;
  deviceA: string;
  deviceB: string;
  local: readonly FieldCandidate[];
  remote: readonly FieldCandidate[];
  at?: string;
}

interface CandidatePair {
  local?: FieldCandidate;
  remote?: FieldCandidate;
}

function candidateKey(candidate: FieldCandidate): string {
  return key(candidate.entityType, candidate.entityId, candidate.fieldPath);
}

function assertCandidate(candidate: FieldCandidate, workspaceId: string): void {
  if (candidate.workspaceId !== workspaceId) {
    throw new SyncError(
      "A candidate belongs to another workspace.",
      "invalid_sync_state"
    );
  }
}

async function writeField(
  store: SyncStore,
  workspaceId: string,
  candidate: FieldCandidate,
  operation: SyncOperation,
  value: unknown,
  at: string
): Promise<void> {
  await recordSyncChanges(store, {
    changes: [
      {
        workspaceId,
        entityType: candidate.entityType,
        entityId: candidate.entityId,
        operation,
        fieldPatches: { [candidate.fieldPath]: value },
        at,
        contentHash: null,
      },
    ],
  });
}

export async function simulateTwoDeviceMerge(
  input: SimulateTwoDeviceMergeInput
): Promise<{ conflicts: SyncConflictRow[] }> {
  const localStore = createMemorySyncStore();
  const remoteStore = createMemorySyncStore();
  const at =
    input.at ??
    [...input.local, ...input.remote]
      .map((candidate) => candidate.updatedAt)
      .sort()
      .at(-1) ??
    new Date().toISOString();

  for (const candidate of [...input.local, ...input.remote]) {
    assertCandidate(candidate, input.workspaceId);
  }
  await seedDevice(localStore, input.workspaceId, input.deviceA, at);
  await seedDevice(remoteStore, input.workspaceId, input.deviceB, at);

  const pairs = new Map<string, CandidatePair>();
  for (const candidate of input.local) {
    const row = pairs.get(candidateKey(candidate)) ?? {};
    row.local = candidate;
    pairs.set(candidateKey(candidate), row);
  }
  for (const candidate of input.remote) {
    const row = pairs.get(candidateKey(candidate)) ?? {};
    row.remote = candidate;
    pairs.set(candidateKey(candidate), row);
  }

  const conflicts: SyncConflictRow[] = [];
  for (const pairKey of [...pairs.keys()].sort()) {
    const pair = pairs.get(pairKey);
    if (pair === undefined) continue;
    const { local, remote } = pair;

    if (local !== undefined && remote !== undefined) {
      if (
        local.entityType !== remote.entityType ||
        local.entityId !== remote.entityId ||
        local.fieldPath !== remote.fieldPath
      ) {
        throw new SyncError(
          "Merge candidates do not describe the same field.",
          "invalid_sync_state"
        );
      }
      const outcome: MergeOutcome = mergeFieldCandidate(
        local.entityType,
        local.fieldPath,
        local,
        remote
      );
      const at = outcome.winner === "local" ? local.updatedAt : remote.updatedAt;
      await writeField(localStore, input.workspaceId, local, "update", outcome.value, at);
      await writeField(
        remoteStore,
        input.workspaceId,
        local,
        "update",
        outcome.value,
        at
      );
      if (outcome.conflict !== null) {
        await localStore.putConflict(outcome.conflict);
        await remoteStore.putConflict(outcome.conflict);
        conflicts.push(outcome.conflict);
      }
      continue;
    }

    const candidate = local ?? remote;
    if (candidate === undefined) continue;
    await writeField(
      localStore,
      input.workspaceId,
      candidate,
      "update",
      candidate.value,
      candidate.updatedAt
    );
    await writeField(
      remoteStore,
      input.workspaceId,
      candidate,
      "update",
      candidate.value,
      candidate.updatedAt
    );
  }

  return { conflicts };
}
