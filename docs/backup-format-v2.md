# Backup format v2

Status: format v2 export, inspection, import, checksum verification, and
current-workspace mapping are implemented and covered by automated tests. The
encrypted-at-rest UI wiring and external security review are pending. Backup v1
remains supported.

This document extends ADR 0005 and must be read with
`docs/e2ee-key-management.md`. Format v2 protects backup payloads with a separate
backup key hierarchy. It does not replace v1 files and does not import the backup
key as a live workspace key.

## When v2 is used

- When workspace encryption is active, the default export is v2.
- A v1 export remains available only as an explicit plaintext export with a
  warning.
- Import accepts v1 and v2. A v2 import into a plaintext workspace, or a v1
  import into an encrypted workspace, requires an explicit warning.
- A v1 backup must never be labeled encrypted.
- No E2EE claim is made until the backup implementation, tests, and external
  review are complete.

## Envelope

The file is a UTF-8 JSON object:

```json
{
  "format": "opennest-backup",
  "formatVersion": 2,
  "exportedAt": "2026-11-16T00:00:00.000Z",
  "encryption": {
    "version": 1,
    "alg": "AES-256-GCM",
    "kdf": {
      "name": "PBKDF2-SHA-256",
      "hash": "SHA-256",
      "iterations": 600000,
      "salt": "base64url"
    },
    "domain": "opennest:backup-kek:v1",
    "kid": "backup-key-id",
    "wrappedDek": {
      "iv": "base64url",
      "ciphertext": "base64url",
      "tag": "base64url"
    }
  },
  "chunkSize": 4194304,
  "chunkCount": 1,
  "summary": {
    "counts": {
      "workspaces": 1,
      "folders": 0,
      "tags": 0,
      "files": 0,
      "notes": 0
    },
    "totalPlaintextBytes": 0
  },
  "chunks": [
    {
      "index": 0,
      "iv": "base64url",
      "wrappedCek": {
        "iv": "base64url",
        "ciphertext": "base64url",
        "tag": "base64url"
      },
      "ciphertext": "base64url",
      "tag": "base64url"
    }
  ]
}
```

The summary is not secret. It contains counts and total logical bytes only. It
must not contain note text, filenames, tags, folder names, workspace names, or
credentials. The full snapshot, including identifiers and metadata, is inside
the encrypted chunks.

Unknown top-level fields, unknown encryption versions, unknown algorithms,
malformed base64url, duplicate chunk indexes, and trailing data are rejected.

## Key hierarchy

```text
backup passphrase or backup recovery key
  -> PBKDF2-SHA-256(random 128-bit salt, iterations >= 600000)
  -> HKDF-SHA-256(info = "opennest:backup-kek:v1")
  -> backup KEK

random 256-bit backup DEK
  -> wrapped by backup KEK with AES-256-GCM
  -> stored in encryption.wrappedDek

per-chunk random 256-bit CEK
  -> wrapped by backup DEK with AES-256-GCM
  -> used once for one chunk
```

The backup DEK is fresh for every export. It is never the workspace DEK, a
workspace CEK, a credential-vault key, or a keyring record. The backup KEK label
is distinct from the workspace label. A backup key cannot open live workspace
storage or the credential vault.

The backup recovery key is a generated secret, separate from the workspace
recovery key. It is displayed once, encoded with a checksum, and never stored in
the backup. A backup passphrase is an alternative key source. The UI must not
offer to recover a workspace with a backup key or a backup with a workspace key.

## AAD

AAD is canonical JSON with sorted keys, UTF-8 encoding, and no whitespace.

For the backup DEK wrap:

```json
{
  "alg": "AES-256-GCM",
  "chunkCount": 1,
  "chunkSize": 4194304,
  "domain": "opennest:backup-kek:v1",
  "format": "opennest-backup",
  "formatVersion": 2,
  "kdf": {
    "hash": "SHA-256",
    "iterations": 600000,
    "name": "PBKDF2-SHA-256",
    "salt": "base64url"
  },
  "kid": "backup-key-id",
  "purpose": "backup-dek-wrap"
}
```

For each chunk CEK wrap and payload:

```json
{
  "alg": "AES-256-GCM",
  "chunkCount": 1,
  "chunkIndex": 0,
  "chunkSize": 4194304,
  "domain": "opennest:backup-kek:v1",
  "format": "opennest-backup",
  "formatVersion": 2,
  "kid": "backup-key-id",
  "purpose": "backup-chunk"
}
```

The payload encryption AAD is the chunk context plus `wrappedCekHash`, the
base64url SHA-256 of the canonical wrapped CEK bytes. Canonical wrapped CEK
bytes are the nonce, ciphertext, and tag concatenated in that order. The CEK wrap
AAD cannot include its own wrapped-key hash because that would be circular. The
payload binding prevents replacing the wrapped CEK independently of the payload.
A chunk moved to another index, file, key ID, version, KDF parameter set, or
chunk count must fail authentication.

## Chunking

1. Serialize the validated `BackupSnapshot` to canonical UTF-8 JSON. Blob bytes
   remain base64 in the snapshot, matching the existing storage contract.
2. Split the byte sequence into chunks of approximately 4 MiB. Only the final
   chunk may be shorter. An empty snapshot still has one empty chunk.
3. For each chunk, generate a fresh 256-bit CEK and a random 96-bit nonce.
4. Wrap the CEK with the backup DEK using AES-256-GCM and the chunk AAD.
5. Encrypt the chunk with the CEK using AES-256-GCM and the chunk AAD.
6. Store the chunk index, wrapped CEK, nonce, ciphertext, and 128-bit tag.

The payload CEK is used once. A retry generates a new CEK and nonce. The final
tag is never truncated. The chunk count must match the actual number of chunks,
and indexes must be complete and unique from zero to `chunkCount - 1`.

## Export flow

1. Validate that the workspace is readable and every stored blob exists.
2. Build the complete `BackupSnapshot`. File checksums in the snapshot describe
   logical plaintext content, not ciphertext at rest.
3. Ask for a backup passphrase or generate a backup recovery key. Show the
   generated key once and require confirmation before export.
4. Generate the salt and backup DEK, derive the KEK, wrap the DEK, and encrypt
   chunks.
5. Serialize the envelope only after all chunks succeed.
6. Download the file only after the complete envelope exists in memory.
7. Show the completion state only after the download action is issued. Report
   the backup key source and the exclusions.

Export fails instead of producing a partial file. A missing blob is an error.
The UI must not label a failed or cancelled export complete.

## Restore flow

1. Parse the envelope and discriminate v1 or v2.
2. For v2, validate the header, algorithm, version, KDF floor, key ID, chunk
   count, chunk indexes, and summary shape before deriving keys.
3. Derive the backup KEK from the user's backup passphrase or backup recovery key.
4. Unwrap the backup DEK and verify the key ID.
5. Decrypt every chunk, verify each tag, concatenate the plaintext, and parse the
   snapshot.
6. Validate the snapshot schema, references, blobs, and plaintext checksums.
7. Map the snapshot workspace ID to the current workspace ID.
8. Re-encrypt every covered value under the current workspace key if the target
   workspace is encrypted, or keep plaintext only if the user explicitly chose a
   plaintext restore.
9. Call the adapter's transactional restore.
10. Release the backup DEK and plaintext snapshot after restore.

A wrong key, corrupt chunk, unsupported version, chunk mismatch, schema error, or
missing blob fails before the live library is replaced. The backup DEK is never
installed as a live workspace key.

## Current-workspace mapping

A backup may come from another workspace. The backup payload contains the source
workspace ID and entity identifiers. Restore must:

- Treat the source workspace ID as encrypted snapshot data, not as the live
  target identity.
- Replace the source workspace ID with the target workspace ID before validation
  and re-encryption.
- Preserve folder, tag, file, note, and relationship IDs.
- Rebuild AAD under the target workspace ID.
- Reject any ciphertext whose AAD does not match the target context.
- Clear stale sync sidecars and apply the existing installation-device rules.

The backup key opens only the backup file. Restoring it does not grant access to
the source workspace, its keyring, or its credentials.

## Checksums

Backup snapshots describe logical file content:

- Export writes the SHA-256 of plaintext file bytes into the snapshot.
- Import verifies that plaintext checksum after decrypting blobs.
- Encrypted storage keeps its own checksum over ciphertext at rest.
- Restore into an encrypted workspace recomputes the ciphertext checksum.
- A missing blob fails export. A checksum mismatch fails import.

Do not put the at-rest ciphertext checksum into a v2 snapshot. The snapshot must
remain portable across NaCl, Dexie, SQLite, and a future encrypted adapter.

## Exclusions

Backup v2 excludes:

- Workspace keys and keyring records.
- AI provider settings, the AI enabled flag, and AI consent history.
- Session credentials and credential-vault data.
- Privacy grants.
- Audit entries.
- Drafts, plaintext or encrypted.
- Search results and caches.
- Device identity and installation secrets.
- All seven sync sidecars.

Backup v1 excludes the same categories. Backup v2 includes workspace metadata,
folders, tags, files, blobs, notes, and their relationships. The export
confirmation lists exclusions before download.

Restoring either format never recreates AI provider access, AI consents, session
credentials, or credential-vault entries. Workspace recovery and backup restore
do not unlock the credential vault, and a vault passphrase does not unlock
workspace data or a backup.

## Compatibility

- v1 remains readable and importable. v1 is plaintext and must be labeled as
  such.
- v1 import into an encrypted workspace re-encrypts through the encrypted
  storage restore path.
- v2 import into a plaintext workspace requires an explicit warning and produces
  plaintext data.
- v2 import into an encrypted workspace re-encrypts under the target workspace
  key.
- A newer format version is rejected, not guessed.
- A v2 envelope with an unknown algorithm, key ID, or KDF parameter set is
  rejected.

## Limits and known gaps

- The snapshot is assembled in memory. A 25 MB file limit and base64 overhead
  still allow large backups. Chunking reduces peak ciphertext size but does not
  implement streaming.
- Backup v2 does not protect metadata inside the snapshot from a user who has the
  backup key; it protects it from someone who does not.
- Backup encryption does not protect against a compromised device while the
  backup key is entered.
- Backup restore does not recover a lost workspace passphrase or recovery key.
- R-13-7 rollback and replay protection is not solved by backup format v2.
- No E2EE claim is made until implementation and external review pass.

## Required tests

- v1 and v2 discrimination and unsupported-version rejection.
- Header, KDF floor, algorithm, key ID, and chunk validation.
- Round-trip export and restore for empty, small, and multi-chunk snapshots.
- Wrong passphrase, wrong backup key, wrong key ID, truncated tag, modified
  chunk, duplicate index, missing index, and reordered chunk failures.
- Cross-workspace restore mapping and AAD checks.
- Plaintext checksum normalization and encrypted checksum recomputation.
- Missing blob fails export.
- v2 into plaintext warning path and v1 into encrypted warning path.
- Dexie and SQLite restore with encrypted data.
