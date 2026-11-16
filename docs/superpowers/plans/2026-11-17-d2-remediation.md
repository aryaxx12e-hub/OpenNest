# D2 Remediation Implementation Plan

> **For the implementing agent:** Use `test-driven-development`. Write the failing test first, then the smallest implementation, then refactor. Do not reset, stash, or discard the existing D1/D2 working tree.

**Goal:** Close the D2 audit blockers in ADR 0012 without weakening the local-only sync contract or backup v1 compatibility.

**Architecture:** Keep `last_local_sequence` on `workspace_sync_state` as the per-workspace/device high-water mark. Outbox rows stay append-only. Entity writes and sidecar writes share one transaction. Restore never writes blobs before the remote-target guard.

**Tech Stack:** TypeScript strict, Dexie/IndexedDB, SQLite via `node:sqlite` and Drizzle, Vitest, shared storage conformance.

---

## Milestone 1: High-water sequence

### Task 1: Core contract and memory store

**Files:**

- Modify: `packages/sync/src/types.ts`
- Modify: `packages/sync/src/store.ts`
- Modify: `packages/sync/src/testing.ts`
- Test: `packages/sync/src/__tests__/testing.test.ts`
- Test: `packages/sync/src/__tests__/recorder.test.ts`

- [x] Add `lastLocalSequence: number` to `WorkspaceSyncStateRow`.
- [x] Change `nextLocalSequence` to read the state high-water and return `lastLocalSequence + 1`.
- [x] Make the memory `appendOutbox` insert-only and advance the state high-water when a row is appended.
- [x] Initialize new state rows with `lastLocalSequence: 0`.
- [x] Update all test fixtures that construct `WorkspaceSyncStateRow`.
- [x] Add tests for append, delete, next sequence monotonicity, and duplicate `opId` rejection.
- [x] Run `node scripts/vitest.mjs run packages/sync/src/__tests__/testing.test.ts packages/sync/src/__tests__/recorder.test.ts`.

### Task 2: Recorder allocation

**Files:**

- Modify: `packages/sync/src/recorder.ts`
- Test: `packages/sync/src/__tests__/recorder.test.ts`

- [x] Allocate outbox sequences from `state.lastLocalSequence`, not from remaining outbox rows.
- [x] Persist the last allocated sequence in the same `putWorkspaceState` call that updates the workspace revision.
- [x] Keep duplicate `opId` filtering before append.
- [x] Add a test that records a change, deletes the outbox row, then records again and gets the next sequence.

### Task 3: Dexie v4 migration

**Files:**

- Modify: `packages/storage-dexie/src/schema.ts`
- Modify: `packages/storage-dexie/src/storage.ts`
- Modify: `packages/storage-dexie/src/sync-store.ts`
- Test: `packages/storage-dexie/src/__tests__/sync-upgrade.test.ts`
- Test: `packages/storage-dexie/src/__tests__/upgrade.test.ts`
- Test: `packages/storage-dexie/src/__tests__/sync-store.test.ts`

- [x] Bump the Dexie engine schema to version 4 and backfill `lastLocalSequence` from `MAX(sync_outbox.localSequence)` per `(workspaceId, deviceId)`.
- [x] Preserve `legacy.lastLocalSequence` when `bootstrapSync` replaces the legacy state row.
- [x] Bump `SCHEMA_VERSION` from 2 to 3.
- [x] Make `appendOutbox` use `add`, reject duplicates, and advance high-water.
- [x] Make `putWorkspaceState` persist `lastLocalSequence`.
- [x] Update schemaVersion and verno expectations.
- [x] Add an upgrade test seeded with outbox sequence 4 and state 0; assert the upgraded state is 4 and `nextLocalSequence` is 5.

### Task 4: SQLite 0003 migration

**Files:**

- Modify: `packages/storage-sqlite/src/schema.ts`
- Add: `packages/storage-sqlite/migrations/0003_sync_high_water.sql`
- Modify: `packages/storage-sqlite/migrations/meta/_journal.json`
- Modify: `packages/storage-sqlite/src/storage.ts`
- Modify: `packages/storage-sqlite/src/sync-store.ts`
- Test: `packages/storage-sqlite/src/__tests__/migrations.test.ts`
- Test: `packages/storage-sqlite/src/__tests__/sync-migrations.test.ts`
- Test: `packages/storage-sqlite/src/__tests__/sync-store.test.ts`

- [x] Add `last_local_sequence integer NOT NULL DEFAULT 0` to `workspace_sync_state`.
- [x] Backfill from `MAX(sync_outbox.local_sequence)` scoped by workspace and device.
- [x] Append migration journal entry 3.
- [x] Preserve `legacy.lastLocalSequence` during `bootstrapSync`.
- [x] Make `appendOutbox` use insert, reject duplicates, and advance high-water.
- [x] Make `putWorkspaceState` persist `lastLocalSequence`.
- [x] Update schemaVersion expectations from 3 to 4.
- [x] Add a migration test that seeds a v3 database with outbox sequence 4 and state 0; assert the migrated state is 4 and `nextLocalSequence` is 5.
- [x] Verify the migration still rolls back atomically.

## Milestone 2: Per-workspace revisions and transaction safety

### Task 5: Per-workspace revision tracking

**Files:**

- Modify: `packages/storage-dexie/src/storage.ts`
- Modify: `packages/storage-sqlite/src/storage.ts`
- Test: `packages/storage-dexie/src/__tests__/sync-atomicity.test.ts`
- Test: `packages/storage-sqlite/src/__tests__/sync-atomicity.test.ts`

- [x] Replace `currentWorkspaceRevision` with a map keyed by `workspaceId`.
- [x] Clear the map at the outer transaction boundary and update only the batch workspace.
- [x] Add a test that writes workspace A and workspace B in the same outer transaction; each workspace revision advances independently.

### Task 6: Nested rollback

**Files:**

- Modify: `packages/storage-dexie/src/storage.ts`
- Modify: `packages/storage-sqlite/src/storage.ts`
- Test: `packages/storage-dexie/src/__tests__/sync-atomicity.test.ts`
- Test: `packages/storage-sqlite/src/__tests__/sync-atomicity.test.ts`

- [x] Dexie: abort the outer transaction when a nested sync write fails so a caught error cannot commit an entity without sidecars.
- [x] SQLite: use `SAVEPOINT` / `ROLLBACK TO` for nested `atomic` calls.
- [x] SQLite: serialize nested savepoint writes so concurrent nested writes cannot release each other's savepoints.
- [x] Add tests where an inner write fails and the caller catches the error; the outer transaction must not commit the entity.

## Milestone 3: Restore and checksum correctness

### Task 7: Restore guard and high-water preservation

**Files:**

- Modify: `packages/storage-dexie/src/storage.ts`
- Modify: `packages/storage-sqlite/src/storage.ts`
- Test: `packages/storage-dexie/src/__tests__/sync-atomicity.test.ts`
- Test: `packages/storage-sqlite/src/__tests__/sync-atomicity.test.ts`

- [x] SQLite: check `hasRemoteTarget` before writing any blob, and keep the in-transaction check.
- [x] Preserve the installation device and target workspace high-water across restore.
- [x] Add a test that a blocked restore leaves an existing blob byte-for-byte unchanged.
- [x] Add a restore test that keeps the next sequence above the pre-restore high-water for the same workspace.

### Task 8: File checksum on tag delete

**Files:**

- Modify: `packages/storage-dexie/src/storage.ts`
- Modify: `packages/storage-sqlite/src/storage.ts`
- Test: `packages/storage-dexie/src/__tests__/sync-atomicity.test.ts`
- Test: `packages/storage-sqlite/src/__tests__/sync-atomicity.test.ts`

- [x] Replace `contentHash: null` in the tag-delete file cascade with the file's existing checksum.
- [x] Add a test that deletes a tag attached to a file and asserts the file metadata keeps its checksum.

## Milestone 4: Conformance and verification

### Task 9: Shared conformance

**Files:**

- Modify: `packages/storage-conformance/src/scenarios/sync.ts`
- Test: `packages/storage-dexie/src/__tests__/conformance.test.ts`
- Test: `packages/storage-sqlite/src/__tests__/conformance.test.ts`

- [x] Cover per-workspace revisions.
- [x] Cover high-water after outbox deletion.
- [x] Cover immutable duplicate rejection.
- [x] Cover restore high-water and blocked-restore blob safety.
- [x] Run both conformance suites.

### Task 10: Full verification

- [x] `npm run typecheck`
- [x] `node scripts/vitest.mjs run`
- [x] `npm run build`
- [x] Update `docs/adr/0012-sync-compatible-data-model.md`, `docs/sync-data-model.md`, and `ROADMAP.md` with the actual fixed status.
- [x] Report remaining limitations, especially orphan blob cleanup.

## Verification (2026-11-16)

- `npm run typecheck`: pass.
- `npm test`: 955 tests pass across 71 files; browser dependency graph clean.
- Follow-up audit added revoked-device, up-to-date-floor, and compacted-tombstone regression tests.
- `npm run lint`: pass.
- `npm run build`: pass; Next.js static pages and PWA service worker generated.
