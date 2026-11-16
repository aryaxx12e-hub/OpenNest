# Privacy Center

The Privacy Center gives users a single place to inspect local data, understand
data flows, review capability grants, audit sensitive actions, export a backup,
and delete everything stored on the device.

Route: `/privacy`

The page is a client shell around `DataControls` and the privacy runtime created
by `AppDataProvider`. Feature components never receive a raw `StorageAdapter`.
They request a capability through the broker and invoke it through the returned
handle.

## Capability catalog

| Capability                  | Family     | Scope                                              | Risk   |
| --------------------------- | ---------- | -------------------------------------------------- | ------ |
| `workspace.read.metadata`   | workspace  | workspace, folder subtree, selected notes or files | normal |
| `workspace.read.content`    | workspace  | workspace, folder subtree, selected notes or files | normal |
| `workspace.write`           | workspace  | workspace, folder subtree, selected notes or files | normal |
| `workspace.export`          | workspace  | workspace, folder subtree, selected notes or files | high   |
| `workspace.delete`          | workspace  | workspace, folder subtree, selected notes or files | high   |
| `network.connect:<origin>`  | network    | one normalized HTTP(S) origin                      | normal |
| `credential.use:<provider>` | credential | one provider credential                            | high   |
| `ai.invoke:<provider>`      | ai         | one AI provider                                    | normal |
| `sync.push`                 | sync       | one workspace                                      | normal |
| `sync.pull`                 | sync       | one workspace                                      | normal |

External capabilities are parsed and validated in D1 but denied by policy. No
network, AI, extension, sync, credential, or E2EE capability is available.

## Scope rules

- Scope kinds are `workspace`, `folder`, `notes`, `files`, `origin`, and
  `provider`.
- A request must be a subset of its grant. Folder scopes expand to folder
  subtrees; selected note and file scopes must be contained.
- Origins are normalized to scheme, host, and port. Credentials, wildcards,
  paths, query strings, and non-HTTP schemes are rejected. Plain HTTP is allowed
  only for loopback.
- Provider IDs reject whitespace, separators, wildcards, dot segments, and
  control characters.
- A grant has a short purpose, an optional expiry, an optional use limit, and an
  optional session binding.
- Default grant lifetime is 24 hours. Maximum grant lifetime is 30 days.

## Built-in grants

The local built-in principal (`built-in:local`) receives five non-revocable,
non-expiring workspace grants at bootstrap:

- `workspace.read.metadata`
- `workspace.read.content`
- `workspace.write`
- `workspace.export`
- `workspace.delete`

They are recreated when the workspace changes and after a full deletion. They
cannot authorize external capabilities and cannot be revoked.

## Audit events

The audit log is append-only, metadata-only, hash-chained, and stored separately
from workspace data. It records:

- grant creation and revocation
- capability requests, denials, completions, and failures
- data export and data restore
- full deletion

Entries contain sequence, event, outcome, principal, capability, optional scope
digest, item count, reason, and timestamp. They never contain note text, file
content, filenames, tags, or backup bytes. A failed audit write blocks the
sensitive operation. Tampering with an entry breaks chain verification.

## Data inventory

The inventory lists workspace metadata, folders, tags, files, blobs, notes,
drafts, grants, audit entries, search results, backups, and the seven sync
sidecars. Inventory IDs are `sync-meta`, `sync-field-meta`, `sync-outbox`,
`sync-devices`, `sync-state`, `sync-tombstones`, and `sync-conflicts`; the
physical tables are `sync_meta`, `sync_field_meta`, `sync_outbox`, `sync_devices`,
`workspace_sync_state`, `sync_tombstone`, and `sync_conflict`. They display as
Sync metadata, Sync field metadata, Sync outbox, Sync devices, Sync workspace
state, Sync tombstones, and Sync conflicts. Each entry declares:

- data class (`D0` to `D5`)
- storage location (`indexeddb`, `localstorage`, `memory`, `file`)
- backup inclusion
- derivation source
- deletion behavior
- retention

Search results are session-only memory. Drafts live in `localStorage`. Grants and
audit entries use the separate `opennest-privacy` IndexedDB database. Backups are
external files. All seven sync sidecars are IndexedDB rows, none are included in
backup v1, and they survive a source delete until an explicit reset or cleanup.

The Privacy Center also shows the flow matrix: built-in local processing, backup
export, backup restore, AI provider, extension, and sync. Unavailable flows are
marked as not available in D1.

## Backup exclusions

Backup format v1 contains workspace metadata, folders, tags, files, blobs, and
notes. It excludes drafts, grants, audit entries, search results, and all seven
sync sidecars, including outbox and conflict records. The export confirmation names
the excluded categories before the download starts.

## Deletion order

Deleting all local data runs in this order:

1. Clear every note draft. If any draft cannot be cleared, abort with
   `draft_clear_failed` and delete nothing.
2. Count current items for the confirmation record.
3. Request `workspace.delete` with explicit confirmation and delete workspace
   data through the storage adapter.
4. Reset grants and the audit chain in the privacy store.
5. Recreate an empty workspace with a new timestamp.
6. Install fresh built-in grants without creating initial audit entries.

The external backup file already downloaded by the user is not deleted. The
confirmation dialog says so.

## Restore behavior

Restore requests `workspace.delete`, replaces workspace data, records
`data.restored`, switches the active workspace, reconciles built-in grants, then
clears drafts. If draft clearing fails, the restore still succeeds and the UI
warns that stale drafts may remain. It does not hide the success state.

## Revocation limits

Built-in workspace grants cannot be revoked. External grants can be revoked,
expire, exhaust their use limit, or end with their session. Revocation is checked
again before and during invocation, and an in-flight operation is aborted when
its grant is revoked.

## Store layout

The privacy store uses IndexedDB database `opennest-privacy` with tables:

- `grants`
- `audit`
- `meta`

Tests and unsupported environments fall back to an in-memory store. The memory
store is not durable.

## Localization

All Privacy Center text is localized in English and Indonesian. The inventory
and flow matrix store translation keys, not user-facing strings.
