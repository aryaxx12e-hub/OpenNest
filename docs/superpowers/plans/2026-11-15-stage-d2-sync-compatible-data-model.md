# Stage D2 Sync-Compatible Data Model Implementation Plan

> **Status:** The D2 local-only implementation is complete. Live status is in ADR 0012 and the 2026-11-17 remediation plan; this original checklist is retained as the baseline and its unchecked boxes are historical.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local-only sync-compatible data model with seven sidecar tables, atomic write recording, migrations, tombstones, a bounded outbox, conflict records, and a simulation harness without adding network sync.

**Architecture:** A new `@opennest/sync` package owns pure policy, revision rules, canonical hashing, the write recorder, merge rules, and a memory harness. Dexie and SQLite each gain additive sidecar tables, a `SyncStore`, atomic sidecar writes inside existing transactions, and backfill migrations. The app keeps using `StorageAdapter`; adapters expose `sync` additively through `SyncCapableStorage`, so every repository write records sidecars below services and below the D1 broker.

**Tech Stack:** TypeScript, Dexie 4, `node:sqlite` with Drizzle, Vitest 3, fake-indexeddb, existing `@opennest/core` and `@opennest/validation`.

**Spec:** `docs/adr/0012-sync-compatible-data-model.md`, `docs/superpowers/specs/2026-11-14-stage-d0-architecture-decision-pack.md` section 8 D2, `docs/superpowers/specs/2026-11-14-stage-d0-architecture-decision-pack.md` C-05.

## Global Constraints

- D2 is local-only. No network sync, authentication, server roster, device trust, tenant model, CRDT, E2EE, AI, or extension work.
- Do not change `packages/core` ports, domain entities, or `BackupSnapshot`.
- Do not add an external dependency.
- Seven sidecar tables only: `sync_meta`, `sync_field_meta`, `sync_outbox`, `workspace_sync_state`, `sync_tombstone`, `sync_conflict`, `sync_devices`.
- Outbox is disabled by default. When enabled, cap it at 1000 rows or 30 days, whichever comes first, and fail closed with `outbox_full` when the cap cannot be met.
- Tombstone compaction and automatic stale marking stay disabled.
- Merge-safe fields are exactly `note.pinned` and `tag.color`. Every other synced field is content-bearing.
- `tagIds` and `targetNoteIds` are canonical ID arrays: dedupe, then ascending code unit order by raw ID string using the default `sort()`, never `localeCompare`. Product order has no meaning. The same canonical form is used for field patches, hashing, conflict comparison, and storage.
- `localSequence` is unique and monotonic per `(workspaceId, deviceId)` and starts at 1. The same sequence number may exist for the same device in another workspace.
- Conflict ordering is `updatedAt`, then `originDeviceId`, then `opId`. No HLC and no global workspace order claim.
- Content-bearing conflicts preserve the losing value in `sync_conflict`. Never silently discard content.
- D2 has no conflict UI. Conflict records are listed and resolved through the store API and simulation harness.
- Backup v1 remains unchanged and excludes every sidecar table.
- Restoring backup v1 clears sidecars and reinitializes sync state only when no remote target exists. A remote target blocks restore, and the guard is read inside the same transaction that clears sidecars and writes restored data.
- Device ID identifies an installation, is generated once, and is excluded from backups.
- `workspaceRevision` is local and increments once per write transaction.
- Field metadata is created lazily on the first post-migration write.
- A failed SQLite restore may leave orphan blob files. D2 keeps the existing behavior, documents it as a known limitation, and tracks cleanup as backlog.
- The browser graph must stay free of `node:` imports.
- User-facing inventory text is localized in English and Indonesian.
- Do not commit unless the user explicitly asks. Each task ends with verification, not a commit.

## Review Focus

- Folder, tag, and note deletion cascades must record every changed field and every tombstone, not leave stale sidecars.
- A populated Dexie v2 database and a populated SQLite v2 database must upgrade in place without losing rows or failing backfill.
- Outbox-disabled mode must allocate no outbox rows, and outbox-enabled mode must fail closed at its cap.
- `localSequence` must stay unique and monotonic per workspace and device, including when one device writes to multiple workspaces.
- Relation arrays that differ only in order must canonicalize to the same value and must not create false conflicts.
- Backup restore must not retain stale tombstones or resurrect a deleted ID when a remote target exists. The remote target guard and the restore writes share one transaction.
- A failed SQLite restore may leave orphan blobs. This is an accepted D2 limitation with a tracked cleanup backlog item.
- Clock skew must never discard a content-bearing value, even when a provisional winner is chosen.

---

## File Structure

### New package

- `packages/sync/package.json`: workspace package metadata.
- `package-lock.json`: workspace link for the new package.
- `packages/sync/src/types.ts`: entity types, row shapes, operation types, conflict and device shapes.
- `packages/sync/src/store.ts`: `SyncStore`, `SyncCapableStorage`, and store input types.
- `packages/sync/src/policy.ts`: default policy, merge-safe field list, field classification.
- `packages/sync/src/errors.ts`: `SyncError` with D2 codes.
- `packages/sync/src/hash.ts`: canonical JSON and SHA-256 over prepared payloads.
- `packages/sync/src/recorder.ts`: prepare and record revision, field metadata, outbox, and tombstones.
- `packages/sync/src/merge.ts`: deterministic field ordering and conflict outcomes.
- `packages/sync/src/testing.ts`: in-memory store and two-device harness.
- `packages/sync/src/index.ts`: public exports.
- `packages/sync/src/__tests__/policy.test.ts`
- `packages/sync/src/__tests__/recorder.test.ts`
- `packages/sync/src/__tests__/merge.test.ts`
- `packages/sync/src/__tests__/testing.test.ts`

### Storage changes

- `packages/storage-dexie/src/schema.ts`: seven tables, Dexie version 3, upgrade backfill.
- `packages/storage-dexie/src/sync-store.ts`: Dexie `SyncStore` implementation.
- `packages/storage-dexie/src/storage.ts`: expose `sync`, include sidecar tables in transactions, record writes, handle reset and restore.
- `packages/storage-dexie/src/__tests__/sync-store.test.ts`
- `packages/storage-dexie/src/__tests__/sync-upgrade.test.ts`
- `packages/storage-dexie/src/__tests__/sync-atomicity.test.ts`
- `packages/storage-sqlite/src/schema.ts`: seven Drizzle tables.
- `packages/storage-sqlite/migrations/0002_sync_sidecars.sql`: additive tables and backfill.
- `packages/storage-sqlite/migrations/meta/0002_snapshot.json`: generated snapshot.
- `packages/storage-sqlite/migrations/meta/_journal.json`: add entry 2.
- `packages/storage-sqlite/src/sync-store.ts`: SQLite `SyncStore` implementation.
- `packages/storage-sqlite/src/storage.ts`: expose `sync`, record writes, handle reset and restore.
- `packages/storage-sqlite/src/__tests__/sync-store.test.ts`
- `packages/storage-sqlite/src/__tests__/sync-migrations.test.ts`
- `packages/storage-sqlite/src/__tests__/sync-atomicity.test.ts`

### Conformance and product surface

- `packages/storage-conformance/src/scenarios/sync.ts`: shared sync scenarios.
- `packages/storage-conformance/src/index.ts`: export `runSyncConformance`.
- `packages/storage-conformance/package.json`: add `@opennest/sync`.
- `packages/storage-dexie/src/__tests__/conformance.test.ts`: run sync conformance.
- `packages/storage-sqlite/src/__tests__/conformance.test.ts`: run sync conformance.
- `apps/web/next.config.ts`: add `@opennest/sync` to `transpilePackages`.
- `benchmarks/sync.bench.ts`: write-cost measurement.
- `packages/privacy/src/inventory.ts`: sidecar inventory entries.
- `packages/localization/src/en.ts` and `id.ts`: inventory labels.
- `docs/sync-data-model.md`: operator documentation.
- `docs/adr/0012-sync-compatible-data-model.md`: status `Accepted`.
- `ROADMAP.md`: mark the local sync-compatible model when all gates pass.

---

### Task 1: Accept ADR 0012 and record D2 decisions

**Files:**

- Modify: `docs/adr/0012-sync-compatible-data-model.md`
- Create: `docs/sync-data-model.md`
- Modify: `docs/superpowers/specs/2026-11-14-stage-d0-architecture-decision-pack.md` only if a C-05 note is needed

**Interfaces:**

- Consumes: nothing.
- Produces: accepted ADR status and the D2 gate decisions used by every later task.

- [ ] **Step 1: Change the ADR status and record the three D2 details**

Set the status line to `- Status: Accepted`. Change `- Product conflict: schema expansion requires approval` to `- Product conflict: schema expansion approved for Stage D2 by the D0 decision pack`. Add `- Targeted revision: pass 3 applied 2026-11-15 for D2 gates G-12-1 to G-12-4 and G-12-6`.

In the `sync_outbox` section, change `- Unique (deviceId, localSequence)` to `- Unique (workspaceId, deviceId, localSequence)`. Change `- Index (workspaceId, state, localSequence)` to `- Index (workspaceId, deviceId, state, localSequence)`. State that `localSequence` starts at 1 for each workspace and device pair and may repeat for the same device in a different workspace.

In the conflict policy section, add: `tagIds` and `targetNoteIds` are canonical ID arrays with duplicates removed and ascending code unit order by raw ID string using the default `sort()`, never `localeCompare`. Product order has no meaning. Adapters, hashing, and conflict comparison use the canonical form, so different input order cannot create a false conflict.

In the migration implications section, add: a failed SQLite restore may leave orphan blob files. D2 keeps the existing behavior and tracks cleanup as backlog.

- [ ] **Step 2: Write the decision record**

Create `docs/sync-data-model.md` with these exact sections and decisions:

```markdown
# Sync-compatible data model

## Scope

Local-only D2. No network code, server, authentication, device trust, or global revision authority.

## Sidecar tables

List the seven tables and their primary keys exactly as ADR 0012.

## Device identity

One device ID per installation, generated by the adapter, stored in sync_devices, excluded from backups.

## Revisions

entityRevision and fieldRevision are local monotonic counters. workspaceRevision increments once per write transaction and is local only.

## G-12-1 outbox

Disabled by default. When enabled: maximum 1000 rows and 30 days for acknowledged rows. Pending or failed rows are never silently dropped. A full outbox throws outbox_full and rolls back the entity write. localSequence is unique and monotonic per workspace and device, starts at 1, and may repeat for the same device in another workspace.

## G-12-2 tombstones

Tombstones are written on delete. Compaction and automatic stale marking are disabled. tombstoneFloor starts at zero.

## G-12-3 merge-safe fields

Exactly note.pinned and tag.color. All other synced fields are content-bearing.

## Relation arrays

tagIds and targetNoteIds are canonical ID arrays: dedupe, then ascending code unit order by raw ID string using the default sort(), never localeCompare. Product order has no meaning. Field patches, hashing, storage, and conflict comparison use the canonical form, so different input order cannot create a false conflict.

## G-12-4 conflicts

No user-facing conflict UI in D2. Records preserve local and remote values. The store can list conflicts and mark local or remote resolutions. Applying a resolution to entity state is deferred with the conflict UI. merged and copy resolutions are typed but return unsupported_resolution until the sync UI gate.

## G-12-6 ordering

updatedAt, then originDeviceId, then opId. No HLC. A merge-safe conflict may pick a winner under skew. A content-bearing conflict always preserves both values.

## Operation hashing

payloadHash is SHA-256 over canonical JSON of the stable envelope: opId, workspaceId, entityType, entityId, operation, and fieldPatches. Base revisions are stored metadata and are not hashed, because Dexie cannot await crypto inside a transaction.

## Operation timestamps

create uses the caller's at. update uses the effective core timestamp, `laterOf(at, previous.updatedAt)`, so sync metadata never moves backwards. Tag update uses patch.at because tag rows have no updatedAt. setTags, setLinks, and delete use one new Date().toISOString() per operation. Core ports do not change.

## Transaction revisions

The first recorded write in an outer storage transaction allocates one workspaceRevision; every later write in that transaction reuses it. Writes outside an outer transaction allocate their own revision. A batch holds one workspace; a batch spanning workspaces is rejected with invalid_sync_state.

## Backup and restore

Backup v1 is unchanged and excludes all sidecars. Restore clears sidecars in the same transaction, reinitializes the device, and backfills restored entities. Restore is blocked when workspace_sync_state.remoteWorkspaceId is non-null, and that check runs inside the same transaction before any sidecar or core write.

## Data classification

sync_meta, sync_field_meta, sync_devices, workspace_sync_state, and sync_tombstone are metadata. Outbox patches and conflict values inherit the content data class. File bytes are never stored in sidecars.

## Known limitations

A failed SQLite restore may leave orphan blob files because blobs are written before the database transaction. D2 keeps the existing behavior and tracks cleanup as backlog.
```

- [ ] **Step 3: Verify the documents**

Run: `rg -n "Status: Accepted|localSequence|canonical ID arrays|orphan blob|outbox_full|unsupported_resolution" docs/adr/0012-sync-compatible-data-model.md docs/sync-data-model.md`

Expected: the accepted status and all D2 decision phrases are present.

---

### Task 2: Create the sync package model and policy

**Files:**

- Create: `packages/sync/package.json`
- Create: `packages/sync/src/types.ts`
- Create: `packages/sync/src/store.ts`
- Create: `packages/sync/src/policy.ts`
- Create: `packages/sync/src/errors.ts`
- Create: `packages/sync/src/index.ts`
- Test: `packages/sync/src/__tests__/policy.test.ts`

**Interfaces:**

- Consumes: `StorageAdapter` from `@opennest/core`.
- Produces:
  - `SyncEntityType = "workspace" | "folder" | "file" | "note" | "tag"`
  - `SyncOperation = "create" | "update" | "delete" | "restore"`
  - `SyncMetaRow`, `SyncFieldMetaRow`, `SyncOutboxRow`, `WorkspaceSyncStateRow`, `SyncTombstoneRow`, `SyncConflictRow`, `SyncDeviceRow`
  - `SyncStore`
  - `SyncCapableStorage extends StorageAdapter` with `readonly sync: SyncStore`
  - `SyncHashEnvelope`, `SyncChange`, `PreparedSyncChange`, and `SyncStorageFactory`
  - `SyncPolicy`, `DEFAULT_SYNC_POLICY`, `MERGE_SAFE_FIELDS`, `fieldClass`, `canonicalIdList`
  - `SyncError`

- [ ] **Step 1: Write the failing policy test**

```ts
import { describe, expect, it } from "vitest";

import {
  DEFAULT_SYNC_POLICY,
  MERGE_SAFE_FIELDS,
  canonicalIdList,
  fieldClass,
} from "../index";

describe("sync policy", () => {
  it("keeps the outbox disabled and bounded", () => {
    expect(DEFAULT_SYNC_POLICY.outbox).toEqual({
      enabled: false,
      maxRows: 1000,
      retentionMs: 30 * 24 * 60 * 60 * 1000,
    });
  });

  it("pins the merge-safe field list", () => {
    expect([...MERGE_SAFE_FIELDS]).toEqual(["note.pinned", "tag.color"]);
  });

  it("classifies every other field as content-bearing", () => {
    expect(fieldClass("note", "pinned")).toBe("merge-safe");
    expect(fieldClass("tag", "color")).toBe("merge-safe");
    expect(fieldClass("note", "content")).toBe("content-bearing");
    expect(fieldClass("file", "name")).toBe("content-bearing");
  });

  it("canonicalizes relation ID arrays", () => {
    expect(canonicalIdList(["b", "a", "b"])).toEqual(["a", "b"]);
    expect(canonicalIdList(["a", "b"])).toEqual(canonicalIdList(["b", "a"]));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/vitest.mjs run packages/sync/src/__tests__/policy.test.ts`

Expected: FAIL because `packages/sync` does not exist.

- [ ] **Step 3: Implement the package and types**

Create `packages/sync/package.json`:

```json
{
  "name": "@opennest/sync",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "@opennest/core": "0.1.0" }
}
```

Run `npm install --ignore-scripts` once so npm links `@opennest/sync` into `node_modules/@opennest/sync`. Do not add external dependencies. Confirm `git diff package-lock.json` only adds the workspace entry.

In `types.ts`, define the seven row shapes with the exact fields from ADR 0012. Use ISO strings for timestamps and `number` for counters. Define `SyncConflictResolution = "local" | "remote" | "merged" | "copy"`.

In `store.ts`, define:

```ts
export interface SyncHashEnvelope {
  opId: string;
  workspaceId: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  fieldPatches: Record<string, unknown>;
}

export interface SyncChange {
  workspaceId: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  fieldPatches: Record<string, unknown>;
  at: string;
  contentHash: string | null;
  opId?: string;
}

export interface PreparedSyncChange extends SyncChange {
  opId: string;
  payloadHash: string | null;
}

export type SyncStorageFactory = (
  name?: string,
  policy?: SyncPolicy
) => Promise<SyncCapableStorage>;

export interface SyncStore {
  getOrCreateDevice(workspaceId: string, at: string): Promise<SyncDeviceRow>;
  getDevice(workspaceId: string, deviceId: string): Promise<SyncDeviceRow | null>;
  listDevices(workspaceId: string): Promise<SyncDeviceRow[]>;
  getWorkspaceState(
    workspaceId: string,
    deviceId: string
  ): Promise<WorkspaceSyncStateRow | null>;
  getOrCreateWorkspaceState(
    workspaceId: string,
    deviceId: string,
    at: string
  ): Promise<WorkspaceSyncStateRow>;
  putWorkspaceState(row: WorkspaceSyncStateRow): Promise<void>;
  hasRemoteTarget(workspaceId: string): Promise<boolean>;

  getEntityMeta(
    workspaceId: string,
    entityType: SyncEntityType,
    entityId: string
  ): Promise<SyncMetaRow | null>;
  listEntityMeta(workspaceId: string): Promise<SyncMetaRow[]>;
  putEntityMeta(row: SyncMetaRow): Promise<void>;

  getFieldMeta(
    workspaceId: string,
    entityType: SyncEntityType,
    entityId: string,
    fieldPath: string
  ): Promise<SyncFieldMetaRow | null>;
  listFieldMeta(workspaceId: string): Promise<SyncFieldMetaRow[]>;
  putFieldMeta(row: SyncFieldMetaRow): Promise<void>;

  appendOutbox(row: SyncOutboxRow): Promise<void>;
  listOutbox(workspaceId: string): Promise<SyncOutboxRow[]>;
  nextLocalSequence(workspaceId: string, deviceId: string): Promise<number>;
  deleteOutbox(opId: string): Promise<void>;

  getTombstone(
    workspaceId: string,
    entityType: SyncEntityType,
    entityId: string
  ): Promise<SyncTombstoneRow | null>;
  listTombstones(workspaceId: string): Promise<SyncTombstoneRow[]>;
  putTombstone(row: SyncTombstoneRow): Promise<void>;

  listConflicts(
    workspaceId: string,
    state?: "open" | "resolved"
  ): Promise<SyncConflictRow[]>;
  putConflict(row: SyncConflictRow): Promise<void>;
  resolveConflict(
    conflictId: string,
    input: {
      resolution: "local" | "remote" | "merged" | "copy";
      resolvedAt: string;
      resolvedByDeviceId: string;
    }
  ): Promise<SyncConflictRow>;

  clearWorkspace(workspaceId: string): Promise<void>;
}

export interface SyncCapableStorage extends StorageAdapter {
  readonly sync: SyncStore;
}
```

In `policy.ts`, define `SyncPolicy` as `{ outbox: { enabled: boolean; maxRows: number; retentionMs: number } }`. Export `DEFAULT_SYNC_POLICY`, `MERGE_SAFE_FIELDS`, `fieldClass(entityType, fieldPath): "merge-safe" | "content-bearing"`, and `canonicalIdList(ids): string[]`. Use `${entityType}.${fieldPath}` keys. `canonicalIdList` returns a new array, dedupes, and sorts ascending by raw ID string with the default `sort()` code unit order, never `localeCompare`, so input order never affects the stored value or hash.

In `errors.ts`, define `SyncError` with codes `"outbox_full"`, `"tombstoned_entity"`, `"invalid_sync_state"`, `"unsupported_resolution"`, and `"remote_target_present"`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/vitest.mjs run packages/sync/src/__tests__/policy.test.ts`

Expected: PASS, 4 tests.

---

### Task 3: Add canonical hashing and the atomic write recorder

**Files:**

- Create: `packages/sync/src/hash.ts`
- Create: `packages/sync/src/recorder.ts`
- Test: `packages/sync/src/__tests__/recorder.test.ts`

**Interfaces:**

- Consumes: `SyncStore`, `DEFAULT_SYNC_POLICY`, `SyncError`.
- Produces:
  - `canonicalJson(value: unknown): string`
  - `payloadHash(envelope: SyncHashEnvelope): Promise<string>`
  - `prepareSyncChanges(input: PrepareSyncChangesInput): Promise<PreparedSyncChange[]>`
  - `recordPreparedSyncChanges(store, input): Promise<{ workspaceRevision: number }>`
  - `recordSyncChanges(store, input): Promise<{ workspaceRevision: number }>` as the convenience path for non-Dexie callers

- [ ] **Step 1: Write failing recorder tests**

Cover these assertions in `recorder.test.ts` using a small in-test fake store:

```ts
it("bumps entity and workspace revisions once per batch", async () => {
  // Two changes in one batch share workspaceRevision 1.
  // Entity revisions both start at 1.
});

it("updates only changed field metadata on update", async () => {
  // create note with title and content, then update title.
  // title fieldRevision is 2, content stays 1, workspaceRevision is 2.
});

it("writes a tombstone and deletedAt on delete", async () => {
  // delete note after create.
  // active tombstone exists with the delete workspaceRevision.
});

it("writes no outbox rows when disabled", async () => {
  // default policy, create note, listOutbox is empty.
});

it("writes an immutable hashed outbox row when enabled", async () => {
  // enable outbox, create note, assert payloadHash is 64 lowercase hex chars.
  // Re-recording the same prepared change keeps the same payloadHash.
});

it("canonicalizes relation arrays before hashing", async () => {
  // prepare two changes with tagIds ["b","a"] and ["a","b"].
  // both fieldPatches are ["a","b"] and both payloadHash values match.
});

it("scopes localSequence per workspace and device", async () => {
  // workspace A first row is 1, next is 2.
  // the same device in workspace B also starts at 1.
});

it("rejects a batch spanning workspaces", async () => {
  // two changes with different workspaceId throw invalid_sync_state.
});

it("rejects a batch at the outbox cap", async () => {
  // enabled outbox with maxRows 1; second change throws outbox_full.
});

it("rejects a write to a tombstoned entity id", async () => {
  // create, delete, then update the same id throws tombstoned_entity.
});

it("reuses a provided workspace revision across batches", async () => {
  // record two batches with the same workspaceRevision.
  // the workspace state does not advance for the second batch.
});

it("prunes acknowledged outbox rows older than the retention window", async () => {
  // seed an acked row older than 30 days and a pending row.
  // the acked row is removed, the pending row remains.
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/vitest.mjs run packages/sync/src/__tests__/recorder.test.ts`

Expected: FAIL because `hash.ts` and `recorder.ts` do not exist.

- [ ] **Step 3: Implement canonical JSON and hashing**

`canonicalJson` sorts object keys recursively, rejects `undefined`, and preserves array order. `payloadHash` uses `crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(envelope)))` and returns lowercase hex. The `SyncHashEnvelope` contains `opId`, `workspaceId`, `entityType`, `entityId`, `operation`, and `fieldPatches`. Base revisions are stored metadata, not hashed, because they are only known after the transaction reads the current metadata. This runs before a Dexie transaction so no native transaction is held open across the digest.

Define `PrepareSyncChangesInput` as `{ changes: readonly SyncChange[]; policy?: SyncPolicy }`. `prepareSyncChanges` canonicalizes `tagIds` and `targetNoteIds` with `canonicalIdList`, assigns an `opId` when missing, and computes `payloadHash` only when the outbox is enabled. Canonicalization happens before hashing so input order cannot change the hash.

- [ ] **Step 4: Implement `recordPreparedSyncChanges`**

Inside the caller's existing transaction:

1. Reject a batch with more than one distinct `workspaceId` with `invalid_sync_state`; a batch owns one workspace revision. Ensure the device and workspace state. Reject with `invalid_sync_state` when the device is `revoked` or when its `lastAckedTombstoneWorkspaceRevision` is below the workspace `tombstoneFloor`.
2. Read all current entity metadata for the batch.
3. Read `lastLocalWorkspaceRevision`.
4. Capture `baseWorkspaceRevision = lastLocalWorkspaceRevision`, then allocate `nextWorkspaceRevision` once. When the caller passes `workspaceRevision`, reuse it and set `baseWorkspaceRevision = workspaceRevision - 1`. Otherwise set `nextWorkspaceRevision = baseWorkspaceRevision + 1` for a non-empty batch.
5. For each change, reject non-delete operations when an active tombstone exists.
6. Capture `baseEntityRevision` as the current entity revision or zero, then increment `entityRevision`.
7. For each changed field, increment `fieldRevision` from the current value or zero.
8. Upsert `sync_meta` and `sync_field_meta` with the same `nextWorkspaceRevision`.
9. On delete, set `sync_meta.deletedAt`, set `deletedAt` on every existing field row for that entity, and upsert an active tombstone.
10. Upsert the workspace state once with `lastLocalWorkspaceRevision = nextWorkspaceRevision`.
11. If outbox is enabled, first prune acknowledged rows older than `retentionMs`. Then append one row per change with `baseEntityRevision` and `baseWorkspaceRevision` from before the write, `state: "pending"`, `attempts: 0`, `ackedAt: null`, `createdAt: change.at`, and `deviceId` from the workspace state. Reject `payloadHash === null`, enforce `maxRows`, derive `localSequence` as `max(localSequence) + 1` scoped to `(workspaceId, change deviceId)` with a first value of 1, and fail closed with `outbox_full`.
12. If outbox is disabled, append nothing and do not prune.
13. Return `{ workspaceRevision: nextWorkspaceRevision }` or the unchanged revision for an empty batch.

`recordPreparedSyncChanges` must accept an optional `workspaceRevision` so an adapter can share one revision across every write inside `storage.transaction`. The adapters track it while `transactionDepth > 0` and reset it when the outer transaction ends.

`recordSyncChanges` calls `prepareSyncChanges` then `recordPreparedSyncChanges`. Dexie code must call the prepared pair so hashing stays outside the transaction.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node scripts/vitest.mjs run packages/sync/src/__tests__/recorder.test.ts`

Expected: PASS, at least 12 tests.

---

### Task 4: Implement the deterministic merge engine

**Files:**

- Create: `packages/sync/src/merge.ts`
- Test: `packages/sync/src/__tests__/merge.test.ts`

**Interfaces:**

- Consumes: `fieldClass`, `SyncEntityType`, `SyncConflictResolution`.
- Produces:
  - `compareFieldCandidates(local, remote): number`
  - `mergeFieldCandidate(entityType, fieldPath, local, remote): MergeOutcome`
  - `MergeOutcome` with `winner`, `conflict`, and the losing value

- [ ] **Step 1: Write failing merge tests**

```ts
it("merges independent fields without a conflict", () => {
  // local changes title, remote changes pinned.
  // Both results are kept by the caller.
});

it("picks a merge-safe winner by updatedAt then originDeviceId then opId", () => {
  // note.pinned and tag.color only.
});

it("creates a conflict for a content-bearing field and preserves the loser", () => {
  // note.content: winner is deterministic, conflict.remoteValue is never dropped.
});

it("preserves both content values under clock skew", () => {
  // local updatedAt is later but remote value still appears in conflict.
});

it("does not treat an unknown field as merge-safe", () => {
  // "note.futureField" is content-bearing.
});

it("canonicalizes relation arrays before comparing", () => {
  // tagIds ["b","a"] and ["a","b"] are the same value and do not conflict.
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/vitest.mjs run packages/sync/src/__tests__/merge.test.ts`

Expected: FAIL because `merge.ts` does not exist.

- [ ] **Step 3: Implement the order and outcome**

`compareFieldCandidates` compares `updatedAt` as ISO strings, then `originDeviceId`, then `opId`. A greater value wins. Equal values resolve to local. For `tagIds` and `targetNoteIds`, canonicalize both sides with `canonicalIdList` before comparing values or writing a conflict. `mergeFieldCandidate` returns `merge-safe` outcomes with no conflict. For content-bearing fields it returns the provisional winner and a conflict payload containing both values, revisions, op IDs, device IDs, and `createdAt`. An open conflict row stores the provisional winner in `resolution` (`local` or `remote`) with `state: "open"`; an explicit resolve updates both fields.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node scripts/vitest.mjs run packages/sync/src/__tests__/merge.test.ts`

Expected: PASS, 6 tests.

---

### Task 5: Add the memory store and two-device simulation harness

**Files:**

- Create: `packages/sync/src/testing.ts`
- Modify: `packages/sync/src/index.ts`
- Test: `packages/sync/src/__tests__/testing.test.ts`

**Interfaces:**

- Consumes: `SyncStore`, `recordSyncChanges`, `mergeFieldCandidate`.
- Produces:
  - `createMemorySyncStore(): SyncStore`
  - `simulateTwoDeviceMerge(input): Promise<{ conflicts: SyncConflictRow[] }>`
  - `seedDevice(store, workspaceId, deviceId, at): Promise<void>`

- [ ] **Step 1: Write failing harness tests**

```ts
it("merges independent fields from two devices", async () => {
  // device A changes note title, device B changes note pinned.
  // no conflict records.
});

it("deduplicates an outbox replay by opId", async () => {
  // replaying the same opId does not create a second effect.
});

it("preserves a same-field content conflict", async () => {
  // note.content conflict exists and both values are readable.
});

it("lists and resolves a conflict", async () => {
  // resolve local marks resolved with resolvedAt and resolvedByDeviceId.
});

it("rejects a stale device below the tombstone floor", async () => {
  // floor 5, device ack 4 throws invalid_sync_state.
});

it("does not claim a global workspace revision", async () => {
  // each device state keeps its own lastLocalWorkspaceRevision.
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/vitest.mjs run packages/sync/src/__tests__/testing.test.ts`

Expected: FAIL because `testing.ts` does not exist.

- [ ] **Step 3: Implement the memory store**

Use `Map` storage keyed by the same composite keys as the adapters. Keep one `installationDeviceId` in the store. `getOrCreateDevice` returns an existing workspace row or creates one with that installation ID, generating it only when the registry is empty. `getOrCreateWorkspaceState` derives the current maximum workspace revision when no row exists. `nextLocalSequence(workspaceId, deviceId)` returns the next value scoped to that pair. `resolveConflict` supports `local` and `remote`; `merged` and `copy` throw `SyncError("unsupported_resolution")`.

- [ ] **Step 4: Implement the simulation harness**

The harness accepts two device IDs, a workspace ID, and a list of field candidates per side. It runs `mergeFieldCandidate` for each shared field, writes independent changes, writes conflict rows for content-bearing losses, and returns the conflicts. It must not assign a global revision.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node scripts/vitest.mjs run packages/sync/src/__tests__/testing.test.ts`

Expected: PASS, 6 tests.

---

### Task 6: Add Dexie schema version 3, backfill, and SyncStore

**Files:**

- Modify: `packages/storage-dexie/package.json`
- Modify: `packages/storage-dexie/src/schema.ts`
- Create: `packages/storage-dexie/src/sync-store.ts`
- Modify: `packages/storage-dexie/src/storage.ts`
- Test: `packages/storage-dexie/src/__tests__/sync-store.test.ts`
- Test: `packages/storage-dexie/src/__tests__/sync-upgrade.test.ts`
- Modify: `packages/storage-dexie/src/__tests__/upgrade.test.ts`

**Interfaces:**

- Consumes: `SyncStore`, `SyncCapableStorage`, all row types.
- Produces: `createDexieStorage` returns `SyncCapableStorage`; `OpenNestDexie` has the seven sync tables; Dexie `verno === 3`; decimal `schemaVersion === 2`.

- [ ] **Step 1: Write the failing Dexie sync-store test**

```ts
it("creates a device and workspace state on init", async () => {
  // create workspace, init storage, assert storage.sync device and state.
});

it("round-trips entity, field, outbox, tombstone, and conflict rows", async () => {
  // put and read every row shape.
});

it("clears only the requested workspace", async () => {
  // two workspaces, clear one, the other remains.
});

it("scopes localSequence per workspace and device", async () => {
  // workspace A starts at 1, then 2; workspace B for the same device starts at 1.
});
```

- [ ] **Step 2: Write the failing upgrade test**

Seed a v2 database with a workspace, folder, file, note, tag, and blob using a plain `Dexie` instance that declares only the shipped version 2 stores. Close it, then open `createDexieStorage` and assert:

```ts
expect(storage.schemaVersion).toBe(2);
expect(reopened.verno).toBe(3);
expect(await reopened.table("sync_meta").count()).toBe(5);
expect(await reopened.table("workspace_sync_state").count()).toBe(1);
expect(await reopened.table("sync_devices").count()).toBe(1);
const state = await reopened.table("workspace_sync_state").toArray();
expect(state[0]!.deviceId).not.toBe("legacy");
const meta = await reopened.table("sync_meta").toArray();
expect(meta.every((row) => row.originDeviceId === state[0]!.deviceId)).toBe(true);
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `node scripts/vitest.mjs run packages/storage-dexie/src/__tests__/sync-store.test.ts packages/storage-dexie/src/__tests__/sync-upgrade.test.ts`

Expected: FAIL because the tables and `sync` property do not exist.

- [ ] **Step 4: Add desk schema and backfill**

Add `syncMeta`, `syncFieldMeta`, `syncOutbox`, `workspaceSyncState`, `syncTombstone`, `syncConflict`, and `syncDevices` table declarations to `OpenNestDexie`. Add version 3 stores:

```ts
syncMeta: "[workspaceId+entityType+entityId], [workspaceId+workspaceRevision]",
syncFieldMeta: "[workspaceId+entityType+entityId+fieldPath], [workspaceId+entityType+entityId]",
syncOutbox: "opId, &[workspaceId+deviceId+localSequence], [workspaceId+deviceId+state+localSequence]",
workspaceSyncState: "[workspaceId+deviceId]",
syncTombstone: "[workspaceId+entityType+entityId], [workspaceId+tombstoneWorkspaceRevision]",
syncConflict: "conflictId, [workspaceId+entityId+state]",
syncDevices: "[workspaceId+deviceId], [workspaceId+state]",
```

The version 3 upgrade reads existing workspaces, folders, files, notes, and tags, then bulk-adds `sync_meta` rows with `entityRevision: 1`, `workspaceRevision: 0`, `originDeviceId: "legacy"`, source `updatedAt` (or `createdAt` for tags), and null `deletedAt`. `contentHash` is the file checksum for files and null for every other entity. It adds one `workspace_sync_state` row per workspace with device `"legacy"`, zero revisions, null remote target, and null cursor. It does not add a `sync_devices` row for `"legacy"`, because `"legacy"` is a migration marker, not an installation.

- [ ] **Step 5: Implement the Dexie SyncStore**

Create `sync-store.ts` with `createDexieSyncStore(db: OpenNestDexie): SyncStore`. All methods use the shared `db` instance so the store participates in the ambient transaction. `getOrCreateDevice` returns the workspace device row. When that row is missing, it reads any existing device row across workspaces and reuses that installation ID; only an empty registry generates a new `generateId()`. `getOrCreateWorkspaceState` creates a zeroed row when missing. `hasRemoteTarget` checks `remoteWorkspaceId !== null`. `nextLocalSequence(workspaceId, deviceId)` reads the maximum `localSequence` for that pair and returns 1 when none exists.

- [ ] **Step 6: Wire the store into the adapter**

Add `"@opennest/sync": "0.1.0"` to `packages/storage-dexie/package.json` and add `@opennest/sync` to `apps/web/next.config.ts` `transpilePackages`. Add optional `syncPolicy?: SyncPolicy` to `DexieStorageOptions` and use `config.syncPolicy ?? DEFAULT_SYNC_POLICY`. Change `SCHEMA_VERSION` to `2` and `createDexieStorage` to return `SyncCapableStorage`. In the adapter object, add `sync: createDexieSyncStore(db)`. Add all seven tables to every `db.transaction` table list used by `transaction`, `reset`, and `restore`.

In `init`, after `db.open()`, determine the installation ID from any existing `sync_devices` row or generate it once. Then run one bootstrap transaction per workspace: ensure the workspace device row, rewrite `sync_meta.originDeviceId` from `"legacy"` to the real ID, create the real `workspace_sync_state` row, and delete the `"legacy"` state row. This is idempotent and leaves exactly one state row per workspace.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node scripts/vitest.mjs run packages/storage-dexie/src/__tests__/sync-store.test.ts packages/storage-dexie/src/__tests__/sync-upgrade.test.ts packages/storage-dexie/src/__tests__/upgrade.test.ts`

Expected: PASS. Update the existing upgrade test from `verno === 2` to `verno === 3` and `schemaVersion === 1` to `2`.

---

### Task 7: Add SQLite schema, migration, backfill, and SyncStore

**Files:**

- Modify: `packages/storage-sqlite/package.json`
- Modify: `packages/storage-sqlite/src/schema.ts`
- Create: `packages/storage-sqlite/migrations/0002_sync_sidecars.sql`
- Modify: `packages/storage-sqlite/migrations/meta/_journal.json`
- Create: `packages/storage-sqlite/migrations/meta/0002_snapshot.json`
- Create: `packages/storage-sqlite/src/sync-store.ts`
- Modify: `packages/storage-sqlite/src/storage.ts`
- Test: `packages/storage-sqlite/src/__tests__/sync-store.test.ts`
- Test: `packages/storage-sqlite/src/__tests__/sync-migrations.test.ts`
- Modify: `packages/storage-sqlite/src/__tests__/migrations.test.ts`

**Interfaces:**

- Consumes: `SyncStore`, `SyncCapableStorage`.
- Produces: `createSqliteStorage` returns `SyncCapableStorage`; migration count 3; backfilled metadata for all existing entities.

- [ ] **Step 1: Write the failing SQLite sync-store and migration tests**

```ts
it("round-trips every sidecar row", async () => {
  // put and read device, state, meta, field, outbox, tombstone, conflict.
});

it("backfills existing rows when migrating from version 2", async () => {
  // seed a v2 database with one of each entity, open storage, assert 5 sync_meta rows.
});

it("reports schemaVersion 3", async () => {
  expect(storage.schemaVersion).toBe(3);
});
```

Build the v2 fixture with a raw `DatabaseSync`: execute `0000_icy_living_mummy.sql` and `0001_fts5.sql`, then write the two `__drizzle_migrations` rows in the same shape the migrator uses. Seed one workspace, folder, file, note, and tag before opening `createSqliteStorage`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/vitest.mjs run packages/storage-sqlite/src/__tests__/sync-store.test.ts packages/storage-sqlite/src/__tests__/sync-migrations.test.ts`

Expected: FAIL because the tables and `sync` property do not exist.

- [ ] **Step 3: Add Drizzle tables**

Add the seven tables to `schema.ts` with the exact columns and indexes from ADR 0012. Use `primaryKey({ columns: [...] })` for composite keys and `uniqueIndex` for `sync_outbox(workspace_id, device_id, local_sequence)`. Add a non-unique index on `sync_outbox(workspace_id, device_id, state, local_sequence)`. Use `text` for timestamps and `integer` for revisions, uses, and attempts.

Do not add foreign keys from sidecar tables to core tables. A cascading workspace delete must not erase tombstones or metadata implicitly. `reset`, `clearWorkspace`, and explicit workspace deletion manage sidecars.

- [ ] **Step 4: Generate and edit the migration**

Run from `packages/storage-sqlite`: `node ../../node_modules/drizzle-kit/bin.cjs generate`

Expected: a new `0002_*.sql` migration and `0002_snapshot.json`. Rename the SQL file to `0002_sync_sidecars.sql` and update its `_journal.json` tag to match.

Append backfill statements to the migration:

```sql
INSERT INTO sync_meta (workspace_id, entity_type, entity_id, entity_revision, workspace_revision, origin_device_id, updated_at, deleted_at, content_hash)
SELECT id, 'workspace', id, 1, 0, 'legacy', updated_at, NULL, NULL FROM workspaces;
-- repeat for folders, notes using updated_at; files using updated_at and checksum as content_hash; tags using created_at and NULL content_hash.
INSERT INTO workspace_sync_state (workspace_id, device_id, remote_workspace_id, last_server_cursor, last_local_workspace_revision, tombstone_floor, last_full_resync_at)
SELECT id, 'legacy', NULL, NULL, 0, 0, NULL FROM workspaces;
```

The migration is additive and idempotent through Drizzle's migration ledger. Do not attempt to generate a device ID in SQL.

Do not wrap the `migrate(...)` call in another transaction. Drizzle's sync SQLite dialect already runs all pending migrations inside `BEGIN`/`COMMIT` and rolls back on failure, so an outer `BEGIN IMMEDIATE` would fail with a nested transaction. Verify that a failing 0002 leaves the prior schema readable.

- [ ] **Step 5: Implement the SQLite SyncStore**

Create `sync-store.ts` with `createSqliteSyncStore(getDb: () => SqliteDatabase): SyncStore`. Use Drizzle `insert(...).onConflictDoUpdate` for upserts. `getOrCreateDevice` reads the workspace device row, then any device row across workspaces, so one installation keeps one device ID across every workspace. `getOrCreateWorkspaceState` creates a zeroed row. `nextLocalSequence(workspaceId, deviceId)` reads the maximum sequence for that pair and returns 1 when none exists. `clearWorkspace` deletes every sidecar row for the workspace.

- [ ] **Step 6: Wire the store into the adapter**

Add `"@opennest/sync": "0.1.0"` to `packages/storage-sqlite/package.json`. Accept optional `syncPolicy` through a local `SqliteStorageOptions = SqliteStorageConfig & { syncPolicy?: SyncPolicy }` and use `config.syncPolicy ?? DEFAULT_SYNC_POLICY`. Do not change `SqliteStorageConfig` in core. Change `createSqliteStorage` to return `SyncCapableStorage` and add `sync`. In `init`, after opening the database, run the same bootstrap as Dexie inside one `atomic` call: determine the installation ID from any existing device row or generate it once, then for each workspace ensure its device row, rewrite `sync_meta.origin_device_id` from `'legacy'`, create the real `workspace_sync_state`, and remove the `'legacy'` state. Include sidecar tables in `reset` and `restore` cleanup.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node scripts/vitest.mjs run packages/storage-sqlite/src/__tests__/sync-store.test.ts packages/storage-sqlite/src/__tests__/sync-migrations.test.ts packages/storage-sqlite/src/__tests__/migrations.test.ts`

Expected: PASS. Update the existing migration test from count 2 to 3.

---

### Task 8: Record Dexie writes atomically

**Files:**

- Modify: `packages/storage-dexie/src/storage.ts`
- Test: `packages/storage-dexie/src/__tests__/sync-atomicity.test.ts`

**Interfaces:**

- Consumes: `prepareSyncChanges`, `recordPreparedSyncChanges`, `SyncStore`.
- Produces: every Dexie repository write records sidecars in the same IndexedDB transaction.

- [ ] **Step 1: Write the failing Dexie atomicity tests**

```ts
it("records create, update, and delete metadata", async () => {
  // note create: entityRevision 1 and field rows.
  // title update: entityRevision 2, title fieldRevision 2.
  // delete: sync_meta.deletedAt set and active tombstone.
});

it("records folder delete cascade patches in one workspace revision", async () => {
  // child folder, file, and note folderId become null.
  // all changed entities share one workspaceRevision.
});

it("records tag delete and note delete relation patches", async () => {
  // tag delete removes tagIds from tagged notes and files.
  // note delete updates inbound targetNoteIds.
});

it("canonicalizes relation arrays across reordered writes", async () => {
  // setTags with the same IDs in different order produces the same field value.
  // the outbox payload hash is identical when outbox is enabled.
});

it("writes no outbox rows with the default policy", async () => {
  expect(await storage.sync.listOutbox(workspace.id)).toEqual([]);
});

it("writes immutable outbox rows when enabled", async () => {
  // create with outbox enabled, assert one row, payloadHash 64 hex chars.
});

it("rolls back the entity write when the outbox is full", async () => {
  // create with outbox maxRows 0.
  // expect outbox_full and no note row.
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/vitest.mjs run packages/storage-dexie/src/__tests__/sync-atomicity.test.ts`

Expected: FAIL because repository writes do not record sidecars.

- [ ] **Step 3: Add the planned-change rule**

Before opening each write transaction, build a `SyncChange[]` from the input and any rows needed for cascade planning. Call `prepareSyncChanges` with the adapter policy. Inside the transaction, after the core write, call `recordPreparedSyncChanges`. For updates, include only fields present in the patch. For creates, include every synced field. For deletes, use an empty patch.

Use `requireAt(input.at)` for creates. For updates, use the same effective timestamp the adapter writes to the core row, `laterOf(requireAt(at), previous.updatedAt)`, so sync metadata does not move backwards. `TagRepository.update` has an optional `at`, so use `requireAt(patch.at)` for sync metadata even though the tag row has no `updatedAt`. `setTags`, `setLinks`, and every delete method have no `at`, so use one `new Date().toISOString()` per operation. Do not change the core ports to add timestamps.

The adapter keeps `currentWorkspaceRevision: number | null`. When `transactionDepth` goes from 0 to 1, reset it to null. Pass it to `recordPreparedSyncChanges` and store the returned revision after the first write. Reset it when the outer transaction ends. Repository writes that are not inside an outer transaction allocate their own revision.

Include all seven sidecar tables in every repository write transaction, including `ensureWorkspace`, note update, and every existing per-repository `db.transaction` call. Wrap repository writes that currently run outside `db.transaction` in one transaction with their core tables and all seven sidecar tables. Adding a sync write to a transaction whose table list omits a sidecar table fails at runtime.

When a prepare call runs inside an outer Dexie transaction (`transactionDepth > 0`), wrap it in `Dexie.waitFor(...)`. A bare `await` of a native promise such as `crypto.subtle.digest` inside an IndexedDB transaction can auto-commit it, so outbox hashing must keep the transaction alive through `Dexie.waitFor`.

- [ ] **Step 4: Record entity writes**

Modify these repository methods:

- `workspaces.create`, `workspaces.update`, `workspaces.delete`, `workspaces.ensureWorkspace`
- `folders.create`, `folders.update`, `folders.delete`
- `files.create`, `files.update`, `files.delete`, `files.setTags`
- `notes.create`, `notes.update`, `notes.delete`, `notes.setTags`, `notes.setLinks`
- `tags.create`, `tags.update`, `tags.delete`

Use these field sets:

```text
workspace: name
folder: name, parentId
file: name, folderId, mimeType, tagIds
note: title, content, folderId, pinned, tagIds, targetNoteIds
tag: name, color
```

Use domain values in patches, not storage representations: `note.pinned` is a boolean, and `tagIds` and `targetNoteIds` go through `canonicalIdList` so they are deduped and in ascending raw ID code unit order. File `contentHash` uses the file checksum when present. Other entities pass null. The adapter must not rely on dictionary or database return order for relation arrays.

- [ ] **Step 5: Handle cascade writes**

`folders.delete`: collect direct child folders, files, and notes before the transaction. After the core writes, record the folder delete plus `folderId: null` patches for each affected child.

`tags.delete`: collect affected file and note tag sets before the transaction. After deletion, record `tagIds` patches for each affected entity plus the tag tombstone.

`notes.delete`: collect inbound links before the transaction. After deletion, record `targetNoteIds` patches for each affected source note plus the note tombstone.

`workspaces.delete`: collect all workspace entities before the transaction. Record one batch with the workspace delete and every entity delete. Use a single workspace revision.

Every cascade patch uses the operation timestamp for `sync_meta.updatedAt` and `sync_field_meta.updatedAt`, and shares the operation's workspace revision.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node scripts/vitest.mjs run packages/storage-dexie/src/__tests__/sync-atomicity.test.ts`

Expected: PASS, at least 7 tests.

---

### Task 9: Handle Dexie reset and restore atomically

**Files:**

- Modify: `packages/storage-dexie/src/storage.ts`
- Test: `packages/storage-dexie/src/__tests__/sync-atomicity.test.ts`

**Interfaces:**

- Consumes: `SyncStore.hasRemoteTarget`, `prepareSyncChanges`, `recordPreparedSyncChanges`.
- Produces: reset and restore leave no stale sidecars; restore reinitializes device and backfills restored entities.

- [ ] **Step 1: Write the failing lifecycle tests**

```ts
it("clears every sidecar on reset", async () => {
  // create data, delete it, reset, all sync tables are empty.
});

it("clears stale tombstones and backfills restored entities", async () => {
  // restore a snapshot with a note that has no sidecars.
  // sync_meta exists for every restored entity, no active tombstones remain.
});

it("blocks restore when a remote target exists", async () => {
  // set remoteWorkspaceId, attempt restore, expect remote_target_present.
  // existing data and sidecars stay unchanged.
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/vitest.mjs run packages/storage-dexie/src/__tests__/sync-atomicity.test.ts`

Expected: FAIL because reset and restore do not manage sidecars.

- [ ] **Step 3: Implement reset**

Inside the existing reset transaction, clear all seven sidecar tables before clearing core tables. Do not recreate a workspace. The D1 data controls recreate the workspace after reset, and that create records fresh sync state.

- [ ] **Step 4: Implement restore**

Build prepared restore changes from the parsed snapshot before opening the transaction. Inside the transaction, first check `sync.hasRemoteTarget` for the current workspace and throw `SyncError("remote_target_present")` when true. Only after that check passes, clear all sidecars, write core data, then record one batch with `operation: "restore"` for every restored entity. Use `updatedAt` or `createdAt` as `at` and file checksums for `contentHash`. The guard and the restore writes share one IndexedDB transaction, so no writer can set a remote target between them.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node scripts/vitest.mjs run packages/storage-dexie/src/__tests__/sync-atomicity.test.ts`

Expected: PASS, at least 9 tests.

---

### Task 10: Record SQLite writes atomically

**Files:**

- Modify: `packages/storage-sqlite/src/storage.ts`
- Test: `packages/storage-sqlite/src/__tests__/sync-atomicity.test.ts`

**Interfaces:**

- Consumes: `prepareSyncChanges`, `recordPreparedSyncChanges`.
- Produces: every SQLite repository write records sidecars in the same transaction.

- [ ] **Step 1: Write the failing SQLite atomicity tests**

Use the same seven cases as Task 8, adapted to `createSqliteStorage`. The outbox-full test uses a policy with `maxRows: 0`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/vitest.mjs run packages/storage-sqlite/src/__tests__/sync-atomicity.test.ts`

Expected: FAIL because repository writes do not record sidecars.

- [ ] **Step 3: Wrap writes and record sidecars**

Every write method from Task 8 must run inside `atomic`. For writes that need current rows, read them and call `prepareSyncChanges` inside the `atomic` scope so cascade planning and writes share one boundary. `node:sqlite` does not auto-commit on `await`, and the write lock serializes writers. Call `recordPreparedSyncChanges` after the core write. Build changes from input before `atomic` only when no current rows are needed.

Use the same timestamp and transaction-revision rules as Task 8. `atomic` is re-entrant through `transactionDepth`; share `currentWorkspaceRevision` across every write inside one `atomic` scope and clear it when the scope ends. Repository writes that use their own `atomic` call allocate a new revision.

SQLite single-statement writes that previously ran outside `atomic` must now use it so the entity and sidecars commit together.

- [ ] **Step 4: Handle cascade writes**

Use the same field sets and cascade rules as Task 8. For folder delete, collect child rows before deletion. For tag delete, collect affected tag sets. For note delete, collect inbound links. For workspace delete, collect every entity and record one delete batch.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node scripts/vitest.mjs run packages/storage-sqlite/src/__tests__/sync-atomicity.test.ts`

Expected: PASS, at least 7 tests.

---

### Task 11: Handle SQLite reset and restore atomically

**Files:**

- Modify: `packages/storage-sqlite/src/storage.ts`
- Test: `packages/storage-sqlite/src/__tests__/sync-atomicity.test.ts`

**Interfaces:**

- Consumes: `SyncStore.hasRemoteTarget`, `prepareSyncChanges`, `recordPreparedSyncChanges`.
- Produces: reset and restore are atomic and leave no stale sidecars.

- [ ] **Step 1: Write the failing lifecycle tests**

Use the same three cases as Task 9 with SQLite.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/vitest.mjs run packages/storage-sqlite/src/__tests__/sync-atomicity.test.ts`

Expected: FAIL because reset and restore do not manage sidecars.

- [ ] **Step 3: Implement reset and restore**

In `reset`, delete every sidecar row for every workspace inside the existing transaction. In `restore`, prepare restore changes before the transaction. Inside the same `atomic` scope, check `hasRemoteTarget` first and throw `remote_target_present` when set, then clear sidecars, write core data, and record the restore batch. The guard and writes share one SQLite transaction.

SQLite restores blobs before the database transaction. If the database step fails, the existing orphan blob behavior remains unchanged for D2. Sidecars must roll back with the database. Do not add blob cleanup in this task. Task 13 records the limitation and the backlog item.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node scripts/vitest.mjs run packages/storage-sqlite/src/__tests__/sync-atomicity.test.ts`

Expected: PASS, at least 9 tests.

---

### Task 12: Add shared sync conformance and the write-cost benchmark

**Files:**

- Modify: `packages/storage-conformance/package.json`
- Create: `packages/storage-conformance/src/scenarios/sync.ts`
- Modify: `packages/storage-conformance/src/index.ts`
- Modify: `packages/storage-dexie/src/__tests__/conformance.test.ts`
- Modify: `packages/storage-sqlite/src/__tests__/conformance.test.ts`
- Create: `benchmarks/sync.bench.ts`

**Interfaces:**

- Consumes: `SyncCapableStorage`, `SyncStore`, `recordSyncChanges`.
- Produces: `runSyncConformance(name, create)` and a repeatable write-cost benchmark.

- [ ] **Step 1: Write the shared sync scenarios**

Create `sync.ts` exporting `registerSyncScenarios(create: SyncStorageFactory)` to match the existing scenario pattern. Add `runSyncConformance(name: string, create: SyncStorageFactory)` in `index.ts` that calls `describe(name, () => registerSyncScenarios(create))`. Cover:

```text
device and state bootstrap
entity and field metadata after create and update
one workspace revision per transaction
outbox disabled writes no rows
outbox enabled writes immutable rows with 64-char hashes
outbox localSequence is unique and monotonic per workspace and device
outbox cap failure rolls back the entity write
relation arrays canonicalize across reordered writes
tombstone on delete and rejected write after delete
conflict list and resolve
reset clears sidecars
restore clears stale sidecars and backfills
backup v1 restore remains accepted and creates fresh sidecars
restore remote guard and writes share one transaction
revision and metadata shapes match the contract
```

- [ ] **Step 2: Wire both adapters**

Export `runSyncConformance` from `storage-conformance/src/index.ts`. In each adapter conformance test, call `runSyncConformance` next to the existing `runStorageConformance`. The factory accepts the optional policy and forwards it to the adapter config, so outbox scenarios can request an enabled outbox without a second factory.

- [ ] **Step 3: Run the conformance tests**

Run: `node scripts/vitest.mjs run packages/storage-dexie/src/__tests__/conformance.test.ts packages/storage-sqlite/src/__tests__/conformance.test.ts`

Expected: PASS for both adapters.

- [ ] **Step 4: Add the benchmark**

Create `benchmarks/sync.bench.ts` measuring 500 note creates and 500 title updates with the default policy and with outbox enabled. Assert only that the run completes and report milliseconds per operation. Do not add a hard CI threshold.

- [ ] **Step 5: Run the benchmark**

Run: `node scripts/vitest.mjs run --config vitest.benchmark.config.ts benchmarks/sync.bench.ts`

Expected: PASS and printed timings for both policies.

---

### Task 13: Surface sidecars in the Privacy Center, document D2, and run final gates

**Files:**

- Modify: `packages/privacy/src/inventory.ts`
- Modify: `packages/privacy/src/__tests__/inventory.test.ts`
- Modify: `packages/localization/src/en.ts`
- Modify: `packages/localization/src/id.ts`
- Modify: `docs/sync-data-model.md`
- Modify: `docs/privacy-center.md`
- Modify: `docs/adr/0012-sync-compatible-data-model.md`
- Modify: `ROADMAP.md`
- Test: `apps/web/components/__tests__/privacy-center.test.tsx`

**Interfaces:**

- Consumes: all previous tasks.
- Produces: truthful inventory coverage and final D2 verification.

- [ ] **Step 1: Add inventory entries and failing tests**

Add entries with ids `sync-meta`, `sync-field-meta`, `sync-outbox`, `sync-devices`, `sync-state`, `sync-tombstones`, and `sync-conflicts`.

Use data class D1 for meta, field meta, devices, state, and tombstones. Use D2 for outbox and conflicts because they can contain note text, titles, names, and tag values. All are IndexedDB, excluded from backup v1, and retained `until-delete`. Set `deletedWithSource: false` for every sidecar entry because sidecars survive a source delete until an explicit reset or cleanup. Derive meta, field meta, outbox, and conflicts from `workspace`, `folders`, `files`, `notes`, and `tags`. Derive devices and state from `workspace`.

Add a test asserting every sidecar id appears exactly once and every entry has `includedInBackup: false`.

- [ ] **Step 2: Run the inventory test to verify it fails**

Run: `node scripts/vitest.mjs run packages/privacy/src/__tests__/inventory.test.ts`

Expected: FAIL because the sidecar entries are missing.

- [ ] **Step 3: Add the entries and localization**

Add English and Indonesian labels for all seven entries. Keep both catalogs at key parity. Update the Privacy Center test to assert one sidecar label and the backup exclusion text.

- [ ] **Step 4: Finish the documentation**

Expand `docs/sync-data-model.md` with the implemented file names, migration versions, outbox cap behavior, localSequence workspace and device scope, relation array canonicalization, the atomic restore guard, backup exclusions, and the fact that D2 makes no global order claim. Add a Known limitations entry: a failed SQLite restore may leave orphan blob files, cleanup is deferred, and the existing behavior is accepted for D2.

Update the inventory paragraph in `docs/privacy-center.md` to include the seven sidecar entries and state that none are included in backup v1.

Add `- [ ] Sync-compatible data model (local-only)` under Phase 4 if it is still missing, then mark it `[x]` only after every gate below passes. Add `- [ ] SQLite restore-failure orphan blob cleanup` under Phase 4 as backlog and leave it unchecked.

- [ ] **Step 5: Run the full verification**

Run each command and require exit 0:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run test:e2e
node scripts/vitest.mjs run --config vitest.benchmark.config.ts benchmarks/sync.bench.ts
```

Expected: all commands pass, both adapters pass sync conformance, D2 remains local-only, and no new network path exists.

---

## Self-Review

- Spec coverage: ADR 0012 sections for device identity, seven sidecars, revisions, outbox, tombstones, conflict policy, blobs, backups, migration, atomicity, and both adapters each map to a task.
- Gate coverage: G-12-1, G-12-2, G-12-3, G-12-4, and G-12-6 decisions are recorded in Task 1 and tested in Tasks 2 to 12. G-12-5, G-12-7, and G-12-8 stay open as required.
- Type consistency: `SyncStore`, `SyncCapableStorage`, `SyncChange`, `PreparedSyncChange`, `prepareSyncChanges`, and `recordPreparedSyncChanges` keep the same names across all tasks.
- Review focus: cascade writes, populated migrations, outbox caps, restore guards, and clock-skew preservation each have a failing test before implementation.
- Canonicalization: relation arrays use one helper, one sort order, and tests prove reordered input does not change the hash or create a conflict.
- Sequence scope: `localSequence` is unique and monotonic per workspace and device, with a test that the same device can restart at 1 in another workspace.
- Restore guard: `hasRemoteTarget` and the restore writes share one transaction in both adapters, so no write can slip between the check and the clear.
- Known limitation: failed SQLite restore can leave orphan blobs for D2, documented in the data model and tracked in the roadmap backlog.
- Scope control: no network, auth, server, CRDT, E2EE, AI, extension, conflict UI, or core contract change is included.
