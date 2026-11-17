# Stage D3 E2EE Key Management Implementation Plan

> **Status:** Approved by Rya on 2026-11-16. Tasks 1-10 are complete as of 2026-11-17. The E2EE claim gate remains open pending external security review and R-13-7. Do not commit unless Rya explicitly asks.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The selected execution approach is native, because the crypto interfaces are sequential and a mistake in one task is expensive.

**Goal:** Implement optional workspace encryption, encrypted drafts, and encrypted backup v2 with fail-closed migration, recovery, rotation, and an honest security-review gate.

**Architecture:** Encryption sits at the storage composition boundary as a wrapper around `SyncCapableStorage`, using WebCrypto AES-256-GCM envelopes with a workspace DEK and a fresh CEK per write. The keyring is stored separately from workspace data. Drafts use a new async encrypted journal. Backup v2 has its own key hierarchy.

**Tech Stack:** TypeScript, WebCrypto, IndexedDB keyring, Dexie, SQLite, Vitest, Playwright. No new runtime dependency.

**Spec:** `docs/adr/0013-e2ee-key-management-strategy.md`, `docs/superpowers/specs/2026-11-14-stage-d0-architecture-decision-pack.md` section 8 D3.

## Global Constraints

- WebCrypto only. AES-256-GCM. PBKDF2-SHA-256 with a 600,000-iteration floor. 96-bit nonce. Fresh CEK for every write.
- Note titles, file names, tags, folders, sizes, and timestamps remain plaintext by explicit product decision.
- Workspace, backup, and credential-vault keys are separate domains. Credential vault is outside D3.
- Dexie and SQLite must pass the same encryption, migration, and rotation scenarios.
- Every user-facing string is localized in English and Indonesian.
- No new runtime dependency.
- No E2EE claim before an external security review passes.
- Do not commit unless Rya explicitly asks.
- Encryption paths fail closed. There is no plaintext fallback in encrypted mode.
- A failed migration before commit leaves the original plaintext readable.

## Review Focus

1. A backup restored from another workspace must not mix key domains or fail AAD. It must restore into the current workspace identity.
2. Reload or lock during autosave must not lose changes or leave plaintext drafts behind.
3. Moved, truncated, or corrupted ciphertext must fail with an actionable error, never show garbage.
4. An interrupted migration must leave either readable plaintext or complete encrypted data. Mixed state must not lock the user out.
5. Files near the 25 MB limit and large libraries must keep progress accurate, avoid freezing the UI, and never produce a backup silently labeled complete.

## Architecture

### Key hierarchy

- Workspace passphrase -> PBKDF2-SHA-256 600,000 iterations -> HKDF domain `opennest:workspace-kek:v1` -> workspace KEK.
- Random 256-bit workspace DEK wrapped by the workspace KEK with AES-256-GCM.
- Every note write, file version, draft write, and backup chunk uses a fresh 256-bit CEK wrapped by the relevant DEK.
- Workspace recovery key is 256 bits, Crockford Base32 grouped with checksum. It wraps the DEK. The recovery KEK is also stored wrapped under the workspace KEK so rotation can rewrap without displaying the recovery key again.
- Backup v2 generates a fresh backup DEK per file. The backup KEK comes from a backup passphrase or generated backup recovery key. It never uses the workspace DEK.
- Keyring records contain only salts, parameters, wrapped keys, state, and rate-limit metadata. No passphrase, raw DEK, or raw recovery key.

### Envelope

- Text envelope `enc1:` + base64url for note content and drafts.
- Binary envelope magic `ONB1` for blobs and backup chunks.
- Envelope fields: version, algorithm, key ID, nonce, wrapped CEK, ciphertext, and authentication tag.
- AAD binds workspace ID, purpose, entity type, entity ID, key ID, and envelope version.
- Unknown algorithms, versions, key IDs, malformed fields, and truncated tags fail closed.
- `NoteRepository.create` gains an additive optional `id?: NoteId` so encryption can bind the note ID before insert.

### Storage wrapper

- `createEncryptedStorage` wraps `SyncCapableStorage`; core domain types do not change.
- Notes encrypt content only. Titles stay plaintext. Reads decrypt in memory.
- Blobs encrypt on `put`, decrypt on `get`. File checksums are SHA-256 over ciphertext at rest.
- `files.create` recomputes the checksum from the stored ciphertext and ignores the plaintext checksum argument. Missing blob gives `checksum: null`.
- Search scans decrypted notes in memory. There is no persistent plaintext search index.
- `transaction` throws `UnsupportedError("encrypted_transaction")`. Core services do not use it.
- Restore and migration use `base.restore` with a fully encrypted snapshot.

### Drafts

- `DraftStore` becomes async: `list`, `get`, `put`, `remove`, `clear`, `count`, `flush`.
- Plain drafts keep the existing `opennest:draft:note:` prefix.
- Encrypted drafts use `opennest:edraft:note:`.
- Migration copies plaintext drafts to encrypted keys first, verifies decryption, then deletes plaintext only after the encrypted base restore commits.
- ADR 0007 is amended; it is not silently rewritten.

### Backup v2

- When encryption is active, the default export is v2.
- Header: format, version, KDF parameters, salt, key ID, wrapped backup DEK, chunk size, chunk count, and summary.
- Snapshot bytes are split into approximately 4 MiB chunks. Each chunk uses a fresh CEK and AAD binding format, version, KDF parameters, key ID, chunk index, and chunk count.
- Restore maps the snapshot to the current workspace ID so the keyring and AAD stay consistent.
- Backup v1 remains importable. Importing v2 into a plaintext workspace requires an explicit warning.
- Backup v2 excludes credentials, keyring records, privacy grants, audit entries, drafts, and sync sidecars.

### Migration and rotation

Keyring state:

```ts
type EncryptionState = "preparing" | "committing" | "cleanup" | "active";
```

Migration flow:

1. Ensure the workspace exists.
2. Create keyring state `preparing`.
3. Show the recovery key once and require confirmation.
4. Copy plaintext drafts to encrypted draft keys.
5. Build an encrypted snapshot with fresh blob keys.
6. Verify decrypt round-trip.
7. Call `base.restore` with the encrypted snapshot.
8. Delete plaintext drafts and purge old plaintext blobs.
9. Set keyring state `active`.

If restore fails, plaintext storage and plaintext drafts remain readable. Setup can be retried or cancelled before commit.

Rotation uses the same snapshot engine with a target key. Keyring stores active and pending wrapped DEKs so an interrupted rotation can resume. Old ciphertext fails after the old key is removed.

## File Structure

### Core and storage

- `packages/core/src/ports.ts`: optional `id` on `NoteRepository.create`.
- `packages/core/src/testing/memory.ts`: use provided note ID.
- `packages/storage-dexie/src/storage.ts`: use provided note ID.
- `packages/storage-sqlite/src/storage.ts`: use provided note ID.
- `packages/storage-conformance/src/scenarios/notes.ts`: create with ID scenario.
- `packages/storage-conformance/src/index.ts`: export the scenario.

### Crypto package

- `packages/crypto/package.json`
- `packages/crypto/src/index.ts`
- `packages/crypto/src/errors.ts`
- `packages/crypto/src/base64.ts`
- `packages/crypto/src/random.ts`
- `packages/crypto/src/envelope.ts`
- `packages/crypto/src/kdf.ts`
- `packages/crypto/src/recovery-key.ts`
- `packages/crypto/src/keyring.ts`
- `packages/crypto/src/keyring-store.ts`
- `packages/crypto/src/memory-keyring-store.ts`
- `packages/crypto/src/encrypted-storage.ts`
- `packages/crypto/src/search.ts`
- `packages/crypto/src/migration.ts`
- `packages/crypto/src/rotation.ts`
- `packages/crypto/src/backup.ts`
- `packages/crypto/src/__tests__/envelope.test.ts`
- `packages/crypto/src/__tests__/kdf.test.ts`
- `packages/crypto/src/__tests__/recovery-key.test.ts`
- `packages/crypto/src/__tests__/keyring.test.ts`
- `packages/crypto/src/__tests__/keyring-store.test.ts`
- `packages/crypto/src/__tests__/domains.test.ts`
- `packages/crypto/src/__tests__/encrypted-storage.dexie.test.ts`
- `packages/crypto/src/__tests__/encrypted-storage.sqlite.test.ts`
- `packages/crypto/src/__tests__/search.test.ts`
- `packages/crypto/src/__tests__/migration.dexie.test.ts`
- `packages/crypto/src/__tests__/migration.sqlite.test.ts`
- `packages/crypto/src/__tests__/rotation.test.ts`
- `packages/crypto/src/__tests__/backup.test.ts`

### Validation and app data

- `packages/validation/src/backup-v2.ts`: v2 header schema and v1/v2 union.
- `packages/validation/src/backup.ts`: discriminate v1 and v2.
- `packages/validation/src/index.ts`: exports.
- `apps/web/lib/autosave/draft-store.ts`: `DraftStore` interface and plain store.
- `apps/web/lib/autosave/encrypted-draft-store.ts`: encrypted draft store.
- `apps/web/lib/autosave/draft-journal.ts`: parsing and legacy helpers.
- `apps/web/lib/autosave/use-note-autosave.ts`: async draft loading and writes.
- `apps/web/lib/data/app-data-provider.tsx`: accepts prepared storage and draft store.
- `apps/web/lib/data/services.ts`: encrypted storage composition.
- `apps/web/lib/data/backup.ts`: v2 build, inspect, parse, and checksum normalization.
- `apps/web/lib/privacy/data-controls.ts`: async drafts, export options, keyring reset.
- `apps/web/lib/privacy/runtime.ts`: pass `DraftStore`, not `localStorage`.
- `apps/web/lib/crypto/keyring-store.ts`: browser keyring factory.
- `apps/web/lib/crypto/encryption-gate.tsx`: plaintext, locked, setup, migration, unlocked states.
- `apps/web/lib/crypto/tab-coordinator.ts`: BroadcastChannel lock and setup notifications.

### UI and localization

- `apps/web/components/unlock-screen.tsx`
- `apps/web/components/encryption-setup.tsx`
- `apps/web/components/encryption-settings.tsx`
- `apps/web/components/backup-panel.tsx`
- `apps/web/components/backup-export-dialog.tsx`
- `apps/web/components/privacy-center.tsx`
- `apps/web/components/service-worker-update.tsx`
- `apps/web/app/layout.tsx`
- `packages/privacy/src/inventory.ts`
- `packages/localization/src/en.ts`
- `packages/localization/src/id.ts`
- `apps/web/next.config.ts`: add `@opennest/crypto` to `transpilePackages`.
- `scripts/check-browser-graph.mjs`: include the crypto entry point.

### Docs and tests

- `docs/adr/0013-e2ee-key-management-strategy.md`
- `docs/adr/0007-note-autosave-durability.md`
- `docs/adr/0005-backup-format-and-restore.md`
- `docs/e2ee-threat-model.md`
- `docs/e2ee-key-management.md`
- `docs/backup-format-v2.md`
- `docs/e2ee-security-review.md`
- `docs/privacy-center.md`
- `docs/sync-data-model.md`
- `ROADMAP.md`
- `SECURITY.md`
- `README.md`
- `scripts/e2e-encryption.mjs`
- `package.json`: add encryption E2E to `test:e2e`.

---

### Task 1: Accept ADR 0013 and record D3 decisions

**Files:**

- Modify: `docs/adr/0013-e2ee-key-management-strategy.md`
- Modify: `docs/adr/0007-note-autosave-durability.md`
- Modify: `docs/adr/0005-backup-format-and-restore.md`
- Create: `docs/e2ee-threat-model.md`
- Create: `docs/e2ee-key-management.md`
- Create: `docs/backup-format-v2.md`
- Create: `docs/e2ee-security-review.md`
- Modify: `ROADMAP.md`
- Modify: `SECURITY.md`
- Modify: `README.md`
- Modify: `docs/privacy-center.md`
- Modify: `docs/sync-data-model.md`

**Interfaces:**

- Consumes: the approved plan and ADR 0013.
- Produces: accepted implementation status, approved refinements, ADR 0007 amendment, ADR 0005 addendum, threat model, and review gate.

- [x] **Step 1:** Change ADR 0013 status to `Accepted for implementation; E2EE claim pending review`.
- [x] **Step 2:** Record approval of R-13-1, R-13-2, R-13-4, R-13-5, and R-13-8.
- [x] **Step 3:** Record R-13-6 and R-13-7 as deferred because device pairing and sync rollback are outside D3.
- [x] **Step 4:** Add ADR 0007 amendment AD-7-1 for async encrypted drafts and best-effort pagehide durability.
- [x] **Step 5:** Add ADR 0005 addendum for backup v2, checksum semantics, and current-workspace restore mapping.
- [x] **Step 6:** Write the threat model, key hierarchy, backup format, and review checklist.
- [x] **Step 7:** Update ROADMAP D3 items without marking the E2EE claim gate complete.
- [x] **Step 8:** Verify no document claims E2EE is complete and run `npm run format:check`.

### Task 2: Add optional note ID to the repository contract

**Files:**

- Modify: `packages/core/src/ports.ts`
- Modify: `packages/core/src/testing/memory.ts`
- Modify: `packages/storage-dexie/src/storage.ts`
- Modify: `packages/storage-sqlite/src/storage.ts`
- Modify: `packages/storage-conformance/src/scenarios/notes.ts`
- Test: `packages/storage-conformance/src/scenarios/notes.test.ts` or adapter conformance tests

**Interfaces:**

- Consumes: nothing.
- Produces: `NoteRepository.create(input: { id?: NoteId; ... })`, with adapters using `input.id ?? generateId()`.

- [x] **Step 1:** Write failing tests for memory, Dexie, and SQLite create-with-ID and duplicate ID.
- [x] **Step 2:** Add the optional `id` field to the core port.
- [x] **Step 3:** Update memory, Dexie, and SQLite adapters to use the provided ID.
- [x] **Step 4:** Run the three adapter tests and `node scripts/tsc-packages.mjs`.

### Task 3: Create the crypto package and keyring

**Files:**

- Create: `packages/crypto/package.json`
- Create: `packages/crypto/src/*.ts`
- Modify: `apps/web/next.config.ts`
- Modify: `scripts/check-browser-graph.mjs`
- Test: `packages/crypto/src/__tests__/envelope.test.ts`
- Test: `packages/crypto/src/__tests__/kdf.test.ts`
- Test: `packages/crypto/src/__tests__/recovery-key.test.ts`
- Test: `packages/crypto/src/__tests__/keyring.test.ts`
- Test: `packages/crypto/src/__tests__/keyring-store.test.ts`
- Test: `packages/crypto/src/__tests__/domains.test.ts`

**Interfaces:**

- Consumes: no earlier D3 code.
- Produces: `WorkspaceCryptoContext`, `WrappedKey`, `KeyringRecordV1`, `KeyringStore`, `createKeyring`, `sealText`, `openText`, `sealBytes`, `openBytes`, `encodeRecoveryKey`, `decodeRecoveryKey`.

- [x] **Step 1:** Write failing known-answer tests for PBKDF2, HKDF, AES-256-GCM, and recovery-key encoding.
- [x] **Step 2:** Write failing envelope tests for round-trip, wrong key, swapped AAD, wrong key ID, truncation, and nonce uniqueness.
- [x] **Step 3:** Write failing keyring tests for setup, unlock, wrong passphrase, rate limit, recovery unlock, passphrase change, pending rotation, corruption, and deletion.
- [x] **Step 4:** Implement base64url, random helpers, KDF, recovery-key encoding, envelope, keyring, and memory/IndexedDB stores.
- [x] **Step 5:** Add domain-separation tests proving workspace and backup keys are not interchangeable.
- [x] **Step 6:** Run `node scripts/vitest.mjs run packages/crypto`, `node scripts/tsc-packages.mjs`, and `npm run check:browser-graph`.

### Task 4: Implement encrypted storage wrapper

**Files:**

- Create: `packages/crypto/src/encrypted-storage.ts`
- Create: `packages/crypto/src/search.ts`
- Test: `packages/crypto/src/__tests__/encrypted-storage.dexie.test.ts`
- Test: `packages/crypto/src/__tests__/encrypted-storage.sqlite.test.ts`
- Test: `packages/crypto/src/__tests__/search.test.ts`
- Modify: `apps/web/lib/data/services.ts` only if a composition helper is needed

**Interfaces:**

- Consumes: `sealText`, `openText`, `sealBytes`, `openBytes`, `WorkspaceCryptoContext`.
- Produces: `createEncryptedStorage({ base, context, ... }): StorageAdapter`.

- [x] **Step 1:** Write failing Dexie and SQLite tests for note encryption at rest, plaintext titles, update, list, delete, tags, links, and folders.
- [x] **Step 2:** Write failing blob and file tests for raw ciphertext, decrypted preview, ciphertext checksum, and missing blob checksum.
- [x] **Step 3:** Write failing search tests for note body, note title, file name, and ciphertext false positives.
- [x] **Step 4:** Write failing AAD-swap, wrong-key, truncated-envelope, and transaction tests.
- [x] **Step 5:** Write failing sync sidecar tests proving note content is ciphertext and title remains plaintext.
- [x] **Step 6:** Write a failing restore test proving a plaintext snapshot becomes encrypted and is mapped to the current workspace ID.
- [x] **Step 7:** Implement the wrapper, encrypted blob store, note repository, file checksum handling, search, and restore.
- [x] **Step 8:** Run both adapter suites and `npm run typecheck`.

### Task 5: Replace synchronous drafts with async encrypted drafts

**Files:**

- Create: `apps/web/lib/autosave/draft-store.ts`
- Create: `apps/web/lib/autosave/encrypted-draft-store.ts`
- Modify: `apps/web/lib/autosave/draft-journal.ts`
- Modify: `apps/web/lib/autosave/use-note-autosave.ts`
- Modify: `apps/web/components/service-worker-update.tsx`
- Modify: `apps/web/components/app-shell.tsx`
- Modify: `apps/web/lib/privacy/data-controls.ts`
- Modify: `apps/web/lib/privacy/runtime.ts`
- Test: `apps/web/lib/autosave/__tests__/draft-journal.test.ts`
- Test: `apps/web/lib/autosave/__tests__/use-note-autosave.test.tsx`
- Test: `apps/web/components/__tests__/pwa-ui.test.tsx`
- Test: `apps/web/lib/privacy/__tests__/data-controls.test.ts`

**Interfaces:**

- Consumes: crypto envelope helpers.
- Produces: `DraftStore` with `list`, `get`, `put`, `remove`, `clear`, `count`, `flush`; plain and encrypted implementations.

- [x] **Step 1:** Write failing tests for the plain draft store and encrypted draft store, including at-rest plaintext checks.
- [x] **Step 2:** Write failing autosave tests for async restore, serialized writes, clear-after-save, save failure, and lock/reload race.
- [x] **Step 3:** Write failing PWA update tests for async journal reads and clears.
- [x] **Step 4:** Write failing data-controls tests for async overview, restore, and delete all.
- [x] **Step 5:** Implement the draft store abstraction, encrypted prefix, autosave refactor, PWA async callbacks, and data controls async API.
- [x] **Step 6:** Run autosave, PWA UI, data-controls, and localization tests.

### Task 6: Implement backup v2

**Files:**

- Create: `packages/validation/src/backup-v2.ts`
- Modify: `packages/validation/src/backup.ts`
- Modify: `packages/validation/src/index.ts`
- Create: `packages/crypto/src/backup.ts`
- Modify: `apps/web/lib/data/backup.ts`
- Modify: `apps/web/components/backup-panel.tsx`
- Create: `apps/web/components/backup-export-dialog.tsx`
- Create: `apps/web/components/backup-import-dialog.tsx`
- Modify: `apps/web/components/privacy-center.tsx`
- Modify: `apps/web/lib/privacy/data-controls.ts`
- Test: `packages/crypto/src/__tests__/backup.test.ts`
- Test: `apps/web/lib/data/__tests__/backup.test.ts`
- Test: `apps/web/components/__tests__/backup-panel.test.tsx`
- Test: `apps/web/components/__tests__/privacy-center.test.tsx`

**Interfaces:**

- Consumes: envelope helpers and keyring.
- Produces: `inspectBackupFile(text)`, `buildBackupV2(snapshot, keySource)`, `parseBackupFile(text, keySource)`, and a shared export dialog for Settings and Privacy Center.

- [x] **Step 1:** Write failing header-schema and v1/v2 union tests.
- [x] **Step 2:** Write failing encryption tests for passphrase, generated backup key, wrong key, tamper, reorder, truncation, and KDF floor.
- [x] **Step 3:** Write failing payload tests proving no title, content, recovery key, workspace DEK, or keyring is present in the serialized file.
- [x] **Step 4:** Write failing checksum and current-workspace restore tests.
- [x] **Step 5:** Write failing UI tests for key-source selection, key confirmation, copy action, wrong-key error, and explicit plaintext-target warning.
- [x] **Step 6:** Implement validation, backup crypto, app build/inspect/parse, UI, and privacy export integration.
- [x] **Step 7:** Run backup, component, data-controls, and privacy-center tests.

### Task 7: Implement migration and rotation

**Files:**

- Create: `packages/crypto/src/migration.ts`
- Create: `packages/crypto/src/rotation.ts`
- Modify: `packages/crypto/src/keyring.ts`
- Test: `packages/crypto/src/__tests__/migration.dexie.test.ts`
- Test: `packages/crypto/src/__tests__/migration.sqlite.test.ts`
- Test: `packages/crypto/src/__tests__/rotation.test.ts`

**Interfaces:**

- Consumes: encrypted storage wrapper, keyring, draft stores.
- Produces: `enableEncryption(...)`, `resumeEncryption(...)`, `cancelEncryptionBeforeCommit(...)`, `rotateWorkspaceKey(...)`, and `MigrationProgress`.

- [x] **Step 1:** Write failing tests for complete migration of notes, files, blobs, folders, tags, links, and drafts on Dexie and SQLite.
- [x] **Step 2:** Write failing failure-injection tests for snapshot build, draft copy, `base.restore`, draft cleanup, and blob purge.
- [x] **Step 3:** Write failing resume tests for `preparing`, `committing`, and `cleanup` states.
- [x] **Step 4:** Write failing rotation tests for new ciphertext, old-key failure, recovery-key continuity, and interrupted rotation.
- [x] **Step 5:** Implement the migration state machine, draft temp copy, base-encryption detection, cleanup, and rotation.
- [x] **Step 6:** Run both adapter migration suites and rotation tests.

**Implementation note (2026-11-17):** core rotation re-encrypts workspace
storage only. The app rotates encrypted drafts through the Task 9 temp-key
journal before committing the keyring so a crash cannot leave mixed old and new
drafts.

### Task 8: Add the encryption gate, unlock, and lock

**Files:**

- Create: `apps/web/lib/crypto/encryption-gate.tsx`
- Create: `apps/web/lib/crypto/keyring-store.ts`
- Create: `apps/web/lib/crypto/tab-coordinator.ts`
- Create: `apps/web/components/unlock-screen.tsx`
- Modify: `apps/web/lib/data/app-data-provider.tsx`
- Modify: `apps/web/app/layout.tsx`
- Test: `apps/web/lib/crypto/__tests__/encryption-gate.test.tsx`
- Test: `apps/web/lib/data/__tests__/app-data-provider.test.tsx`

**Interfaces:**

- Consumes: keyring, encrypted storage, draft stores.
- Produces: `EncryptionGate`, `useEncryption()` with `unlock`, `unlockWithRecoveryKey`, `lock`, and `resetEncryption`. Setup, cancel, and rotation controller methods land in Task 9 with their UI and migration flows.

- [x] **Step 1:** Write failing tests for plaintext mode with no keyring, locked mode with a keyring, successful unlock, wrong passphrase, recovery unlock, and lock.
- [x] **Step 2:** Write failing tests proving app children do not mount while locked and are unmounted on lock.
- [x] **Step 3:** Write failing tests for keyring deletion returning the app to plaintext mode.
- [x] **Step 4:** Implement the gate, unlock screen, provider injection, lock flow, and BroadcastChannel notifications.
- [x] **Step 5:** Add accessibility tests for focus, labels, and error announcements.
- [x] **Step 6:** Run gate, provider, and accessibility tests.

**Implementation notes:**

- Added the encryption gate, unlock screen, browser keyring opener, tab coordinator, and localized unlock strings.
- `AppDataProvider` now owns the crypto session, exposes locked/unlocked/plaintext state, installs the encrypted runtime after unlock, clears the privacy runtime on lock, and broadcasts lock/reset events.
- Reset refuses to delete a keyring while encrypted notes or encrypted drafts exist. The safe path returns the app to plaintext mode.
- `EncryptionGate` wraps the app shell in `apps/web/app/layout.tsx`; locked children never mount.
- Tests: encryption gate 10, tab coordinator 3, app data provider 2. Full suite: 1088 passed, 89 files.
- `startSetup`, `cancelSetup`, and `rotate` remain in Task 9 so setup, migration progress, and rotation have one owner.
- No commits. External security review and R-13-7 remain open.

### Task 9: Add setup, settings, privacy inventory, and localization

**Files:**

- Create: `apps/web/components/encryption-setup.tsx`
- Create: `apps/web/components/encryption-settings.tsx`
- Modify: `apps/web/components/backup-panel.tsx`
- Modify: `apps/web/components/privacy-center.tsx`
- Modify: `packages/privacy/src/inventory.ts`
- Modify: `packages/localization/src/en.ts`
- Modify: `packages/localization/src/id.ts`
- Test: `apps/web/components/__tests__/encryption-setup.test.tsx`
- Test: `apps/web/components/__tests__/encryption-settings.test.tsx`
- Test: `apps/web/components/__tests__/privacy-inventory.test.tsx`
- Test: `packages/localization/src/__tests__/parity.test.ts`

**Interfaces:**

- Consumes: `useEncryption()`, migration progress, backup v2.
- Produces: setup with recovery confirmation, migration progress, passphrase change, rotation, lock now, keyring inventory, and v2 privacy export. Extends `useEncryption()` with `startSetup`, `cancelSetup`, and `rotate`.

- [x] **Step 1:** Write failing setup tests for passphrase rules, recovery-key display, partial confirmation, cancel before commit, and migration progress.
- [x] **Step 2:** Write failing settings tests for passphrase change, rotation confirmation, lock now, and errors.
- [x] **Step 3:** Write failing privacy tests for keyring inventory, delete-all keyring clearing, and encrypted export.
- [x] **Step 4:** Add English and Indonesian strings for every new user-facing state.
- [x] **Step 5:** Implement setup, settings, progress, inventory, privacy integration, and mobile layout.
- [x] **Step 6:** Rotate encrypted drafts through a temp-key journal before committing workspace rotation, with crash/resume coverage.
- [x] **Step 7:** Run component tests, localization parity, and manual 412 x 915 checks.

**Implementation notes:**

- Added `EncryptionSetup`, `EncryptionSettings`, and `EncryptionOperationScreen`; the operation screen owns setup progress, cancellation, rotation recovery, and error announcements.
- Setup generates the recovery key before keyring creation, shows it once, and requires explicit confirmation. `startSetup` uses a `preparing` keyring plus `resumeEncryption`; cancellation requests abort at the next progress checkpoint and clean up encrypted drafts before deleting the keyring.
- Added passphrase change, lock now, key rotation, pending-rotation state, and localized errors. `changePassphrase` keeps the active DEK key ID.
- Rotation stages encrypted drafts through the temp-key journal, rotates workspace storage, finalizes drafts, and installs the new runtime. Unlock recovery inspects base key IDs and the journal, commits pending workspace content, resumes pending setup states, and can finish pending rotation with the recovery key.
- Added `unlockPendingWithRecoveryKey` to the keyring so recovery unlocks can finish a rotation whose pending key encrypts the workspace.
- Added the keyring to the privacy inventory and delete-all now clears the keyring after encrypted data and drafts are gone. Backup and privacy export expose the encrypted-at-rest notice.
- Added English and Indonesian strings for setup, operation progress, settings, rotation, and notices.
- Tests: setup 3, settings 4, privacy inventory 2, keyring 8, pending rotation recovery 3, rotation journal 7, rotation 4. Full suite at that milestone: 1,110 passed, 94 files. Typecheck, format, ESLint, browser graph, and production build pass. Manual 412 x 915 setup, recovery-key, and encrypted-settings screens have no horizontal overflow.

### Task 10: Add encryption E2E and close the implementation gate

**Files:**

- Create: `scripts/e2e-encryption.mjs`
- Modify: `package.json`
- Modify: `ROADMAP.md`
- Modify: `docs/e2ee-security-review.md`
- Modify: `README.md`
- Modify: `SECURITY.md`

**Interfaces:**

- Consumes: all prior tasks.
- Produces: end-to-end proof of setup, lock, unlock, search, backup v2, delete all, and restore; final gate report.

- [x] **Step 1:** Add E2E setup, note creation, file upload, reload lock, unlock, search, export v2, delete all, and import v2.
- [x] **Step 2:** Add E2E wrong passphrase, wrong backup key, and locked deep-link cases.
- [x] **Step 3:** Add mobile viewport structure checks and console-error checks.
- [x] **Step 4:** Mark D3 implementation complete in ROADMAP while leaving the E2EE claim gate open.
- [x] **Step 5:** Record external review as not completed and list every unresolved risk.
- [x] **Step 6:** Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run format:check`, `npm run benchmark:library`, `npm run test:e2e`, and `npm run check:browser-graph`.
- [x] **Step 7:** Report changed files, test evidence, remaining limitations, and whether any task is incomplete.

**Implementation notes:**

- Added `scripts/e2e-encryption.mjs` and the `test:e2e:encryption` script; the full `test:e2e` chain now runs stage C, PWA, and encryption.
- The encryption journey covers setup, recovery-key confirmation, encrypted notes, file upload/preview, search, reload lock with deep-link preservation, wrong passphrase, backup v2 export with a backup key, plaintext-leak checks, delete-all keyring removal, wrong backup key, and v2 restore in a 412 x 915 viewport with console-error assertions.
- Updated stage C for the new backup dialog: it explicitly selects plaintext v1 and closes the completed dialog before continuing.
- Marked the three D3 implementation items complete in `ROADMAP.md`; the external review and E2EE claim gate remain open.
- Updated README, SECURITY, and the security review with implementation evidence and unresolved risks.
- Follow-up hardening: text envelope parsing rejects duplicate JSON keys at any depth, including escaped duplicates. Empty ciphertext remains valid only when authenticated as empty plaintext; a tampered tag still fails. The protocol documentation now states this explicitly.
- Verification after hardening: `npm test` 1,119 passed in 95 files; `npm run test:e2e:encryption` passed all 12 checks; typecheck, lint, format, browser graph, and production build passed.
- Internal review follow-up fixed the plaintext draft leak in encrypted workspaces, fail-closed startup without a keyring, raw passphrase unlock, metadata copy, security headers, backup KDF ceilings, duplicate outer backup JSON keys, dual-store draft cleanup, and PWA recovery through the active encrypted draft store.
- No commits. External security review and R-13-7 remain open.

## Out of Scope

- Credential vault.
- Device pairing and multi-device key wrapping.
- Network sync.
- R-13-7 rollback protection, because no sync server exists.
- Metadata encryption for titles, file names, tags, folders, sizes, or timestamps.
- External security review. It must remain an open gate, so D3 implementation completion does not authorize an E2EE claim.

## Approved Defaults

1. Keyring lives in a separate IndexedDB database named `opennest-crypto`.
2. Drafts use an async encrypted journal; draft recovery is not disabled.
3. Migration uses a full encrypted snapshot and `base.restore`, with fresh blob keys and a cleanup phase.
4. Backup v2 restores into the current workspace identity.
5. Backup v2 supports a passphrase or a generated backup key.
6. Execution is native, task by task, with verification after each task.
