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

AI capabilities are available only after the user turns AI on, configures a
provider, and approves one exact request in the AI console. AI requests may use
only `D1` and `D2` data classes, and every request creates a one-time consent
record plus `ai.invoke:<provider>`, `network.connect:<origin>`, and, when a
credential is used, `credential.use:<provider>` grants. Extension and sync
capabilities remain denied by policy. Workspace, backup, and credential-vault
encryption are local storage compositions, not broker capabilities, so they do
not add a capability family or an egress path.

When workspace encryption is enabled the Privacy Center must disclose that
titles, filenames, tags, folder names and structure, sizes, timestamps, provider
settings, vault metadata, and sync metadata remain plaintext. AI prompts and
responses are never described as encrypted: prompts exist in memory only and are
not persisted.

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
- AI request start, completion, failure, and cancellation

Entries contain sequence, event, outcome, principal, capability, optional scope
digest, item count, reason, and timestamp. They never contain note text, file
content, filenames, tags, or backup bytes. A failed audit write blocks the
sensitive operation. Tampering with an entry breaks chain verification.

## Data inventory

The inventory lists workspace metadata, folders, tags, files, blobs, notes,
drafts, grants, audit entries, search results, backups, AI provider settings, AI
session credentials, the credential vault, AI consent history, and the seven
sync sidecars. Inventory IDs are `sync-meta`, `sync-field-meta`, `sync-outbox`,
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

Search results are session-only memory. Drafts live in `localStorage`; D3 adds
encrypted drafts under the `opennest:edraft:note:` prefix when encryption is
active. Grants, audit entries, and consent records use the separate
`opennest-privacy` IndexedDB database. AI provider settings use the separate
`opennest-ai` database. The credential vault uses the separate
`opennest-credentials` database, while session credentials exist in memory only.
Backups are external files. All seven sync sidecars are IndexedDB rows, none are
included in backup v1 or v2, and they survive a source delete until an explicit
reset or cleanup.

The AI inventory entries are `ai-provider-config` (D1, IndexedDB),
`ai-credentials-session` (D3, memory), `ai-credential-vault` (D3, IndexedDB), and
`ai-consents` (D4, IndexedDB). All four are excluded from backup v1 and v2.

D3 also adds a keyring in the separate `opennest-crypto` IndexedDB database. Its
inventory ID is `crypto-keyring`, its data class is D3, it is excluded from every
backup, and it is retained until full deletion or an explicit key reset. The
keyring stores salts, KDF parameters, wrapped keys, migration state, and
rate-limit metadata. It never stores a passphrase, raw DEK, raw CEK, or raw
recovery key. The inventory label and metadata description must be localized.

The Privacy Center also shows the flow matrix: built-in local processing, backup
export, backup restore, AI provider, extension, and sync. AI provider flow is
available only through the consent-gated AI console and points from this device
(Z1) to the provider (Z2) for `D1` and `D2` data. Extension and sync remain
marked as not available.

The consent history lists provider label, model, endpoint origin, data classes,
approval time, expiry, status, and a revoke action. It never renders the prompt,
response, payload hash, payload bytes, purpose text, or credential secret.
Revoking a consent marks it revoked in the history and revokes any linked
non-built-in grants.

## Backup exclusions

Backup format v1 contains workspace metadata, folders, tags, files, blobs, and
notes in plaintext. Backup format v2 contains the same logical data but encrypts
the payload with a separate backup key hierarchy, and is the default when
workspace encryption is active. Both formats exclude drafts, grants, audit
entries, search results, keyring records, AI provider settings, AI consents,
session credentials, the credential vault, device identity, and all seven sync
sidecars, including outbox and conflict records. The export confirmation names
the excluded categories and whether the file is plaintext v1 or encrypted v2
before the download starts.

## Deletion order

Deleting all local data runs in this order:

1. Flush and lock encryption work so no new plaintext or ciphertext write races
   the deletion.
2. Clear every plaintext and encrypted note draft. If any draft cannot be
   cleared, abort with `draft_clear_failed` and delete nothing.
3. Count current items for the confirmation record.
4. Request `workspace.delete` with explicit confirmation and delete workspace
   data through the storage adapter.
5. Reset grants and the audit chain in the privacy store.
6. Delete the keyring only after workspace deletion succeeds.
7. Recreate an empty workspace with a new timestamp.
8. Install fresh built-in grants without creating initial audit entries.

Deleting the keyring before workspace data would make a failed deletion
unrecoverable, so it is last. The external backup file already downloaded by the
user is not deleted. The confirmation dialog says so.

## Restore behavior

Restore requests `workspace.delete`, replaces workspace data, records
`data.restored`, switches the active workspace, reconciles built-in grants, then
clears drafts. If draft clearing fails, the restore still succeeds and the UI
warns that stale drafts may remain. It does not hide the success state.

For backup v2, restore asks for the backup passphrase or backup recovery key,
validates the backup key ID and every chunk before replacing live data, maps the
snapshot to the current workspace ID, and re-encrypts under the current workspace
key. The backup key is never installed as a workspace key. Importing v2 into a
plaintext workspace, or v1 into an encrypted workspace, requires an explicit
warning. A wrong key or corrupt chunk fails before the live library is touched.

Restore never recreates AI provider settings, consents, session credentials, or
credential-vault entries. The AI runtime and vault must be configured again on
the target device. Workspace recovery and backup restore do not unlock the
credential vault.

## Revocation limits

Built-in workspace grants cannot be revoked. External grants can be revoked,
expire, exhaust their use limit, or end with their session. Revocation is checked
again before and during invocation, and an in-flight operation is aborted when
its grant is revoked. AI consents are one-time, payload-bound, and limited to
five minutes. Revoking a consent also revokes its linked AI, network, and
credential grants, but it cannot recall data that the provider already received.

## Store layout

The privacy store uses IndexedDB database `opennest-privacy` with tables:

- `grants`
- `audit`
- `consents`
- `meta`

Tests and unsupported environments fall back to an in-memory store. The memory
store is not durable. The AI store uses IndexedDB database `opennest-ai` for
provider settings and the enabled flag. The credential vault uses
`opennest-credentials`. Session credentials live in memory only, and prompts and
responses are never written to any store.

The encryption keyring uses IndexedDB database `opennest-crypto` with a keyring
record store and key metadata. It is not part of `opennest-privacy` and is not a
capability grant. Tests use an in-memory keyring where IndexedDB is unavailable.

## Localization

All Privacy Center text is localized in English and Indonesian. The inventory
and flow matrix store translation keys, not user-facing strings.
