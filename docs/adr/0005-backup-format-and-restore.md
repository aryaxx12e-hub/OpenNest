# ADR 0005: Local backup format and restore flow

- Status: Accepted
- Date: 2026-11-13
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
