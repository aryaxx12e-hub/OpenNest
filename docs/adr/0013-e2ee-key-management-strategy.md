# ADR 0013: E2EE key management strategy

- Status: Accepted for implementation; E2EE claim pending review
- Date: 2026-11-14
- Approval: 2026-11-16
- Context: Stage D0 Privacy and Extensibility
- Related: ADR 0005, ADR 0007, ADR 0008, ADR 0009, ADR 0011, ADR 0012
- Product conflict: ADR 0007 draft storage and ADR 0005 backup default
- Security refinement: pass 1 applied 2026-11-14
- Implementation plan: `docs/superpowers/plans/2026-11-16-d3-e2ee-key-management.md`

## Approval record

Rya approved this ADR on 2026-11-16 for Stage D3 implementation. This is an
implementation acceptance, not an end-to-end encryption claim. No code existed
when the decision was recorded.

Approved security refinements:

- R-13-1, unambiguous envelope.
- R-13-2, nonce and CEK discipline.
- R-13-4, KDF hardening and unlock rate limiting.
- R-13-5, recovery-key handling and confirmation.
- R-13-8, backup key separation and backup v2 key hierarchy.

Deferred controls:

- R-13-6, authenticated device enrollment. Device pairing is outside D3.
- R-13-7, rollback and replay protection. Sync is outside D3 and this remains an
  open gate before any E2EE claim.

Approved product decisions:

- Content-only encryption covers note bodies, attached file bytes, encrypted
  drafts, and backup v2 payloads. Titles, filenames, tags, folder names and
  structure, sizes, timestamps, and sync metadata remain plaintext. This leakage
  must be disclosed in the product.
- Workspace, credential-vault, and backup key domains remain separate. No domain
  may unwrap another domain's keys.
- ADR 0007 is amended by AD-7-1 for asynchronous encrypted drafts. ADR 0005 is
  extended by an addendum for backup v2.
- Backup v2 is the default export when encryption is active. Backup v1 remains
  importable and is clearly marked as plaintext.
- The migration must leave plaintext readable after a failure before commit.

The E2EE claim gate remains open. It requires R-13-7, the acceptance criteria
below, and an external cryptographic and implementation review to pass. Marketing,
documentation, and UI copy must not call local storage encrypted until then.

## Context and problem

End-to-end encryption is a target, but no encryption exists today. Notes, file
bytes, drafts, and backups are plaintext. The PRD explicitly says browser storage
must not be falsely described as encrypted.

Future cloud and self-hosted storage need a key management design that works
offline, supports recovery, and uses standard cryptography. It must not introduce
a mandatory account or a server-side key escrow.

## Goals

- Protect content from storage providers and network observers.
- Keep keys under user control.
- Support offline use.
- Define recovery and a path to multiple devices.
- Use only standard WebCrypto primitives.

## Non-goals

- Implement E2EE in this ADR.
- Protect against a compromised device or XSS while unlocked.
- Encrypt all metadata by default.
- Implement group keys or collaboration.
- Implement server-side key escrow.
- Claim E2EE before implementation and review.

## Constraints

- WebCrypto only.
- No new dependency is required by this ADR.
- No custom cryptographic algorithm.
- No server password reset.
- Local-only mode must still work.
- E2EE is optional until the user enables it.
- The PRD's "do not falsely describe storage as encrypted" rule is binding.

## Alternatives considered

1. Server-managed keys. Rejected because it is not E2EE.
2. A passphrase-only master key. Simple, but weak multi-device and recovery story.
3. Envelope encryption with a workspace DEK, per-file CEK, recovery key, and
   device wrapping. Recommended.
4. WebAuthn or passkey-derived keys. Deferred.
5. Per-file keys only. Rejected as too complex for notes.

## Decision

### Workspace key hierarchy

This hierarchy protects workspace content only. It does not protect AI
credentials or backups.

- A workspace passphrase derives a workspace key-encryption key (KEK) with
  PBKDF2-SHA-256, a per-workspace salt, an initial floor of 600,000 iterations,
  and versioned parameters.
- A random 256-bit workspace data-encryption key (DEK) is wrapped by the workspace
  KEK using AES-256-GCM with a unique 96-bit nonce and AAD binding the workspace
  and key ID.
- Each note write uses a fresh content-encryption key (CEK) wrapped by the
  workspace DEK, so an AES-GCM key is not reused across writes. The CEK is used
  once with a random 96-bit nonce.
- Each file version uses a fresh CEK wrapped by the workspace DEK.
- File bytes are encrypted with AES-256-GCM. AAD includes workspace ID, entity
  type, entity ID, key ID, and version.
- A random 256-bit workspace recovery key is displayed once and wraps the
  workspace DEK with AES-256-GCM and a unique nonce. It is never stored on a
  server.

### Separate key domains

Workspace E2EE, the AI credential vault, and backup encryption are separate key
domains. They may share cryptographic primitives and envelope conventions, not key
material.

- The workspace KEK, workspace DEK, workspace CEKs, and workspace recovery key
  protect workspace content only.
- The AI credential vault is defined by ADR 0011 and has its own KEK, DEK, entry
  CEKs, recovery policy, and rotation. It is not a workspace key hierarchy.
- The backup KEK, backup DEK, and backup recovery key protect one backup file
  only.
- No workspace key unwraps a credential-vault key or a backup key. No
  credential-vault key unwraps workspace content or a backup. No backup key
  unwraps live workspace storage or credentials.
- Workspace recovery does not open the credential vault. Credential-vault
  recovery does not open the workspace. Backup restore does not open the
  credential vault.

### Device and recovery model

- Phase 1 supports one device plus the workspace recovery key. This recovery
  covers workspace content only.
- Phase 2 adds device wrapping with ECDH P-256 and HKDF.
- A device roster signed with ECDSA P-256 is required before multi-device sharing
  is enabled.
- No server-side recovery. Lost workspace passphrase plus lost workspace recovery
  key means permanent workspace data loss.

### Workspace rotation

- A normal workspace passphrase change rewraps the workspace DEK for the
  passphrase.
- A suspected workspace passphrase or workspace KEK compromise rotates the
  workspace DEK, re-encrypts covered content under new CEKs, and rewraps the
  workspace recovery key.
- Device revocation removes the device's wrapped workspace key. If the device
  received the workspace DEK, revocation also rotates the workspace DEK,
  re-encrypts covered content under new CEKs, rewraps the workspace recovery key,
  and redistributes only to remaining devices.
- A suspected workspace DEK compromise rotates the workspace DEK, rewraps the
  workspace recovery key, and re-encrypts all covered content.
- A suspected workspace CEK compromise re-encrypts only the affected content.
- Blob CEKs are rotated when the related file is rewritten.
- Workspace key rotation does not rotate the credential vault or existing backup
  files.

### Local behavior

- E2EE mode is optional.
- When enabled, the application requires unlock and decrypts content in memory.
- Local search runs on decrypted in-memory data. There is no cloud-side search.
- Any persistent search index, thumbnail, or preview cache is covered content and
  is encrypted, or disabled in E2EE mode.
- Metadata such as names, tags, sizes, and folder structure remains plaintext by
  default. This leakage must be documented.

### Drafts

ADR 0007 stores note drafts as plaintext in localStorage. E2EE cannot be claimed
while that remains true.

Two options are recorded:

1. Encrypt drafts with the DEK and version the draft envelope. Recommended.
2. Disable draft recovery in E2EE mode with a clear warning. Allowed only as a
   temporary limitation.

ADR 0007 remains in force until an amendment is accepted. This ADR does not
silently rewrite it.

### Backup key hierarchy and policy

- When E2EE is enabled, backup format v2 is encrypted by default.
- Plaintext backup v1 remains importable and is clearly flagged.
- A backup key source, either a backup passphrase or a backup recovery key,
  derives a backup KEK with PBKDF2-SHA-256, a backup-specific salt, domain
  separation, and versioned parameters.
- Each backup generates a fresh 256-bit backup DEK. The backup KEK wraps the
  backup DEK with AES-256-GCM, a unique nonce, and AAD binding backup format,
  key ID, and chunk index.
- Backup payloads use AES-256-GCM with unique nonces. The backup DEK is never the
  workspace DEK, a workspace CEK, a credential-vault key, or any live key.
- The backup recovery key is distinct from the workspace recovery key and the
  credential-vault recovery key.
- Backup recovery opens only that backup file. It does not open live workspace
  storage or the credential vault.
- Backup v1 and backup v2 exclude credentials by default. A backup cannot restore
  provider access.
- Restore requires the backup key source, not the live workspace passphrase.
- Restore decrypts with the backup key and re-encrypts content under the target
  workspace DEK, or a new workspace DEK when creating a workspace. The backup DEK
  is never installed as a live key.
- Backup key rotation is per backup: re-export or rewrap. Workspace DEK rotation
  does not rewrite old backups; restore re-encrypts.
- A plaintext export is available only with an explicit warning.
- ADR 0005 remains valid for v1 and is extended, not replaced silently.

### Claim policy

No E2EE claim is made until:

- All covered paths are encrypted.
- Migration is complete.
- The threat model is documented.
- An external security review passes.

## Security refinement pass 1

This pass tightens the cryptographic envelope and lifecycle. It does not implement
encryption or authorize an E2EE claim.

### Threat model additions

- AES-GCM nonce reuse or key-state rollback.
- Ciphertext swapping between records, workspaces, or versions.
- Algorithm or KDF parameter downgrade.
- Recovery-key theft, loss, or accidental disclosure.
- Malicious or accidental device enrollment.
- Server rollback, replay, and truncation of encrypted history.
- Backup theft or restore of the wrong key material.
- Partial migration that leaves mixed plaintext and ciphertext state.
- XSS or a compromised device while the vault is unlocked.

### Required controls

1. **R-13-1, unambiguous envelope.** Every ciphertext envelope includes `version`,
   `alg`, `kid`, `iv`, AAD fields, and the wrapped key material. Unknown
   algorithms, unknown key IDs, malformed fields, and downgrade attempts are
   rejected. Key wrapping uses AES-256-GCM with a unique nonce and AAD. AES-GCM
   uses a 128-bit authentication tag; truncated tags are rejected. AES-KW is not
   used.
2. **R-13-2, nonce discipline.** A 96-bit AES-GCM nonce must never repeat under
   the same key. Every note write and every file version uses a fresh CEK, so a
   CEK encrypts exactly one payload with one random nonce. A retry generates a new
   CEK and nonce; it never re-encrypts with a reused CEK. A CEK encrypts content
   at most once. It may be restored for decryption, but never for a new
   encryption. If single use cannot be proven, encryption fails closed. Low-volume
   key wrapping uses a random 96-bit nonce. Randomness comes from
   `crypto.getRandomValues`.
3. **R-13-3, AAD binding.** AAD binds workspace ID, entity type, entity ID, key
   ID, envelope version, and purpose. A ciphertext moved to another record,
   workspace, or version must fail authentication. Derived artifacts such as
   search indexes, thumbnails, and preview caches are bound the same way or are
   not persisted.
4. **R-13-4, KDF hardening.** PBKDF2-SHA-256 uses a random 128-bit salt, an
   initial floor of 600,000 iterations, versioned parameters, and a rate-limited
   unlock. Parameters may increase while unlock time remains acceptable; lowering
   the floor requires security approval. The UI gives passphrase-strength guidance
   and never stores a password hint. No password or key material enters logs,
   URLs, or analytics.
5. **R-13-5, recovery-key handling.** The recovery key is 256 bits, encoded with a
   checksum in grouped characters, displayed once, and confirmed before setup
   completes. It is never stored on a server and never appears in plaintext
   backups. Loss of both passphrase and recovery key is permanent.
6. **R-13-6, authenticated device enrollment.** Phase 2 enrollment requires a
   user-confirmed device fingerprint or a short-lived pairing code delivered out
   of band. A new device is never added silently. The ECDSA P-256 signed roster
   records revocation, and a revoked device cannot receive new key material.
7. **R-13-7, rollback and replay protection.** Before any E2EE claim, the sync
   design must define client-pinned revision checks or authenticated metadata
   that detect server rollback, replay, and truncation. This is an open gate, not
   a solved property.
8. **R-13-8, backup key separation.** Backup v2 generates a fresh backup DEK and
   wraps it with a backup KEK derived from the backup passphrase or a backup
   recovery key, with domain separation. The backup recovery key is distinct from
   the workspace recovery key and the credential-vault recovery key. The workspace
   DEK and credential-vault keys are never included in the backup. The backup
   envelope is authenticated with AES-GCM and includes its own KDF parameters and
   key ID. Restore requires an explicit backup key source and verifies the key ID
   before decrypting content.
9. **R-13-9, lock and migration behavior.** Lock clears in-memory plaintext and
   keys as far as the browser allows. Migration verifies a decrypt round-trip
   before deleting plaintext, is resumable, and fails closed on partial state. A
   failed migration leaves the original plaintext readable.
10. **R-13-10, crypto agility and review.** Algorithms and parameters are
    versioned and can be migrated. A downgrade requires explicit user action and
    a warning. External cryptographic review is a release gate for any E2EE
    claim.

### Residual risks

- XSS while unlocked can read plaintext and key handles.
- JavaScript garbage collection is not a reliable zeroization mechanism.
- Metadata such as names, tags, sizes, and folder structure remains visible.
- PBKDF2 is weaker than a memory-hard KDF.
- Browser cryptographic implementations and platform randomness remain trusted
  components.
- Revocation prevents future access but cannot erase content a revoked device
  already decrypted.
- Rollback protection is unresolved until the sync design exists.

### Refinements requiring approval

- R-13-1 and R-13-2 change the key hierarchy and envelope format. Every note write
  gains a fresh CEK.
- R-13-6 adds a device-pairing confirmation step.
- R-13-7 makes rollback protection a hard gate before any E2EE claim.
- R-13-8 changes backup v2 key handling.
- R-13-4 introduces a KDF iteration floor and unlock rate limit.

## Trade-offs

- Lost workspace passphrase plus lost workspace recovery key means permanent
  workspace data loss.
- Users manage separate workspace, credential-vault, and backup key sources.
  Losing one does not recover another.
- Unlock friction on every session.
- Encryption and decryption cost.
- Search and preview must work in memory.
- Metadata remains visible unless a later ADR adds metadata encryption.
- PBKDF2 is weaker than memory-hard KDFs, but adding Argon2 requires a dependency
  and review.

## Security and privacy implications

- XSS while unlocked can steal plaintext and keys.
- Rollback and replay protection must be designed for sync.
- Device enrollment and revocation need authenticated messaging.
- Workspace, credential-vault, and backup keys must remain separate domains.
- Workspace recovery must not open the credential vault.
- Backup encryption must include its own key-wrapping metadata.
- Metadata leakage remains a product risk.
- Recovery key handling is a usability and security risk.

## Compatibility with Stages A to C

- Encryption sits at the storage or composition boundary.
- Core domain remains unchanged.
- Backup v2 is additive.
- Sync metadata remains plaintext unless a later ADR changes it.
- Workspace E2EE and the credential vault are independent. Enabling one does not
  enable, unlock, or recover the other.
- ADR 0007's draft layer needs an amendment before E2EE can be claimed.

## Dependencies

- ADR 0008.
- ADR 0009.
- ADR 0012.
- ADR 0011 cross-reference for credential-vault separation only. ADR 0011 may
  reuse shared primitives, but it does not share workspace or backup keys.

## Migration implications

- Opt-in plaintext to encrypted migration.
- Progress, resumability, and failure recovery are required.
- Draft migration is required.
- Backup v2 is required.
- Rollback requires decrypting first.
- Key setup and workspace recovery-key confirmation are required.
- A failed migration must leave plaintext data readable.
- No workspace key is migrated into the credential vault or a backup. Backup
  restore creates or targets a workspace key hierarchy; it does not import the
  backup DEK as a live workspace key.

## Resolved decisions and open gates

The conflicts below were resolved for D3 implementation on 2026-11-16. They
remain recorded so a later change cannot silently undo the decision.

- **ADR 0007 conflict, resolved:** plaintext drafts cannot coexist with an E2EE
  claim. ADR 0007 amendment AD-7-1 accepts asynchronous encrypted drafts, keeps
  the plaintext draft prefix for plaintext workspaces, and forbids a plaintext
  fallback in encrypted mode.
- **ADR 0005 conflict, resolved:** v1 backups are plaintext. Encrypted v2 is
  additive, becomes the default when encryption is active, and leaves v1
  importable with a plaintext warning. ADR 0005 is extended, not superseded.
- **PRD scope conflict, resolved:** D3 encrypts content only. Metadata remains
  plaintext and must be documented as a residual risk.
- **Key-domain conflict, resolved:** workspace recovery, credential-vault
  recovery, and backup recovery remain separate domains. The credential-vault
  hierarchy is owned by ADR 0011. No key material crosses domains.
- **PBKDF2 trade-off, accepted:** PBKDF2-SHA-256 with a 600,000-iteration floor is
  used because D3 allows no new dependency. Argon2 remains a future option that
  requires a format migration and review.
- **No claim, still binding:** the product must not describe local storage as
  encrypted until implementation, the acceptance criteria, R-13-7, and external
  review are complete.

Open gates before an E2EE claim:

- R-13-7 rollback and replay protection is not solved.
- Authenticated device enrollment (R-13-6) is deferred with multi-device work.
- External cryptographic and implementation review has not started.
- Security review must confirm that migration, drafts, backup v2, rotation, and
  lock behavior match this design.

## Acceptance criteria

These criteria gate the E2EE claim. The implementation acceptance above does not
assert that they are met.

- Threat model and crypto specification exist.
- Workspace key hierarchy, backup key hierarchy, recovery, rotation, and device
  enrollment are specified.
- Workspace, credential-vault, and backup key domains are separate.
- Workspace recovery cannot open the credential vault. Credential-vault recovery
  cannot open the workspace.
- Backup v1 and v2 exclude credentials. Backup recovery cannot open the credential
  vault.
- No key domain is used as another domain's KEK, DEK, or CEK.
- Migration path is specified.
- No E2EE claim is made before implementation and security review.
- All cryptographic operations use WebCrypto only.
- Draft and backup conflicts are resolved through approved amendments.
- Every envelope carries version, algorithm, key ID, nonce, and AAD fields.
- Algorithm and key-ID downgrade attempts are rejected.
- Nonce reuse, CEK reuse, and ambiguous key state fail closed.
- AAD binding prevents cross-record, cross-workspace, and cross-version swaps.
- Recovery key uses a checksummed encoding and a confirmation step.
- Device enrollment requires out-of-band confirmation.
- Rollback and replay protection is defined before any E2EE claim.
- Backup v2 has a fresh backup DEK, separated key material, and verified key IDs.
- The backup DEK is never installed as a live workspace key.
- Migration verifies round-trip decryption before deleting plaintext.
- Persistent search indexes, thumbnails, and preview caches are encrypted or
  disabled in E2EE mode.
- The initial PBKDF2 floor is 600,000 iterations and may only increase without a
  format change.
- External crypto review is a release gate.

## Testing strategy

- WebCrypto known-vector tests.
- IV and nonce uniqueness tests, including cloned-state, retry, and rollback cases.
- Wrong-key, AAD-swap, cross-record, and cross-version tamper tests.
- Algorithm and KDF downgrade tests.
- Recovery-key encoding, confirmation, and loss tests.
- Workspace recovery, vault recovery, and backup recovery independence tests.
- Cross-domain key separation tests: a workspace key cannot decrypt backup or
  vault data, a backup key cannot decrypt workspace or vault data, and a vault key
  cannot decrypt workspace or backup data.
- Rotation, key-ID, and CEK-reuse tests.
- Device enrollment, pairing-code, fingerprint, and revocation tests.
- Server rollback, replay, and truncation tests.
- Migration partial-state and round-trip verification tests.
- Persistent search index, thumbnail, and preview cache encryption tests.
- Backup v2 key-separation, workspace-DEK exclusion, credential exclusion, and
  wrong-key-ID tests.
- E2E tests.
- External security review.
