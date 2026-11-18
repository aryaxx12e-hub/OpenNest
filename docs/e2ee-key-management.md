# E2EE key management

Status: implemented for D3 workspace encryption and the D4B credential vault.
External security review is still pending, so OpenNest does not claim
end-to-end encryption yet.

This document describes the target key hierarchy and lifecycle for optional
workspace encryption. The binding decisions are in ADR 0013, the draft amendment
is AD-7-1 in ADR 0007, and the backup extension is the addendum in ADR 0005.

## Scope

D3 encrypts:

- Note bodies at rest.
- Attached file bytes at rest.
- Encrypted drafts, including draft title and base values.
- Backup v2 payloads.

D3 does not encrypt:

- Note titles.
- File names, MIME types, sizes, or checksums as product metadata.
- Tag names, folder names, or folder structure.
- Timestamps, workspace names, or record counts.
- Sync metadata, outbox patches, tombstones, or conflict metadata.
- Credentials. The D4B credential vault is outside D3 and has its own hierarchy.

Metadata leakage is accepted for D3 and must be documented in the threat model
and product copy.

## Separate key domains

| Domain           | Protects                                   | May not open                       |
| ---------------- | ------------------------------------------ | ---------------------------------- |
| Workspace        | Note content, file bytes, encrypted drafts | Backup payloads, credential vault  |
| Backup           | One backup file                            | Live workspace, credential vault   |
| Credential vault | Provider credentials                       | Workspace content, backup payloads |

No key, KEK, DEK, or CEK is reused across domains. Domain separation labels are
part of key derivation and are authenticated by the envelope.

The D4B vault implements its own hierarchy under the label
`opennest:credential-vault-kek:v1`. A vault passphrase derives the vault KEK,
which wraps a random vault DEK. Each entry gets a fresh CEK, and entry AAD binds
the vault ID, active key ID, entry ID, provider ID, account label, and entry
version. Workspace recovery, the workspace passphrase, and a backup passphrase
cannot open the vault. The vault passphrase cannot open workspace data or a
backup. Vault records are excluded from backup v1 and v2, and session credentials
exist only in memory.

## Workspace hierarchy

```text
passphrase
  -> PBKDF2-SHA-256(salt, iterations >= 600000)
  -> HKDF-SHA-256(info = "opennest:workspace-kek:v1")
  -> workspace KEK

workspace DEK (random 256-bit)
  -> wrapped by workspace KEK with AES-256-GCM
  -> stored in the keyring

per-write CEK (random 256-bit)
  -> wrapped by workspace DEK with AES-256-GCM
  -> used once for one note content, file version, or draft payload

workspace recovery key (random 256-bit, displayed once)
  -> recovery KEK
  -> wraps the workspace DEK
  -> recovery KEK is also stored wrapped under the workspace KEK
```

The recovery KEK wrapping under the workspace KEK lets rotation replace the
workspace DEK without asking the user to re-enter the recovery key. It does not
allow the recovery key to open the credential vault or a backup.

### Keyring

The keyring lives in a separate IndexedDB database, `opennest-crypto`. It is not
part of workspace storage and is never included in a backup. A version 1 record
contains:

- `version`, `workspaceId`, and active `kid`.
- KDF parameters: algorithm, hash, iteration count, and salt.
- `wrappedDek`: nonce, ciphertext, and 128-bit authentication tag.
- `wrappedRecoveryKek`: nonce, ciphertext, and tag.
- Optional pending rotation state with a new `kid` and wrapped DEK.
- Migration state: `preparing`, `committing`, `cleanup`, or `active`.
- Unlock rate-limit metadata: failure count and retry-after timestamp.
- Non-secret lifecycle timestamps.

The keyring never stores a passphrase, raw DEK, raw CEK, raw recovery key, or
password hint. Keys exist in memory only while the workspace is unlocked.

The keyring is not a second copy of workspace data. Deleting it makes encrypted
workspace content and encrypted drafts permanently unreadable. The passphrase and
recovery key cannot reconstruct a wrapped DEK that no longer exists.

## KDF policy

- PBKDF2 uses SHA-256, a random 128-bit salt, and at least 600,000 iterations.
- Iterations may increase without a format change. Lowering the floor requires
  an explicit security decision and a migration plan.
- HKDF-SHA-256 uses the domain label as `info`. The salt is empty unless a future
  version defines one.
- A normal passphrase change generates new KDF parameters and re-wraps the same
  DEK. It keeps the DEK key ID because stored envelopes are bound to that ID;
  only a DEK rotation changes the key ID.
- A DEK rotation creates a new DEK and key ID.
- Unlock is rate limited in the UI and keyring metadata. Rate limiting does not
  protect against an attacker who copies the keyring and guesses offline; strong
  passphrases and the iteration floor remain the primary defense.
- Passphrases and key material must never enter logs, URLs, analytics, error
  reports, or crash telemetry.

## Envelope formats

### Text envelope

Note content and encrypted drafts use:

```text
enc1:<base64url(UTF-8 JSON envelope)>
```

The JSON envelope contains:

```json
{
  "version": 1,
  "alg": "AES-256-GCM",
  "kid": "workspace-key-id",
  "iv": "base64url-12-byte-nonce",
  "wrappedKey": {
    "iv": "base64url-12-byte-nonce",
    "ciphertext": "base64url",
    "tag": "base64url-16-byte-tag"
  },
  "ciphertext": "base64url",
  "tag": "base64url-16-byte-tag"
}
```

### Binary envelope

File blobs use a compact binary container:

```text
"ONB1" | version (1 byte) | alg (1 byte) | kid length (uint16 BE) | kid
| payload nonce (12 bytes) | wrapped key length (uint16 BE)
| wrapped key bytes | ciphertext | authentication tag (16 bytes)
```

The wrapped key bytes are the nonce, ciphertext, and tag produced when the
workspace DEK wraps the single-use CEK. The authentication tag for the payload
is the final 16 bytes. Truncated tags are rejected.

Unknown envelope versions, algorithms, key IDs, malformed base64url, duplicate
fields, and trailing bytes fail closed. Empty ciphertext is accepted only when
its tag authenticates it as empty plaintext, and empty wrapped-key ciphertext is
rejected. Parsing a ciphertext never falls back to plaintext.

## AAD binding

Every encryption and decryption reconstructs AAD from trusted context, not from
untrusted envelope fields. The canonical AAD object uses sorted keys, UTF-8, and
no whitespace:

```json
{
  "alg": "AES-256-GCM",
  "entityId": "note-or-file-id",
  "entityType": "note",
  "envelopeVersion": 1,
  "kid": "workspace-key-id",
  "purpose": "note-content",
  "workspaceId": "workspace-id"
}
```

Purposes are fixed strings such as `note-content`, `file-bytes`, `draft`,
`backup-dek-wrap`, and `backup-chunk`. File envelopes may add an
`entityVersion` field for the file version. Backup chunks add `chunkIndex` and
`chunkCount`.

A ciphertext moved to another record, workspace, purpose, key ID, envelope
version, file version, or chunk index must fail authentication. The key ID in
the envelope is checked before decryption and must match the context key.

## Nonce and CEK discipline

- AES-GCM uses a random 96-bit nonce from `crypto.getRandomValues`.
- A fresh 256-bit CEK is generated for every note write, file version, draft
  write, and backup chunk.
- A CEK encrypts exactly one payload with one nonce. A retry generates a new CEK
  and a new nonce.
- A CEK may be decrypted again when reading the stored record. It must never be
  used to encrypt a new payload.
- Key wrapping also uses a unique random 96-bit nonce.
- AES-KW is not used. Authentication tags are 128-bit and are never truncated.
- If the implementation cannot prove single use or obtain secure randomness, it
  fails closed.

## Storage behavior

`createEncryptedStorage` wraps a `SyncCapableStorage` at the composition
boundary. Core domain types and repository interfaces do not change.

- `notes.create` and `notes.update` encrypt the content field. Titles remain
  plaintext.
- `notes.get`, `notes.list`, and search decrypt note content in memory. There is
  no persistent plaintext search index.
- File `put` encrypts bytes before writing to the base blob store. File `get`
  decrypts after reading.
- File checksums are SHA-256 over ciphertext at rest. `files.create` recomputes
  the checksum from stored ciphertext and ignores the plaintext checksum
  argument. A missing blob returns `checksum: null`.
- Sync sidecars receive ciphertext for content-bearing fields. They never receive
  a plaintext duplicate of note content or file bytes.
- `transaction` throws `UnsupportedError("encrypted_transaction")`. Core
  services do not use encrypted transactions; migration and restore use
  `base.restore` with a complete encrypted snapshot.
- Restore accepts a snapshot, maps it to the current workspace ID, encrypts every
  covered value under the target workspace key, marks the internal snapshot
  `blobEncoding: "encrypted"`, and calls `base.restore`. The marker lets the
  adapter keep plaintext file `sizeBytes` metadata while storing longer
  ciphertext blobs.

## Drafts

Plaintext workspaces keep the synchronous journal at
`opennest:draft:note:<workspaceId>:<noteId>`.

Encrypted workspaces use an asynchronous `DraftStore` at
`opennest:edraft:note:<workspaceId>:<noteId>`. The complete draft record is
encrypted, including title, content, base title, base content, and saved time.
The key name and AAD expose only workspace and note identifiers.

Autosave calls the normal IndexedDB save and the encrypted draft. It never writes
a plaintext draft fallback while encryption is active. Lifecycle writes on
`pagehide`, hidden, unmount, and update are best effort because the browser may
freeze the page before an asynchronous write settles. The UI must say so and
must not promise crash-proof drafts in encrypted mode.

During migration, plaintext drafts are copied to encrypted keys and decrypted
for comparison before the encrypted base restore commits. Plaintext drafts are
deleted only after the new base is readable. A failure before commit leaves the
plaintext drafts readable.

## Unlock, lock, and memory

- The application shows the unlock screen before mounting workspace data views.
- A successful unlock derives the KEK, unwraps the DEK, and keeps the key context
  in memory.
- Lock clears the key context, unmounts data views, cancels in-flight plaintext
  work where possible, and broadcasts a lock event to other tabs.
- JavaScript garbage collection is not reliable zeroization. The threat model
  treats memory scraping while unlocked as out of scope.
- An XSS or compromised page while unlocked can read plaintext and use key
  handles. D3 does not protect against that.

## Recovery

The workspace recovery key is 256 random bits encoded with a checksum in grouped
characters. It is displayed once during setup and must be confirmed before setup
completes. It is never uploaded, never stored in plaintext, and never included in
a backup.

Recovery opens the workspace DEK only. It does not open the credential vault or
any backup. Losing both the passphrase and the recovery key makes encrypted
workspace content and encrypted drafts permanently unreadable.

A recovery attempt uses the same rate limiting and failure reporting as a
passphrase attempt. Error messages must not reveal whether the passphrase or the
recovery key was closer to correct.

## Rotation

A passphrase change derives a new KEK with fresh KDF parameters and re-wraps the
existing DEK. It keeps the DEK key ID because stored envelopes are bound to it.
Content is not re-encrypted.

A suspected passphrase, KEK, or DEK compromise rotates the DEK:

1. Create a pending key ID and wrapped DEK in the keyring.
2. Build an encrypted snapshot under the pending key with fresh CEKs.
3. Verify a decrypt round-trip.
4. Commit the snapshot through `base.restore`.
5. Remove the old key material and set the pending key active.
6. Clean up old blobs. The app rotates encrypted drafts through a temp-key
   journal before committing the workspace rotation, so an interruption cannot
   leave a mix of old and new drafts.

The draft journal is stored at `opennest:rotation:draft-journal:v1`; temp drafts
use `opennest:rdraft:` keys. Staging writes the journal as not ready, copies
drafts under the pending key, verifies each copy, then marks the journal ready.
Finalization decrypts temp drafts with the new key, writes and verifies the main
encrypted draft keys, removes the temp copies, and clears the journal. On unlock,
the app inspects which key encrypted the workspace and resumes from the journal:
pending workspace content is finalized and committed, while old workspace content
discards stale temp drafts and keeps the pending key for a retry. The recovery key
can also unlock the pending key and finish rotation.

The keyring keeps active and pending wrapped DEKs so an interrupted rotation can
resume. Old ciphertext must fail after the old key is removed. Rotation of the
workspace hierarchy does not rewrite existing backup files and does not touch
the credential vault.

## Migration from plaintext

Keyring states are `preparing`, `committing`, `cleanup`, and `active`.

1. Ensure the workspace exists.
2. Create keyring state `preparing`.
3. Generate the workspace DEK and recovery key. Show the recovery key once and
   require confirmation.
4. Copy plaintext drafts to encrypted draft keys.
5. Build a fully encrypted snapshot with fresh blob keys.
6. Verify decrypt round-trip.
7. Call `base.restore` with the encrypted snapshot.
8. Delete plaintext drafts and purge old plaintext blobs.
9. Set keyring state `active`.

If restore fails before commit, plaintext storage and plaintext drafts remain
readable. Setup can be retried or cancelled before commit. Cancelling during
migration throws at the next progress checkpoint, removes encrypted draft copies,
and deletes the keyring. If the process interrupts after commit but before
cleanup, the keyring remains in `cleanup` so the app can finish removing plaintext
remnants without re-encrypting data. Unlocking a keyring in `preparing`,
`committing`, or `cleanup` resumes the migration after the secret is verified.

There is no mixed mode. A workspace is either readable as plaintext before the
commit or readable with the workspace key after the commit.

## Deletion

Deleting all local data must:

1. Flush and lock encryption work.
2. Clear plaintext and encrypted drafts. A draft clear failure aborts the
   deletion and reports the failure.
3. Delete workspace data through the storage adapter.
4. Reset privacy grants, consent records, and audit state.
5. Delete AI provider settings, AI consents, vault records, and session
   credentials. The vault is a separate key domain and is never required to read
   workspace data.
6. Delete the workspace keyring only after encrypted storage and drafts are gone.
   The keyring and AI records are listed as separate artifacts in the privacy
   inventory.
7. Recreate an empty workspace and fresh grants.

Deleting the keyring first would make a failed workspace deletion unrecoverable.
The external backup file already downloaded by the user is not deleted.

## Failure behavior

- Wrong passphrase or recovery key: fail with a generic authenticated-decryption
  error and rate-limit metadata.
- Unknown key ID, unknown algorithm, unsupported version, malformed envelope,
  truncated tag, or AAD mismatch: fail closed with a domain error.
- Missing keyring while encrypted data exists: show a locked or unrecoverable
  state, never a plaintext fallback.
- Failed migration before commit: keep plaintext readable and report the error.
- Failed migration after commit: enter `cleanup` and retry cleanup.
- Failed restore: leave the live workspace unchanged.
- Failed encrypted draft: report a warning, keep the normal save path running, and
  do not write plaintext.
- Browser storage eviction: report missing data; do not invent decrypted content.

## Verification requirements

- Known-answer tests for PBKDF2, HKDF, AES-256-GCM, base64url, and recovery-key
  encoding.
- Round-trip, wrong-key, AAD-swap, key-ID, truncation, nonce-uniqueness, and
  downgrade tests.
- Domain-separation tests proving workspace, backup, and credential-vault keys
  are not interchangeable.
- Tests proving backup v1 and v2 contain no session secret, vault secret,
  provider config, or consent record, and that restore does not recreate AI
  access.
- Dexie and SQLite tests for note, file, draft, migration, rotation, restore, and
  search behavior.
- Tests that a plaintext snapshot becomes encrypted and is mapped to the current
  workspace ID.
- Tests that a failed migration leaves plaintext readable.
- External review before any E2EE claim.

## Open gaps

- R-13-7 rollback and replay protection is not solved.
- Authenticated device enrollment is deferred with multi-device work.
- Metadata remains plaintext.
- PBKDF2 is weaker than a memory-hard KDF.
- Browser storage can be evicted.
- JavaScript cannot reliably erase key material from memory.
- Streaming large backups is not implemented; chunking reduces but does not
  remove peak memory use.
