# ADR 0005: Local backup format and restore flow

- Status: Accepted
- Date: 2026-11-13
- Addendum: encrypted backup format v2 accepted 2026-11-16
- Context: Stage C data ownership (C5), after ADR 0004

## Context

Users need to export everything OpenNest stores and restore it later. Browser
storage can be evicted, and the app has no server copy. The backup must include
files, notes, folders, tags, relationships, and file bytes, and an import must
not partially replace a working library.

Stage B already defines `BackupSnapshot` and a transactional `storage.restore()`.
The missing pieces are a portable file format, validation, and UI.

## Decision

1. **One JSON envelope with base64 blobs.** A backup is a UTF-8 JSON file with
   `format: "opennest-backup"`, `formatVersion: 1`, `exportedAt`, and a
   `BackupSnapshot`. Blob bytes are base64 inside the snapshot. This keeps the
   format inspectable and portable without a ZIP dependency. Streaming and ZIP
   archives are deferred until file sizes justify them.
2. **The envelope schema lives in `@opennest/validation`.** `backupFileSchema`
   validates the marker and version. `backupSnapshotSchema` remains the source of
   truth for snapshot structure and references, so the backup format cannot drift
   from the storage contract.
3. **Export fails instead of degrading.** If a stored blob is missing, export
   throws instead of producing an incomplete backup. Tag and note relationships
   are rebuilt through the public `tags()` and `links()` repository methods; the
   app does not reach into adapter tables.
4. **Import validates everything before restore.** Parsing rejects invalid JSON,
   unknown formats, unsupported versions, invalid base64, schema or reference
   errors, duplicate blobs, missing blobs, and SHA-256 mismatches. Only then does
   the app call the adapter's transactional `restore()`.
5. **Restore is explicit and replaces the active library.** The settings UI asks
   for confirmation before importing. After a successful restore, the provider
   calls `refreshWorkspace()` so the active workspace matches the restored data.
6. **Backups stay local.** Export is a browser download and import is a local
   file read. No backup bytes are uploaded.

## Addendum: encrypted backup format v2

- Status: Accepted for D3 implementation on 2026-11-16.
- Scope: this addendum extends ADR 0005. Format v1 remains readable and is not
  rewritten.

When workspace encryption is active, the default export is format version 2.
Version 1 remains importable and must be labeled as a plaintext backup before
restore. The app must never silently present a v1 file as encrypted.

### Header and key hierarchy

The v2 file is a JSON envelope with:

- `format: "opennest-backup"` and `formatVersion: 2`.
- `exportedAt`.
- KDF name, hash, iteration count, salt, and domain separation label.
- A backup key ID.
- A wrapped backup DEK with nonce, ciphertext, and authentication tag.
- Chunk size and chunk count.
- A non-sensitive summary of counts and total plaintext bytes.
- An array of encrypted chunks.

A fresh random 256-bit backup DEK is generated for every export. The backup KEK
comes from either a backup passphrase or a generated backup recovery key. The
backup KEK is derived with PBKDF2-SHA-256 using a random 128-bit salt, an
iteration count at or above the current floor, and HKDF domain separation. The
backup DEK is wrapped with AES-256-GCM using a unique 96-bit nonce and AAD that
binds the format, version, KDF parameters, key ID, chunk size, and chunk count.

The backup DEK is never the workspace DEK, a workspace CEK, or a credential-vault
key. A restore must not install the backup DEK as a live workspace key.

### Chunks

The canonical UTF-8 JSON serialization of the backup snapshot is split into
chunks of approximately 4 MiB. Each chunk has:

- Its zero-based index.
- A fresh 256-bit CEK wrapped by the backup DEK.
- A unique 96-bit nonce for the payload.
- Ciphertext bytes and a 128-bit authentication tag.

The payload CEK is used once. AAD binds the same header context plus the chunk
index and chunk count, and the purpose `backup-chunk`. A chunk moved to another
index, file, key ID, or version must fail authentication. Unknown algorithms,
unknown key IDs, malformed fields, duplicate or missing chunk indexes, truncated
tags, and a chunk count mismatch fail closed.

### Checksums and restore

Storage in encrypted mode stores file checksums over ciphertext at rest. A backup
must describe logical file content, so export first decrypts or uses the recorded
plaintext checksum and writes the plaintext SHA-256 into the backup snapshot.
Import validates that plaintext checksum after decrypting and validating blobs.
Restore into an encrypted workspace recomputes the ciphertext checksum under the
target workspace key.

A v2 snapshot may have been exported from another workspace. Restore maps the
snapshot's workspace ID to the current workspace ID before validation and
re-encryption. Entity IDs and relationships are preserved. AAD for the restored
records uses the target workspace ID, so cross-workspace ciphertext cannot be
replayed into the live store. The backup key is used only to open the backup; it
is never used as a workspace key.

### Exclusions

Backup v2 excludes workspace keys and keyring records, credentials, privacy
grants, audit entries, drafts, search results, device identity, and all seven
sync sidecars. It includes workspace metadata, folders, tags, files, blobs, notes,
and their relationships. The export confirmation must list the exclusions before
the download starts.

### Compatibility and failure behavior

- Importing v1 into an encrypted workspace requires an explicit plaintext
  warning and re-encrypts the snapshot during restore.
- Importing v2 into a plaintext workspace requires an explicit warning that the
  restored data will be plaintext.
- A wrong backup passphrase, wrong backup key, unknown key ID, or corrupt chunk
  fails before the live library is replaced.
- Restore remains transactional at the adapter boundary. The backup DEK and
  plaintext snapshot are released after restore.
- Large backups are limited by available memory until streaming is implemented.
  Chunking reduces peak ciphertext size but does not eliminate the in-memory
  snapshot.

## Consequences

- Large libraries produce large JSON files because base64 adds roughly a third to
  blob size. The current file limit is 25 MB per file, so this is acceptable for
  the MVP; a streaming archive is the next step if libraries grow. Parsing and
  checksum verification run on the main thread, so moving them into a worker is
  the next performance step for very large backups.
- The format is versioned. A future format change must either keep reading
  version 1 or reject it with a clear unsupported-version message.
- The restore transaction is only as atomic as the adapter. Dexie and SQLite both
  implement it transactionally and share the conformance suite.
- A backup from a newer schema or format version is rejected rather than guessed
  at.
