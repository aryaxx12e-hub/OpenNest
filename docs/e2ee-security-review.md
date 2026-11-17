# E2EE security review

Status: implementation and automated tests complete; internal review follow-up
complete; independent review not started. This document is a release gate and
checklist, not a report. OpenNest does not claim end-to-end encryption until the
review is complete and the claim criteria are met.

## Implementation evidence

Recorded 2026-11-17 for the D3 implementation:

- `npm test`: 1,119 tests in 95 files passed, including envelope, keyring,
  migration, rotation, encrypted Dexie/SQLite storage, encrypted drafts, backup
  v2, localization parity, privacy inventory, and the encrypted-note draft
  regression coverage.
- `npm run test:e2e:encryption`: passed at 412 x 915. It covers setup and
  recovery-key confirmation, encrypted note autosave, encrypted file upload and
  preview, encrypted search, reload lock with deep-link preservation, wrong
  passphrase handling, backup v2 export with a backup key, no plaintext title
  leakage, delete-all keyring removal, wrong backup key handling, and v2 restore
  of notes and file bytes, with no console errors.
- Envelope parsing rejects duplicate JSON keys at any depth, including escaped
  duplicates, and empty plaintext is accepted only with a valid authentication
  tag. Regression tests cover duplicate keys and empty-plaintext authentication.
- Internal review follow-up fixed the plaintext draft leak in encrypted
  workspaces, fail-closed startup when an encrypted base has no keyring,
  passphrase trimming, metadata copy, missing security headers, unbounded backup
  KDF parameters, duplicate outer backup JSON keys, dual-store draft cleanup,
  PWA recovery through the active encrypted draft store, the Privacy Center
  export encryption notice, and restored workspace identity for encrypted
  imports. Each fix has regression coverage.
- Typecheck, ESLint, Prettier check, browser dependency graph, and the production
  build passed.

## Unresolved risks

1. Independent cryptographic and implementation review has not started, so the
   E2EE claim gate remains closed.
2. R-13-7 rollback and replay protection is not implemented. A future sync
   server would need authenticated ordering, replay rejection, and rollback
   detection before any sync encryption claim.
3. Note titles, filenames, tags, folder names and structure, sizes, timestamps,
   and sync metadata remain plaintext by design.
4. Losing both the passphrase and the recovery key makes encrypted workspace
   content and encrypted drafts permanently unreadable. The keyring stores no
   recovery escrow.
5. Memory zeroization is best effort; a compromised device or XSS while the
   workspace is unlocked is outside the D3 threat model.
6. Credential-vault encryption and multi-device key wrapping are out of scope.
7. Setup, rotation, and delete-all are not fully serialized against in-flight
   autosaves in other tabs. The current implementation reduces the window but
   does not provide a cross-tab exclusive operation barrier.

## Purpose

Stage D3 adds optional workspace encryption, encrypted drafts, migration,
rotation, recovery, and encrypted backup v2. A passing test suite is necessary
but not sufficient. This gate requires an independent review of the design, the
implementation, and the user-facing behavior.

## Review scope

In scope:

- Workspace key hierarchy, keyring, unlock, lock, rate limit, recovery, rotation,
  and deletion.
- AES-256-GCM envelopes, nonce and CEK discipline, AAD binding, key IDs,
  algorithm versions, and fail-closed parsing.
- Dexie and SQLite storage wrappers, note and file encryption, checksums, search,
  and sync sidecar behavior.
- Encrypted drafts, autosave lifecycle, reload and lock races, and migration.
- Backup v2 key hierarchy, chunking, AAD, checksums, restore mapping, and v1
  compatibility.
- Migration from plaintext, interrupted states, cleanup, and rollback limits.
- UI copy, localization, error messages, Privacy Center inventory, and data
  deletion.
- Metadata leakage and the no-claim policy.

Out of scope for this review:

- Credential-vault encryption, which is owned by ADR 0011.
- Multi-device enrollment and revocation, deferred with R-13-6.
- Sync rollback and replay protection, deferred with R-13-7.
- A compromised device or XSS while unlocked.
- Reliable memory zeroization.
- Metadata confidentiality, which D3 explicitly does not provide.

## Required artifacts

The reviewer must receive:

- ADR 0013 with its approval record and open gates.
- ADR 0007 amendment AD-7-1.
- ADR 0005 addendum.
- `docs/e2ee-key-management.md`.
- `docs/e2ee-threat-model.md`.
- `docs/backup-format-v2.md`.
- The D3 implementation plan and changed-file list.
- Test evidence for every required scenario, including negative tests.
- A working build and instructions to run the E2E encryption flow.
- Known limitations and unresolved risks.

## Review checklist

### Design

- [ ] Domain separation is explicit and enforced for workspace, backup, and
      credential-vault key material.
- [ ] Workspace recovery cannot open a backup or the credential vault.
- [ ] Backup recovery cannot open live workspace data or credentials.
- [ ] The backup DEK is fresh per export and never becomes a live key.
- [ ] KDF parameters are versioned, authenticated, and at or above the floor.
- [ ] Envelope fields are unambiguous and reject unknown versions, algorithms,
      key IDs, and malformed data.
- [ ] AAD binds workspace, purpose, entity, key ID, version, and backup chunk
      context.
- [ ] Fresh CEK per write is proven, including retries and migration.
- [ ] Nonce generation uses secure randomness and is tested for uniqueness.
- [ ] Metadata leakage is documented and accepted for D3.

### Implementation

- [ ] Keyring records contain no raw passphrase, DEK, CEK, or recovery key.
- [ ] The keyring is separate from workspace storage and excluded from backups.
- [ ] Wrong passphrase, wrong recovery key, corrupt keyring, and missing keyring
      fail closed.
- [ ] Unlock rate limiting cannot be bypassed by the normal UI path.
- [ ] Lock clears key references and unmounts data views.
- [ ] Multi-tab lock and setup events do not leave a tab with stale plaintext.
- [ ] Encrypted drafts contain no plaintext title or content.
- [ ] Search and preview do not persist plaintext indexes or caches.
- [ ] Sync sidecars contain ciphertext for covered fields and no plaintext copy.
- [ ] `transaction` fails closed in encrypted mode.
- [ ] Restore accepts only a fully encrypted snapshot and re-encrypts under the
      target key.
- [ ] A failed migration before commit leaves plaintext readable.
- [ ] A crash after commit enters a recoverable cleanup state.
- [ ] Rotation keeps a pending key only long enough to resume safely.
- [ ] Full deletion removes the keyring only after workspace deletion succeeds.
- [ ] No secret or plaintext enters logs, URLs, analytics, or error messages.

### Backup

- [ ] v1 is labeled plaintext and remains importable.
- [ ] v2 is the default when encryption is active.
- [ ] Wrong backup key, wrong key ID, truncated tag, reordered chunk, or missing
      chunk fails before replacing live data.
- [ ] Chunk AAD binds index and count.
- [ ] Export fails on a missing blob and never labels a partial file complete.
- [ ] Plaintext checksums are normalized for the snapshot; ciphertext checksums
      remain at rest.
- [ ] Cross-workspace restore maps to the current workspace and rebuilds AAD.
- [ ] Keyring, credentials, drafts, grants, audit entries, and sync sidecars are
      excluded.
- [ ] Large and near-limit files are tested for progress and memory behavior.

### Product and operations

- [ ] The UI never says data is encrypted before the gate is closed.
- [ ] The UI explains that titles, filenames, tags, folders, sizes, and timestamps
      remain visible.
- [ ] The UI explains that losing passphrase and recovery key means permanent
      loss.
- [ ] Recovery-key display and confirmation cannot be skipped accidentally.
- [ ] Backup key source and recovery key are distinct from workspace secrets.
- [ ] Error messages are actionable without revealing secret material.
- [ ] English and Indonesian copy are complete and consistent.
- [ ] Migration and restore warnings are clear before destructive actions.
- [ ] The Privacy Center inventory includes keyring storage and correct backup
      exclusions.

### Evidence

- [ ] Envelope known-answer, round-trip, tamper, downgrade, and nonce tests pass.
- [ ] Keyring setup, unlock, recovery, rate limit, rotation, corruption, and
      deletion tests pass.
- [ ] Domain-separation tests pass.
- [ ] Dexie and SQLite encryption, migration, rotation, and restore tests pass.
- [ ] Draft at-rest, autosave, lock, and reload tests pass.
- [ ] Backup v1/v2 compatibility and negative tests pass.
- [ ] E2E setup, unlock, create, edit, lock, reload, backup, and restore pass.
- [ ] Typecheck, lint, production build, and format checks pass.
- [ ] No critical regression remains.

## Claim criteria

The E2EE claim may be made only when:

1. All in-scope checklist items are complete.
2. R-13-7 rollback and replay protection is resolved or the claim explicitly
   excludes sync.
3. R-13-6 is resolved before any multi-device claim.
4. The external reviewer signs off on the design and implementation.
5. Remaining risks are documented in the README, Privacy Center, and threat
   model.
6. The release notes do not overstate metadata protection.

Until then, the correct product language is "optional content encryption is
being implemented and has not been independently reviewed." Do not use
"end-to-end encrypted" as a general storage claim.

## Finding handling

- Critical: stop the claim, fix, add a regression test, and re-review.
- High: fix before the claim; document any temporary mitigation.
- Medium: fix before release or record an accepted risk with an owner.
- Low: record and schedule.

A review finding cannot be closed by changing documentation only if the
implementation still violates the threat model. A deferred control must remain
an explicit open gate.

## Review record

| Field           | Value        |
| --------------- | ------------ |
| Reviewer        | Not assigned |
| Review date     | Not started  |
| Commit reviewed | Not started  |
| Result          | Not started  |
| Open findings   | Not started  |
| Claim approved  | No           |

This table must be updated with real evidence. It must not be pre-filled with a
passing result.
