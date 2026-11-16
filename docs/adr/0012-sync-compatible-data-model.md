# ADR 0012: Sync-compatible data model

- Status: Accepted
- Date: 2026-11-14
- Context: Stage D0 Privacy and Extensibility
- Related: ADR 0003, ADR 0004, ADR 0005, ADR 0008, ADR 0009, ADR 0013
- Product conflict: schema expansion approved for Stage D2 by the D0 decision pack
- Targeted revision: pass 4 applied 2026-11-16 for D2 audit remediation; G-12-1 is closed

## Context and problem

OpenNest currently has one local workspace, stable UUIDs, and no server API. It
has no device identity, per-record or per-field revision, tombstone, outbox,
device registry, or conflict record. Future sync between devices, OpenNest Cloud,
and self-hosted storage needs a model that can merge changes without breaking
local-first behavior.

D2 is the sync-compatible data model milestone in the Stage D0 sequence.

Implementing sync later without preparation would require invasive migrations and
would make conflict handling harder to test.

## Goals

- Prepare the data model for future sync.
- Keep the current application fully local and offline.
- Avoid breaking Stage B contracts.
- Define deterministic conflict behavior.
- Keep backup v1 readable.

## Non-goals

- Implement a sync protocol.
- Implement authentication or tenant management.
- Implement real-time collaboration.
- Implement CRDT.
- Build a server.

## Constraints

- Local-first remains the default.
- Cloud must not become required.
- Dexie and SQLite must remain equivalent.
- Backup v1 must remain readable.
- No Stage B port or entity contract changes without approval.
- No sync network code in D2.

## Alternatives considered

1. Do nothing until sync is implemented. Rejected because migrations and conflict
   handling become much more expensive later.
2. Store only `updatedAt`. Rejected because it loses concurrent changes and has a
   weak conflict story.
3. Add sidecar sync metadata, per-field revisions, an outbox, tombstones, and
   conflict records. Recommended.
4. Introduce a full CRDT now. Rejected as overkill for note and file sync.
5. Turn the application into an event-sourced system. Rejected as too invasive.
6. Use immutable operation patches as the primary model. Rejected because it needs
   compaction and replay policy before D2 can remain local. The outbox still
   stores immutable patches for replay, but entity state stays in the existing
   tables.

## Decision

### Device identity and registration

- Generate a random `deviceId` per installation.
- It identifies a device, not a user.
- It is stored locally and excluded from default backups.
- A local `sync_devices` registry records `workspaceId`, `deviceId`,
  `registeredAt`, `lastSeenAt`, `lastAckedTombstoneWorkspaceRevision`, `state`,
  and an optional `publicKey` reserved for future authentication.
- `state` is `active`, `stale`, or `revoked`.
- D2 does not implement a server roster or device authentication. The future
  authentication ADR must define how a device identity becomes trustworthy.
- A device with an untrusted, revoked, or corrupt identity cannot push incremental
  operations. It must re-register and perform a full resync.

### Sidecar tables

`sync_meta`:

- `workspaceId`
- `entityType`
- `entityId`
- `entityRevision` (monotonic per entity)
- `workspaceRevision` (workspace-scoped counter at last write; local in D2)
- `originDeviceId`
- `updatedAt`
- `deletedAt` nullable
- `contentHash` nullable
- Primary key `(workspaceId, entityType, entityId)`.
- Index `(workspaceId, workspaceRevision)`.

`sync_field_meta`:

- `workspaceId`
- `entityType`
- `entityId`
- `fieldPath`
- `fieldRevision` (local monotonic per field)
- `workspaceRevision` (workspace counter at last field write; local in D2)
- `originDeviceId`
- `updatedAt`
- `deletedAt` nullable
- Primary key `(workspaceId, entityType, entityId, fieldPath)`.
- Index `(workspaceId, entityType, entityId)`.

`sync_outbox`:

- `opId` (unique idempotency key)
- `workspaceId`
- `entityType`
- `entityId`
- `operation` (`create`, `update`, `delete`, `restore`)
- `baseEntityRevision`
- `baseWorkspaceRevision`
- `fieldPatches` (immutable payload; canonical JSON, or ciphertext under E2EE)
- `payloadHash` (hash of the stored payload representation)
- `createdAt`
- `deviceId`
- `localSequence` (monotonic per workspace and device, starting at 1)
- `attempts`
- `state` (`pending`, `in_flight`, `retry`, `acked`, `failed`)
- `ackedAt` nullable
- Primary key `opId`.
- Unique `(workspaceId, deviceId, localSequence)`.
- Index `(workspaceId, deviceId, state, localSequence)`.
- A sequence may repeat for the same device in a different workspace.

`workspace_sync_state`:

- `workspaceId`
- `deviceId`
- `remoteWorkspaceId`
- `lastServerCursor`
- `lastLocalWorkspaceRevision`
- `lastLocalSequence` (highest outbox sequence allocated for this workspace and device; never decreases)
- `tombstoneFloor` (minimum acknowledged workspace revision for incremental push)
- `lastFullResyncAt` nullable
- Primary key `(workspaceId, deviceId)`.

`sync_tombstone`:

- `tombstoneId`
- `workspaceId`
- `entityType`
- `entityId`
- `deletedAt`
- `deletedByDeviceId`
- `tombstoneWorkspaceRevision` (workspace counter; local in D2)
- `state` (`active`, `compacted`)
- `compactedAt` nullable
- Primary key `(workspaceId, entityType, entityId)`.
- Index `(workspaceId, tombstoneWorkspaceRevision)`.

`sync_conflict`:

- `conflictId`
- `workspaceId`
- `entityType`
- `entityId`
- `fieldPath`
- `localFieldRevision`
- `remoteFieldRevision`
- `localOpId`
- `remoteOpId`
- `localValue` (value or encrypted envelope)
- `remoteValue` (value or encrypted envelope)
- `localDeviceId`
- `remoteDeviceId`
- `createdAt`
- `state` (`open`, `resolved`)
- `resolution` (`local`, `remote`, `merged`, `copy`)
- `resolvedAt` nullable
- `resolvedByDeviceId` nullable
- Primary key `conflictId`.
- Index `(workspaceId, entityId, state)`.

`sync_devices`:

- `workspaceId`
- `deviceId`
- `registeredAt`
- `lastSeenAt`
- `lastAckedTombstoneWorkspaceRevision` (workspace revision)
- `state` (`active`, `stale`, `revoked`)
- `publicKey` nullable, reserved for future authentication
- Primary key `(workspaceId, deviceId)`.
- Index `(workspaceId, state)`.

The sidecar design keeps the current domain entities and ports unchanged. It is
an additive storage concern, not a new core contract. All sidecar tables are
workspace-scoped and use explicit composite keys so Dexie and SQLite stay
equivalent.

### Revision authority

- `entityRevision` and `fieldRevision` are local monotonic counters.
- `workspaceRevision` is a workspace-scoped counter. In D2 it is local to one
  device because no sync authority exists. The counter lives in
  `workspace_sync_state.lastLocalWorkspaceRevision` and increments once per
  transaction.
- D2 does not claim a global order across devices. The future sync authority must
  assign the canonical workspace revision, or the model must switch to a
  per-device vector for `tombstoneFloor`.
- Local tombstone checks are valid in D2. Cross-device tombstone and replay checks
  are not claimed until that authority decision is approved.

### Sync data classification

- `sync_meta`, `sync_field_meta`, `sync_tombstone`, `sync_devices`, and
  `workspace_sync_state` are metadata.
- `sync_outbox.fieldPatches` and `sync_conflict.localValue` and `remoteValue` may
  contain user content. They inherit the content data class.
- Under E2EE, content-bearing outbox patches and conflict values must be encrypted
  or reference an encrypted snapshot. They are not plaintext sync metadata.
- File bytes are never stored in the outbox or conflict table. Only content hashes
  are stored.
- `contentHash` is computed over the stored representation. Under E2EE it must not
  be an unkeyed hash of plaintext content that enables confirmation attacks. Use a
  ciphertext hash or a keyed hash.

### Ownership and tenancy

`ownerId` belongs at the future sync boundary, not in the current core domain.
Authentication, account identity, and tenant isolation require a separate ADR.
This ADR does not introduce a mandatory account.

A `deviceId` is not an authentication credential. No table in this ADR grants
access based on `deviceId` alone.

### Atomicity and transactions

- Every local write that changes synced state updates the entity, `sync_meta`,
  `sync_field_meta`, and inserts the outbox row in one transaction.
- The transaction boundary covers every table involved in that write. Dexie uses
  one read-write transaction. SQLite uses one transaction.
- If any step fails, the whole write rolls back. There is no entity or workspace
  revision bump without an outbox row and no outbox row without the entity change.
- Outbox retries never mutate `fieldPatches`. They reuse the same `opId` and
  payload.
- Migration batches follow the same rule. A failed batch leaves the previous
  database state readable.
- Rollback tests inject a failure at each step and verify that no partial state is
  committed.

### Replayable outbox

- The outbox payload is the immutable field patch, not a second copy of the whole
  entity.
- For notes and metadata, the patch contains only changed fields. For file bytes,
  it contains the content hash and metadata.
- `payloadHash` is SHA-256 over the stored operation envelope, including
  `fieldPatches`. It detects corruption, not forgery.
- Base revisions are the values before the operation. A retry reuses the same
  `opId` and payload. The receiver deduplicates by `opId`.
- "Retry" here means network retransmission of the stored payload. It does not
  re-encrypt or generate a new CEK. A content rewrite is a new operation with a
  fresh CEK under ADR 0013.
- Per-device ordering uses `localSequence`. Per-entity causal ordering uses
  `baseEntityRevision`. Per-workspace ordering uses `baseWorkspaceRevision`. Ties
  use `opId`.
- Per-workspace order is local in D2. Cross-device order requires the future
  revision authority and is not claimed now.
- Retries use bounded exponential backoff and a maximum attempt count. Failure
  remains visible and never silently drops the operation.
- Outbox rows are retained until acknowledged or until a bounded retention policy
  expires. The retention policy is gate G-12-1.
- When sync is disabled, outbox creation is disabled or locally bounded. It must
  not grow without limit.
- File bytes and duplicate whole entities are never stored in the outbox.

### Tombstones and deletion

- A delete writes a tombstone in `sync_tombstone` and sets `sync_meta.deletedAt`
  in the same transaction.
- `tombstoneWorkspaceRevision` advances on the workspace revision authority. In D2
  that authority is the local device.
- Active devices acknowledge cumulatively through
  `sync_devices.lastAckedTombstoneWorkspaceRevision`, which is a workspace revision.
- A tombstone may be compacted only when all active devices have acknowledged it
  and the approved retention window has elapsed.
- The retention window is gate G-12-2. Until D2 approves a value, compaction is
  disabled by default.
- Compaction removes tombstone payloads through the highest compacted revision and
  sets `tombstoneFloor` to that revision. The floor prevents resurrection.
- Once a sync authority exists, a device with
  `lastAckedTombstoneWorkspaceRevision < tombstoneFloor` cannot push incremental
  operations. It must full resync from a snapshot at or after the floor.
- A write that targets a tombstoned entity ID is rejected. The floor is a
  device-level gate for stale devices, not a per-operation filter.
- For local D2 writes, the device-level gate is always satisfied because there is
  one active local device. A future sync authority must define the remote gate.
- A deleted entity ID is never recreated. New content receives a new ID.
- A device offline beyond the approved stale threshold is marked `stale` and must
  full resync. The threshold is gate G-12-2, so no automatic stale marking happens
  until D2 approves it.
- A revoked or untrusted device is rejected. Its operations do not advance the
  floor. Authentication remains a future ADR.
- If device identity or sync state is untrustworthy, fail closed and require a
  full resync.
- Hard deletion of tombstoned content is allowed only after the floor and
  retention conditions are met.

### Conflict policy

- The model uses per-field revision metadata. It does not claim entity-level
  last-write-wins for fields.
- Fields are classified as `merge-safe` or `content-bearing`. The exact field list
  is gate G-12-3 and is defined in D2.
- `merge-safe` covers low-stakes operational metadata such as `isPinned`,
  `sortOrder`, `color`, and `archived`.
- `content-bearing` covers note body, titles, file names, file bytes, and tags.
  These are never silently overwritten.
- Independent fields merge independently using `sync_field_meta`.
- `tagIds` and `targetNoteIds` are canonical ID arrays with duplicates removed and
  ascending code unit order by raw ID string using the default `sort()`, never
  `localeCompare`. Product order has no meaning. Adapters, hashing, and conflict
  comparison use the canonical form, so different input order cannot create a
  false conflict.
- Same-field comparison order is `updatedAt`, then `originDeviceId`, then `opId`.
  The order is deterministic, but wall-clock timestamps are not trusted for
  correctness.
- For a same-field `merge-safe` conflict, the total order picks the winner. The
  losing value may be discarded because the field is explicitly low-stakes.
- For a same-field `content-bearing` conflict, the total order picks a provisional
  winner. The losing value is preserved in `sync_conflict`. It is never silently
  discarded.
- A conflict record may be resolved as local, remote, merged, or copy. Conflict UX
  is gate G-12-4 and is deferred to D2.
- Concurrent offline changes are allowed. Each device writes locally and queues an
  outbox patch. On merge, independent fields combine and same-field content
  conflicts produce conflict records.
- If clocks are skewed, a merge-safe field may choose the wrong winner.
  Content-bearing fields still preserve both values.
- No CRDT in this phase.

### Blobs

- Blob bytes are immutable and content-addressed.
- Blob metadata is mutable and follows the field conflict policy.
- Blob bytes are not stored in the outbox or conflict table. Only content hashes
  are stored.
- A future sync layer may upload a blob by checksum and skip duplicates.

### Backups

- Backup v1 remains user content only.
- Device IDs, sync metadata, field metadata, outbox rows, sync cursors, tombstones,
  conflict records, and device registry rows are excluded.
- A future backup format may include sync state only with explicit user consent and
  after outbox and conflict compaction.
- Restoring another device's identity is never implicit.
- Restoring backup v1 into a synced workspace is not supported without a full
  resync and tombstone reconciliation. It must not silently reintroduce deleted
  IDs.
- A backup must not include device private keys, outbox payloads, or unresolved
  conflict values by default.

### D2 implementation status

D2 implements the local-only portion in `packages/sync` and both adapters. Dexie
uses engine schema version `4` with decimal `SCHEMA_VERSION` `3`. SQLite uses
migrations through `0003_sync_high_water.sql`; the migration count is `4`. Both
adapters create the seven sidecars, backfill existing rows, bootstrap one
installation device, and record entity, field, tombstone, and outbox state in the
entity write transaction. `workspace_sync_state.last_local_sequence` stores the
per-workspace and per-device outbox high-water mark.

- G-12-1: outbox disabled by default. When enabled, `maxRows` caps all outbox rows
  and the retention window prunes acknowledged rows. A full outbox throws
  `outbox_full` and rolls back the entity write. This gate is closed: append is
  insert-only, `localSequence` is allocated from the persisted high-water mark,
  and pruning or deleting rows cannot reuse a sequence.
- G-12-2: tombstones are written; compaction and automatic stale marking stay
  disabled. Implemented for D2.
- G-12-3: exactly `note.pinned` and `tag.color` are merge-safe. Implemented.
- G-12-4: conflict records list and resolve local or remote values; merged and copy
  return `unsupported_resolution` until the conflict UI gate. Implemented for D2;
  no conflict UI is claimed.
- G-12-6: `updatedAt`, then `originDeviceId`, then `opId`; content-bearing losers are
  always preserved. Implemented.
- G-12-5, G-12-7, and G-12-8 remain open. D2 makes no remote sync, global order, or
  restore-into-synced-workspace claim.

### D2 audit remediation (2026-11-16)

The 2026-11-15 audit found six blockers. All six are fixed and covered by
regression and shared conformance tests:

1. Workspace revisions are tracked per workspace in one transaction, so writing
   another workspace cannot move a workspace's revision backwards.
2. SQLite migration batches run in `BEGIN IMMEDIATE` and roll back atomically when
   any statement fails.
3. A caught nested write failure cannot commit an entity without sidecars. Dexie
   aborts the outer transaction; SQLite rolls back the inner savepoint and
   serializes nested savepoint writes.
4. SQLite checks for a remote target before writing any blob and rechecks inside
   the database transaction. A blocked restore leaves existing blobs unchanged.
5. Deleting a tag preserves each affected file's checksum in the sync metadata.
6. Conformance now covers per-workspace revisions, reset and restore sidecars,
   outbox immutability, high-water after deletion, restore high-water, and
   blocked-restore blob safety.

A follow-up audit found one additional local tombstone gap: the recorder rejected
only active tombstones, so a compacted tombstone could be recreated. It now rejects
any tombstone row for the entity ID. Regression tests cover a revoked device, an
up-to-date device at or above the floor, and a compacted-tombstone write.

Residual limitations remain. SQLite restore's pre-check is not atomic with the
later blob writes, so a future remote writer could still race the guard; the
in-transaction recheck limits the window. An interrupted restore can still leave
orphan blob files or stale `.tmp` files. Cleanup remains backlog in `ROADMAP.md`.

## Trade-offs

- Per-field metadata adds rows and write cost.
- Outbox patches duplicate changed fields until acknowledgement.
- Conflict records duplicate content until resolution.
- Device registry and tombstone floor add lifecycle work.
- Retention, compaction, and stale thresholds remain gated.
- Field-level merge requires maintaining a field classification list.
- Conflict UX needs design work.
- Sync protocol, authentication, server behavior, and canonical revision authority
  remain gated.

## Security and privacy implications

- Sync metadata can leak device and activity information.
- Outbox patches and conflict values may contain content and inherit the content
  data class. Under E2EE they must be encrypted.
- A malicious server can replay or reorder operations. Idempotent `opId`,
  `baseWorkspaceRevision`, and `tombstoneFloor` mitigate some cases once a
  canonical revision authority exists. D2 has no server. Authentication and
  rollback protection remain future work.
- Device impersonation requires future authentication.
- E2EE protects content, not metadata by default.
- Tombstones can reveal that a record existed.
- Clock skew can misorder merge-safe fields. Content fields preserve both values.
- Conflict records increase content exposure until resolved.

## Compatibility with Stages A to C

- Sidecar tables avoid changing core domain entities.
- Dexie and SQLite need additive migrations.
- The conformance suite must cover field metadata, outbox, tombstone floor, and
  atomic rollback.
- Backup v1 remains compatible.
- ADR 0003's port boundary remains intact.
- No Stage B contract is changed.
- Encrypted outbox and conflict payloads depend on ADR 0013.

## Dependencies

- ADR 0008.
- ADR 0009.
- A future authentication and tenant ADR for trusted device identity, a server
  roster, and canonical workspace revision authority.
- ADR 0013 for encrypted outbox and conflict payloads and the metadata boundary.

## Migration implications

- Add the sidecar tables: `sync_meta`, `sync_field_meta`, `sync_outbox`,
  `workspace_sync_state`, `sync_tombstone`, `sync_conflict`, and `sync_devices`.
- Backfill `sync_meta` for existing rows.
- Create field metadata lazily on the first post-migration write, starting from a
  baseline revision.
- Generate a local device ID and `sync_devices` row on first run after migration.
- Initialize the workspace revision counter and
  `workspace_sync_state.tombstoneFloor` to zero.
- No network activity.
- Each migration batch is atomic. SQLite wraps each batch in `BEGIN IMMEDIATE`
  and rolls back the batch if any statement fails.
- Add `workspace_sync_state.lastLocalSequence` and backfill it from the maximum
  outbox sequence per workspace and device.
- An interrupted SQLite restore may leave orphan blob files. A database transaction
  failure deletes newly written blobs and a successful restore purges orphans, so
  cleanup stays backlog for blob-write failure and process interruption.

## Conflicts and decisions requiring approval

- Adding sync tables is a schema expansion. It requires approval even though the
  core ports do not change.
- The ADR chooses per-field revision metadata plus immutable field patches. An
  operation-log or CRDT model would require a separate decision.
- Outbox retention and sync-disabled behavior are gate G-12-1. D2 must define a
  bounded policy before outbox writes are enabled.
- Tombstone retention, stale-device threshold, and compaction are gate G-12-2.
  Compaction and automatic stale marking stay disabled until approved.
- Conflict UX is gate G-12-4. The ADR requires preservation, not a final
  resolution interface.
- A conflict record plus optional conflict copy is proposed instead of silent
  overwrite. This changes future UX expectations and requires approval.
- Trusted device identity, a server roster, and tenant authority are gate G-12-5.
  Canonical workspace revision authority is gate G-12-7. Both require future ADRs.
- D2 is local-only. It does not claim global workspace order or cross-device
  tombstone authority.
- Backup v1 excludes sync metadata. If users expect a full device-state backup,
  that is a separate product decision.
- Restoring backup v1 into a synced workspace is gate G-12-8. It requires
  full-resync and tombstone reconciliation rules and is disallowed until approved.

## Implementation gates

These questions are not settled behavior. Each is an implementation gate with a
required stage and exit criterion.

| Gate   | Open question                                                                    | Resolve by                                                        | Exit criterion                                                                         | Status                                                           |
| ------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| G-12-1 | Outbox retention window and sync-disabled behavior                               | D2, before outbox writes are enabled                              | Bounded retention and disabled-mode policy approved; no unbounded growth tests pass.   | Closed: insert-only outbox; persisted high-water prevents reuse. |
| G-12-2 | Tombstone retention window and stale-device threshold                            | D2, before compaction or automatic stale marking                  | Retention window and threshold approved; both stay disabled until then.                | Closed for D2; compaction and stale marking disabled.            |
| G-12-3 | Exact `merge-safe` field list                                                    | D2, before the merge engine                                       | Field list approved; content-bearing fields cannot be added silently.                  | Closed: exactly `note.pinned` and `tag.color`.                   |
| G-12-4 | Conflict resolution UX and automatic conflict copy                               | D2, before the conflict UI                                        | UX approved; preservation and no-silent-loss tests pass.                               | Closed for D2; no conflict UI, merged/copy unsupported.          |
| G-12-5 | Trusted device identity, server roster, and tenant authority                     | Future authentication and tenant ADR, before any remote sync      | Auth ADR accepted; enrollment, revocation, and tenant isolation tests pass.            | Open, out of D2 scope.                                           |
| G-12-6 | Clock skew strategy and hybrid logical clock adoption                            | D2, before simulated multi-device merge                           | Strategy approved; skew tests pass.                                                    | Closed: `updatedAt`, `originDeviceId`, `opId`; both values kept. |
| G-12-7 | Canonical workspace revision authority and scalar versus vector `tombstoneFloor` | Future sync authority ADR, before distributed sync                | Authority model accepted; D2 remains local-only.                                       | Open, out of D2 scope.                                           |
| G-12-8 | Backup v1 restore into a synced workspace                                        | Future sync authority ADR, before restore into a synced workspace | Full-resync and tombstone reconciliation rules approved; restore is blocked otherwise. | Open; restore remains blocked when a remote target exists.       |

D2 completed its local preparation while G-12-5, G-12-7, and G-12-8 remain
open, because D2 does not implement remote sync, distributed ordering, or restore
into a synced workspace. G-12-1, G-12-2, G-12-3, G-12-4, and G-12-6 are closed for
D2. Compaction and automatic stale marking stay disabled under G-12-2.

The D2 local-only milestone is complete after the 2026-11-16 remediation. All six
audit findings are fixed and covered by regression and conformance tests. G-12-5,
G-12-7, and G-12-8 remain open by design because they require future remote-sync
authority; restore remains blocked when a remote target exists. Orphan blob cleanup
remains backlog.

## Acceptance criteria

Status after the 2026-11-16 remediation: **complete for local-only D2**. All
previously blocked criteria now pass.

- Metadata schema is specified, including per-field revision metadata.
- Implementation gates G-12-1 to G-12-8 have a stage and an exit criterion.
- D2 remains local-only while G-12-5, G-12-7, and G-12-8 remain open.
- Field-level conflict policy matches the metadata and never claims unsupported
  LWW.
- Outbox operations are immutable, replayable, locally ordered, and idempotent.
  Append is insert-only, and `localSequence` cannot regress after pruning.
- Entity, revision, and outbox writes are atomic across both adapters, including
  multi-workspace revisions and caught nested failures.
- Local tombstone floor prevents resurrection after compaction in D2.
- No global cross-device revision or tombstone claim is made in D2.
- Concurrent offline content changes are preserved without silent data loss.
- Conflict records can be listed and resolved.
- Outbox and conflict content are classified as content, not plaintext metadata.
- Backup v1 compatibility is proven.
- Both adapters pass the conformance suite, including shared revisions,
  reset/restore sidecars, immutability, second-workspace sequences, high-water,
  and blocked-restore blob safety.
- Migration batches are atomic in SQLite; a failing statement rolls back the batch.
- No sync protocol or network code is added.
- Existing local features still work without a device account.

## Testing strategy

- Round-trip tests for both adapters.
- Migration tests from current data.
- Simulated two-device merge.
- Independent-field merge tests.
- Same-field `merge-safe` LWW tests.
- Same-field content conflict-record tests.
- Clock-skew merge tests for `merge-safe` and content fields.
- Gate-specific tests for G-12-1 to G-12-4 and G-12-6.
- Outbox replay, idempotency, integrity, local ordering, and retry tests. Network
  retry and backoff remain future transport work.
- Atomic rollback injection at entity, revision, and outbox steps.
- Local D2 tombstone acknowledgement, floor, stale-device, revoked-device, and
  resurrection tests.
- Tests proving the floor gates stale devices, not unrelated operations from an
  up-to-date device.
- Tests proving D2 does not claim cross-device ordering or tombstone authority.
- Conflict-record resolution tests.
- Backup compatibility tests.
- Performance tests on large workspaces.
- E2EE classification tests for outbox and conflict payloads. Encryption remains
  future ADR 0013 work; D2 stores local patches under the content data class.
