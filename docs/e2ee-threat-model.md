# E2EE threat model

Status: design threat model for Stage D3. It describes properties the
implementation must provide. It is not evidence that those properties exist.
OpenNest does not claim end-to-end encryption until implementation, the
acceptance criteria, and external review are complete.

Related documents:

- ADR 0013, E2EE key management strategy.
- ADR 0007 amendment AD-7-1, asynchronous encrypted drafts.
- ADR 0005 addendum, encrypted backup format v2.
- `docs/e2ee-key-management.md`.
- `docs/backup-format-v2.md`.
- `docs/e2ee-security-review.md`.

## Security objectives

1. Note bodies and attached file bytes are unreadable at rest without workspace
   key material.
2. Encrypted drafts do not expose note text or draft titles to plaintext browser
   storage.
3. Backup v2 payloads are unreadable without the backup key source and are bound
   to the backup file, key ID, and chunk index.
4. A ciphertext moved between records, workspaces, versions, or chunk positions
   fails authentication.
5. A failed migration before commit leaves the original plaintext readable.
6. A failed unlock, restore, rotation, or migration never silently falls back to
   plaintext.
7. Workspace, backup, and credential-vault keys remain separate.
8. The product does not claim E2EE before external review passes.

## Assets

- Workspace passphrase and workspace recovery key.
- Workspace KEK, DEK, and per-write CEKs.
- Note bodies and encrypted drafts.
- File bytes and encrypted backup payloads.
- Keyring state and wrapped key material.
- Backup passphrase or backup recovery key.
- Credential-vault keys and provider credentials, which are outside D3 but must
  remain isolated.
- Integrity of migration, rotation, and restore state.

Metadata is an asset for privacy but is explicitly not protected by D3: titles,
filenames, tags, folder names and structure, MIME types, sizes, checksums as
product metadata, timestamps, workspace names, counts, and sync metadata remain
observable.

## Actors and trust boundaries

| Actor or boundary          | Capability                                          | Trusted for                         |
| -------------------------- | --------------------------------------------------- | ----------------------------------- |
| User                       | Knows passphrase and recovery key                   | Authorization and key custody       |
| Application JavaScript     | Sees plaintext and key handles while unlocked       | Correct implementation while loaded |
| WebCrypto                  | Performs primitives                                 | Algorithm implementation            |
| IndexedDB and localStorage | Stores ciphertext, keyring records, and metadata    | At-rest persistence                 |
| Browser or OS              | May be compromised, copied, or evicted              | Platform randomness and storage     |
| Backup thief               | Has a backup file, not the passphrase or backup key | No access to backup plaintext       |
| XSS or malicious script    | Runs in the origin while the app is unlocked        | No trust; can read plaintext        |
| Future sync server         | Stores sync records and metadata                    | No access to content keys           |
| Future device              | May join through enrollment                         | Only after authenticated enrollment |

The primary trust boundary is unlock: before unlock, protected content should be
ciphertext; while unlocked, the page is trusted to process plaintext. D3 does not
protect a compromised device or malicious code running in the unlocked origin.

## Threats and controls

### T1. Plaintext data at rest

Threat: someone copies IndexedDB, localStorage, or a backup file and reads note
bodies or file bytes.

Controls:

- Encrypt note content, file bytes, encrypted drafts, and backup v2 payloads.
- Keep keys in a separate keyring database, not in workspace tables.
- Do not write plaintext copies to sync sidecars, search caches, thumbnails, or
  preview caches.
- Exclude drafts and keyring records from backups.

Residual risk: metadata remains plaintext. Browser storage can be evicted or
copied. A backup exported in v1 or plaintext mode remains plaintext.

### T2. Nonce or CEK reuse

Threat: an AES-GCM nonce repeats under the same key, or a CEK encrypts more than
one payload, exposing plaintext and authentication.

Controls:

- Generate a fresh 256-bit CEK for every write.
- Use a random 96-bit nonce for each payload and each key wrap.
- Never retry encryption with a reused CEK.
- Fail closed if secure randomness or single-use state cannot be established.
- Test nonce uniqueness across writes, retries, restore, and rotation.

Residual risk: a broken platform random number generator. WebCrypto and platform
randomness are trusted components.

### T3. Ciphertext swapping

Threat: an attacker moves a ciphertext to another note, file, workspace, version,
or backup chunk to confuse or corrupt the application.

Controls:

- Bind workspace ID, purpose, entity type, entity ID, key ID, envelope version,
  and file or chunk version in AAD.
- Reconstruct AAD from trusted context, not from untrusted envelope fields.
- Verify the key ID before decryption.
- Test cross-record, cross-workspace, cross-version, and chunk-index swaps.

Residual risk: a compromised device that can call the application with attacker
chosen context while unlocked.

### T4. Algorithm and parameter downgrade

Threat: an attacker changes an envelope to an older algorithm or weakens KDF
parameters.

Controls:

- Version algorithms and envelopes.
- Allow only AES-256-GCM with 128-bit tags and PBKDF2-SHA-256 above the floor.
- Authenticate KDF parameters in backup AAD.
- Reject unknown versions, algorithms, key IDs, and malformed fields.
- Require explicit user action and a warning for any future downgrade migration.

Residual risk: future algorithm migration needs its own review.

### T5. Passphrase guessing

Threat: an attacker copies the keyring and guesses the workspace passphrase
offline.

Controls:

- PBKDF2-SHA-256 with at least 600,000 iterations and a random 128-bit salt.
- Passphrase-strength guidance and no password hint.
- Client-side unlock rate limiting for online attempts.
- No passphrase in logs, URLs, analytics, or error messages.
- Encourage the recovery key and backup separation.

Residual risk: PBKDF2 is not memory-hard. A weak passphrase remains weak against
offline guessing. Rate limiting only slows attempts through the UI; it does not
protect a copied keyring.

### T6. Recovery-key theft or loss

Threat: an attacker obtains the recovery key, or the user loses both passphrase
and recovery key.

Controls:

- Display the recovery key once during setup and require confirmation.
- Encode it with a checksum and grouped characters.
- Never store it in plaintext, upload it, or include it in a backup.
- Use the same generic failure and rate limiting as passphrase unlock.
- Document permanent data loss when both secrets are lost.

Residual risk: a photographed or pasted recovery key can be stolen. A lost key
cannot be recovered by OpenNest.

### T7. Partial migration

Threat: migration stops after some data is encrypted and some is plaintext, and
the user is locked out or mixed state persists.

Controls:

- Use explicit keyring states: `preparing`, `committing`, `cleanup`, `active`.
- Build and verify a complete encrypted snapshot before committing.
- Use `base.restore` for the encrypted snapshot.
- Delete plaintext drafts and blobs only after commit and cleanup verification.
- Keep plaintext readable on failure before commit.
- Resume cleanup after a crash after commit.
- Test interruptions at every step.

Residual risk: a browser crash can leave cleanup work. The workspace must remain
readable, and cleanup must be retryable.

### T8. Plaintext drafts

Threat: note text or draft titles remain in localStorage after encryption is
enabled.

Controls:

- Use the encrypted draft prefix and encrypt the whole draft record.
- Do not write a plaintext fallback in encrypted mode.
- Copy and verify drafts before deleting plaintext drafts during migration.
- Clear drafts on lock, deletion, and restore as specified.
- Test at-rest storage for plaintext fragments.

Residual risk: asynchronous lifecycle writes are best effort. A page freeze at
the wrong instant can lose the newest draft. The normal save path still runs.

### T9. Backup key-domain confusion

Threat: a backup key is used as a workspace key, or a workspace key is included
in a backup, allowing one compromised domain to open another.

Controls:

- Generate a fresh backup DEK per export.
- Derive a separate backup KEK with a distinct domain label.
- Never include workspace keys, keyring records, credentials, or drafts in a
  backup.
- Verify backup key ID and KDF parameters before decryption.
- Restore re-encrypts under the target workspace key; it does not install the
  backup DEK.
- Test cross-domain decryption failures.

Residual risk: the user may reuse the same passphrase for workspace and backup.
The key material remains separate, but the human secret may not be.

### T10. Wrong-workspace restore

Threat: a backup from another workspace is restored with the wrong identity, so
AAD or key domains mismatch.

Controls:

- Treat the backup workspace ID as source metadata.
- Map the snapshot to the current workspace ID before validation and restore.
- Re-encrypt every covered value under the current workspace key.
- Keep entity IDs and relationships stable.
- Reject ciphertext whose AAD does not match the target context.
- Test cross-workspace restore and AAD failure.

Residual risk: restored metadata can collide with existing names. Restore still
replaces the active library by explicit user action.

### T11. XSS or compromised device while unlocked

Threat: malicious code reads plaintext, steals keys from memory, or performs
writes through the unlocked app.

Controls:

- Avoid unsafe HTML rendering and untrusted script execution.
- Keep CSP and dependency review in place.
- Lock on explicit user action and broadcast lock events.
- Do not expose raw storage adapters to feature components.
- Keep secrets out of logs and URLs.

Residual risk: XSS while unlocked defeats client-side encryption. D3 cannot
protect against a compromised browser or device. This must be stated in the
security review and product documentation.

### T12. Memory and garbage collection

Threat: plaintext or key material remains in memory after lock.

Controls:

- Drop references to keys and plaintext on lock.
- Unmount data views and cancel work where possible.
- Avoid unnecessary copies of plaintext.
- Do not claim reliable zeroization.

Residual risk: JavaScript garbage collection and browser memory snapshots are
outside application control.

### T13. Metadata leakage

Threat: titles, filenames, tags, folder structure, sizes, and timestamps reveal
sensitive information even when content is encrypted.

Controls:

- Document the leakage in the product and Privacy Center.
- Do not claim full database encryption.
- Keep metadata out of encrypted payloads only by explicit product decision.
- Consider metadata encryption in a later ADR.

Residual risk: accepted for D3. Users with sensitive metadata need to understand
the limitation.

### T14. Rollback, replay, and truncation

Threat: a future sync server or storage attacker serves an older valid ciphertext,
replays a record, or truncates history.

Controls:

- R-13-7 is an open gate. No E2EE claim may be made until client-pinned revision
  checks or authenticated metadata detect rollback, replay, and truncation.
- Local-only mode does not claim protection against a malicious sync server.
- Restore and migration verify snapshot completeness before replacing live data.

Residual risk: unresolved before sync. This is why the E2EE claim gate remains
open even after local implementation.

### T15. Device enrollment and revocation

Threat: a new device joins silently, or a revoked device receives new key
material.

Controls:

- R-13-6 is deferred with multi-device work.
- Future enrollment requires an out-of-band confirmed fingerprint or short-lived
  pairing code.
- A signed roster records revocation.
- A revoked device does not receive new key material.

Residual risk: not applicable to single-device D3, but required before
multi-device or an E2EE claim that includes device sharing.

### T16. Key loss and deletion

Threat: the keyring is deleted or corrupted, or the user deletes all data and
expects recovery.

Controls:

- Keep the keyring separate from workspace data.
- Delete the keyring only after workspace deletion succeeds during full deletion.
- Explain that losing the passphrase and recovery key is permanent.
- Never promise server-side recovery.
- Test deletion and missing-key states.

Residual risk: an external backup may still contain plaintext v1 data. OpenNest
cannot delete a file the user already downloaded.

### T17. Logs and telemetry

Threat: secrets or plaintext appear in logs, crashes, analytics, URLs, or error
messages.

Controls:

- No telemetry or analytics by default.
- Generic authentication errors.
- No passphrase, recovery key, CEK, DEK, or plaintext in logs.
- Do not put key material in query strings or fragment identifiers.
- Review error serialization before release.

Residual risk: third-party browser or OS crash reporting outside application
control.

### T18. Search and preview caches

Threat: a persistent search index, thumbnail, or preview cache leaks plaintext.

Controls:

- Search decrypts notes in memory.
- Do not persist plaintext search results.
- Encrypt or disable persistent previews and thumbnails in encrypted mode.
- Test that storage contains no plaintext fragments after search and preview.

Residual risk: performance cost from decrypting on each search and preview.

### T19. Backup completeness and corruption

Threat: an export silently omits a blob or a backup is truncated, and the user
believes it is complete.

Controls:

- Fail export if a stored blob is missing.
- Validate chunk count, indexes, tags, snapshot schema, references, and checksums
  before restore.
- Report progress and completion only after the file is written.
- Do not label a partial file complete.
- Test near the 25 MB file limit and large libraries.

Residual risk: the browser download can still fail after the app reports success;
the user must verify the file exists. Streaming is deferred.

### T20. Browser storage eviction

Threat: the browser evicts IndexedDB or localStorage and encrypted data is lost.

Controls:

- Explain browser storage limits and backup responsibility.
- Do not treat browser storage as permanent.
- Keep backup export local and explicit.
- Surface missing or unreadable data instead of showing an empty workspace.

Residual risk: encryption does not prevent eviction. Without a backup or key
material, eviction is permanent.

## Out of scope

- A compromised device or malicious browser extension while unlocked.
- XSS that executes with the application's privileges.
- Coercion or physical access to an unlocked device.
- Metadata confidentiality.
- Server-side key escrow or password reset.
- Multi-device enrollment and revocation in D3.
- Sync rollback and replay protection in D3.
- Credential-vault encryption in D3.
- Side-channel attacks beyond standard WebCrypto behavior.
- Reliable memory zeroization.

## Security review checklist

The E2EE gate cannot close until all of these are true:

- [ ] Threat model reviewed and accepted.
- [ ] Key hierarchy and domain separation reviewed.
- [ ] Envelope, AAD, nonce, CEK, and downgrade tests pass.
- [ ] Keyring corruption, rate limit, recovery, and deletion tests pass.
- [ ] Dexie and SQLite encryption, migration, rotation, and restore scenarios
      pass.
- [ ] Draft migration and at-rest plaintext checks pass.
- [ ] Backup v2 key separation, chunk binding, checksum, and current-workspace
      restore tests pass.
- [ ] Lock, reload, and autosave race tests pass.
- [ ] XSS and unsafe rendering review passes.
- [ ] Metadata leakage is documented in the UI, README, and Privacy Center.
- [ ] R-13-7 rollback and replay protection is resolved or the product continues
      to withhold the E2EE claim.
- [ ] R-13-6 enrollment is resolved before any multi-device claim.
- [ ] External cryptographic and implementation review passes.
- [ ] No document, UI, or release note claims E2EE before the gate closes.
