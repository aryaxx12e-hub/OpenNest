# Stage D4B AI Provider and Credential Vault Implementation Plan

> **Status:** Approved by Rya on 2026-11-17. Tasks 1-15 complete. D4B implementation is complete; independent AI security review and the D4A extension remain open. Do not commit unless Rya explicitly asks.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` or `subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The recommended execution method is native, because the vault, consent, and transport interfaces are sequential and a mistake in one task is expensive.

**Goal:** Add an optional, off-by-default AI provider layer with session-only or passphrase-encrypted BYOK credentials, payload-bound one-time consent, local and remote OpenAI-compatible providers, and no secret leakage into logs, backups, or workspace data.

**Architecture:** `@opennest/ai` owns provider contracts, endpoint validation, registry, and the OpenAI-compatible adapter. `@opennest/credential-vault` owns a separate key hierarchy. `@opennest/privacy` owns capability grants and a new consent registry. The web app owns fetch transport, consent orchestration, UI, and app lifecycle. No document content is attached to AI requests in D4B.

**Tech Stack:** TypeScript strict mode, WebCrypto, Dexie, Next.js, React, Vitest, Playwright. No new runtime dependency.

**Spec:** `docs/adr/0011-ai-provider-and-credential-architecture.md`, `docs/superpowers/specs/2026-11-14-stage-d0-architecture-decision-pack.md` section 9 D4.

## Approved Decisions

1. **CSP:** allow `connect-src` for all HTTPS and loopback HTTP, with exact-origin enforcement in transport and capability grants. This is required because custom provider origins cannot be known by a static CSP.
2. **Backup exclusion:** provider configs, consents, session credentials, and vault remain outside backup v1 and v2.
3. **Key separation:** vault keys never unlock workspace data, and workspace recovery never unlocks the vault.
4. **No vault recovery:** losing the passphrase loses stored credentials.
5. **No tools, MCP, document context, or AI chat history in D4B.**
6. **Vault auto-lock:** 5 minutes of inactivity, fixed in D4B.
7. **Provider deletion:** remove session credentials, keep vault entries as unlinked until the user removes them.

## Global Constraints

- AI is off by default. No network request before explicit consent.
- Session-only credentials are the default. The vault is optional.
- Vault recovery: none. Losing the vault passphrase loses stored credentials.
- Credentials are excluded from backup v1 and backup v2.
- Vault key domain: `opennest:credential-vault-kek:v1`. No workspace or backup key reuse.
- AES-256-GCM, 96-bit nonce, 128-bit tag. PBKDF2-SHA-256, 128-bit salt, 600,000 iteration floor, 2,000,000 ceiling.
- Secrets never enter localStorage, plaintext IndexedDB, logs, audit entries, URLs, exports, or React state after save.
- Remote providers require HTTPS. Loopback HTTP is allowed only for `kind: "local"`.
- Reject userinfo, credentials in query strings, mixed content, and cross-origin redirects.
- Requests use `credentials: "omit"`, `referrerPolicy: "no-referrer"`, `redirect: "error"`, `cache: "no-store"`.
- Consent binds provider, model, endpoint origin, exact payload hash, data classes, session, and expiry. Consent is one-time.
- No automatic retries. A retry needs a new consent.
- No tools, MCP execution, document context, or background indexing in D4B.
- Model output is untrusted text. Never render it as HTML.
- Every user-facing string is localized in English and Indonesian.
- No commit unless Rya explicitly asks.
- D4B completes only the AI half of D4. D4A extension remains separate and incomplete.
- The browser cannot fully protect an unlocked secret from XSS. This residual risk must stay documented.

## Review Focus

1. The bytes covered by consent must be exactly the bytes sent. Provider config changes between preview and send must invalidate the request.
2. Secrets must not survive in UI state, errors, audit entries, consent records, backups, or plaintext storage after save or lock.
3. Endpoint validation and CSP must work together: HTTPS-only remote, loopback-only local, no redirects, no credentials in URLs, no accidental HTTP.
4. Vault key separation must be provable: workspace recovery cannot open the vault, vault passphrase cannot open the workspace, backup key cannot decrypt vault data.
5. AI off, offline, abort, timeout, CORS failure, and large responses must leave a clear state and must not send or persist content silently.

## Architecture

### Request flow

1. UI calls `ai.prepare(request)`.
2. Runtime loads provider config, validates endpoint and model, and calls the adapter's `prepare`.
3. Adapter returns the exact JSON body, endpoint, origin, payload hash, and byte size.
4. UI shows the consent dialog with provider, endpoint, model, data classes, byte size, credential label, and prompt preview.
5. User approves.
6. Runtime creates a one-time consent and session-only capability grants.
7. Runtime re-prepares, compares hash and origin, consumes consent, and invokes capabilities.
8. Transport resolves the credential handle, injects the auth header, and calls `fetch`.
9. Adapter parses the response. UI renders plain text.

### Packages

- `@opennest/privacy`: consent registry, external policy, broker factory, session isolation.
- `@opennest/credential-vault`: vault crypto, record parsing, entries, rotation.
- `@opennest/ai`: provider types, endpoint policy, registry, presets, adapter, transport port.
- `apps/web/lib/credentials`: Dexie vault store, session credential store, resolver.
- `apps/web/lib/ai`: browser transport, provider store, runtime orchestration, error mapping.

### Key hierarchy

- Vault passphrase -> PBKDF2-SHA-256 600,000 iterations -> HKDF domain `opennest:credential-vault-kek:v1` -> vault KEK.
- Random 256-bit vault DEK wrapped by the vault KEK.
- Every entry uses a fresh 256-bit CEK wrapped by the vault DEK.
- Entry secret encrypted by the entry CEK.
- AAD binds vault ID, active key ID, entry ID, provider ID, account label, entry version, and purpose.
- No workspace DEK, workspace KEK, recovery key, or backup DEK is accepted.

### Audit and consent boundaries

- Consent records store metadata and payload hash only. They never store prompt, response, or secret.
- Audit entries store provider ID, capability, scope digest, outcome, and safe reason codes only.
- Grants are session-only and one-use.
- A consent and its grants are bound to `PrivacyRuntime.sessionId`.
- Revoking a consent revokes its grants and aborts any active handle.

## File Structure

### New packages

- `packages/credential-vault/package.json`
- `packages/credential-vault/src/index.ts`
- `packages/credential-vault/src/types.ts`
- `packages/credential-vault/src/vault.ts`
- `packages/credential-vault/src/record.ts`
- `packages/credential-vault/src/aad.ts`
- `packages/credential-vault/src/errors.ts`
- `packages/credential-vault/src/memory-store.ts`
- `packages/credential-vault/src/__tests__/vault.test.ts`
- `packages/credential-vault/src/__tests__/entries.test.ts`
- `packages/credential-vault/src/__tests__/domains.test.ts`
- `packages/ai/package.json`
- `packages/ai/src/index.ts`
- `packages/ai/src/types.ts`
- `packages/ai/src/errors.ts`
- `packages/ai/src/endpoint.ts`
- `packages/ai/src/registry.ts`
- `packages/ai/src/presets.ts`
- `packages/ai/src/payload.ts`
- `packages/ai/src/transport.ts`
- `packages/ai/src/openai-compatible.ts`
- `packages/ai/src/mock.ts`
- `packages/ai/src/memory-store.ts`
- `packages/ai/src/__tests__/endpoint.test.ts`
- `packages/ai/src/__tests__/registry.test.ts`
- `packages/ai/src/__tests__/adapter.test.ts`

### Privacy and crypto

- `packages/privacy/src/types.ts`: consent types, `PrivacyStore.consents`, AI audit events, error codes.
- `packages/privacy/src/consents.ts`: consent registry and validation.
- `packages/privacy/src/policy.ts`: allow network, AI, and credential capabilities.
- `packages/privacy/src/broker.ts`: reject session grants from another session.
- `packages/privacy/src/testing.ts`: memory consent store.
- `packages/privacy/src/index.ts`: exports.
- `packages/privacy/src/__tests__/consent.test.ts`
- `packages/privacy/src/__tests__/policy.test.ts`
- `packages/privacy/src/__tests__/broker.test.ts`
- `packages/crypto/src/kdf.ts`: add credential-vault domain to allowed domains.
- `packages/crypto/src/index.ts`: export the new domain constant.
- `packages/crypto/src/__tests__/domains.test.ts`: cross-domain coverage.

### Web app

- `apps/web/lib/privacy/dexie-store.ts`: Dexie version 2 with `consents`.
- `apps/web/lib/privacy/runtime.ts`: consent registry, broker factory, consent revocation.
- `apps/web/lib/privacy/data-controls.ts`: auxiliary cleanup before delete-all.
- `apps/web/lib/credentials/dexie-store.ts`
- `apps/web/lib/credentials/session-store.ts`
- `apps/web/lib/credentials/runtime.ts`
- `apps/web/lib/credentials/errors.ts`
- `apps/web/lib/ai/store.ts`
- `apps/web/lib/ai/transport.ts`
- `apps/web/lib/ai/runtime.ts`
- `apps/web/lib/ai/errors.ts`
- `apps/web/lib/data/app-data-provider.tsx`: build and dispose AI and credentials.
- `apps/web/components/ai-settings.tsx`
- `apps/web/components/ai-provider-dialog.tsx`
- `apps/web/components/ai-credentials.tsx`
- `apps/web/components/ai-console.tsx`
- `apps/web/components/ai-consent-dialog.tsx`
- `apps/web/components/privacy-consents.tsx`
- `apps/web/components/settings-view.tsx`
- `apps/web/components/privacy-center.tsx`
- `apps/web/app/ai/page.tsx`
- `apps/web/next.config.ts`: CSP `connect-src`, transpile packages.
- `packages/localization/src/en.ts`
- `packages/localization/src/id.ts`
- `packages/privacy/src/inventory.ts`: AI inventory and flow entries.
- `scripts/check-browser-graph.mjs`: add AI and vault entry points.
- `scripts/e2e-ai.mjs`
- `package.json`: `test:e2e:ai`, include in `test:e2e`.

### Docs

- `docs/adr/0011-ai-provider-and-credential-architecture.md`
- `docs/ai-provider-architecture.md`
- `docs/credential-vault.md`
- `docs/ai-security-review.md`
- `docs/privacy-center.md`
- `docs/backup-format-v2.md`
- `docs/e2ee-key-management.md`
- `SECURITY.md`
- `README.md`
- `ROADMAP.md`
- `CHANGELOG.md`

---

### Task 1: Accept ADR 0011 and record D4B decisions

**Files:**

- Modify: `docs/adr/0011-ai-provider-and-credential-architecture.md`
- Modify: `docs/superpowers/specs/2026-11-14-stage-d0-architecture-decision-pack.md`
- Modify: `SECURITY.md`
- Modify: `ROADMAP.md`
- Create: `docs/ai-provider-architecture.md`
- Create: `docs/credential-vault.md`
- Create: `docs/ai-security-review.md`

**Interfaces:** None.

- [x] Change ADR 0011 status to `Accepted for D4B AI track, D4A extension remains separate`.
- [x] Record: session-only default, optional vault, no vault recovery, backup exclusion, key separation, 600,000 floor, 5-minute consent TTL, 5-minute vault auto-lock, no automatic retries, no tools or MCP in D4B.
- [x] Record the CSP decision: `connect-src 'self' https: http://localhost:* http://127.0.0.1:*` in production. Chromium rejects IPv6 literals in CSP source lists. App-level transport and capability grants remain the exact-origin enforcement.
- [x] Add residual risks to `SECURITY.md`: broad CSP connect-src, CORS failures, XSS while unlocked, provider retention, no JavaScript memory zeroization.
- [x] Document that D4B does not complete D4 and does not claim tool-call support.
- [x] Verify with `rg -n "Accepted for D4B|connect-src|no recovery|backup v1|backup v2" docs SECURITY.md`.
- [x] Run `npm run format:check`.
- [x] Do not commit unless Rya asks.

### Task 2: Add the consent registry

**Files:**

- Modify: `packages/privacy/src/types.ts`
- Modify: `packages/privacy/src/errors.ts`
- Create: `packages/privacy/src/consents.ts`
- Modify: `packages/privacy/src/testing.ts`
- Modify: `packages/privacy/src/index.ts`
- Modify: `apps/web/lib/privacy/dexie-store.ts`
- Create: `packages/privacy/src/__tests__/consent.test.ts`
- Modify: `packages/privacy/src/__tests__/dexie-store.test.ts` or create it if absent.

**Interfaces:**

```ts
export interface ConsentRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly principalId: string;
  readonly providerId: string;
  readonly model: string;
  readonly endpointOrigin: string;
  readonly payloadHash: string;
  readonly payloadBytes: number;
  readonly dataClasses: readonly DataClass[];
  readonly purpose: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly usedAt: number | null;
  readonly revokedAt: number | null;
}

export interface CreateConsentInput {
  readonly sessionId: string;
  readonly principalId: string;
  readonly providerId: string;
  readonly model: string;
  readonly endpointOrigin: string;
  readonly payloadHash: string;
  readonly payloadBytes: number;
  readonly dataClasses: readonly DataClass[];
  readonly purpose: string;
  readonly expiresAt: number;
}

export interface ConsentExpectation {
  readonly sessionId: string;
  readonly providerId: string;
  readonly model: string;
  readonly endpointOrigin: string;
  readonly payloadHash: string;
  readonly dataClasses: readonly DataClass[];
  readonly at: number;
}

export interface ConsentStore {
  list(): Promise<ConsentRecord[]>;
  get(id: string): Promise<ConsentRecord | null>;
  put(record: ConsentRecord): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

export interface ConsentRegistry {
  create(input: CreateConsentInput): Promise<ConsentRecord>;
  get(id: string): Promise<ConsentRecord | null>;
  list(): Promise<ConsentRecord[]>;
  consume(id: string, expected: ConsentExpectation): Promise<ConsentRecord>;
  revoke(id: string, at: number): Promise<ConsentRecord>;
  clear(): Promise<void>;
}
```

- [x] Add `consents: ConsentStore` to `PrivacyStore`.
- [x] Add `MAX_CONSENT_TTL_MS = 5 * 60 * 1000`.
- [x] Add `consent_expired`, `consent_used`, `consent_revoked`, `consent_mismatch`, `invalid_consent` to `PrivacyErrorCode`.
- [x] Validate provider ID, model, normalized origin, 64-character lowercase hash, payload bytes, non-empty data classes, purpose, session ID, and expiry.
- [x] `consume` checks session, provider, model, origin, payload hash, data classes, expiry, used state, and revoked state before writing `usedAt`.
- [x] Add memory consent store and update `createMemoryPrivacyStore`.
- [x] Bump Dexie to version 2 with `consents: "id, providerId, endpointOrigin, createdAt, expiresAt"`. Preserve existing grants and audit rows.
- [x] Clear consents in `reset`.
- [x] Test: create and list consent.
- [x] Test: payload mismatch is rejected.
- [x] Test: another session cannot consume the consent.
- [x] Test: second consume returns `consent_used`.
- [x] Test: expired and revoked consents are rejected.
- [x] Test: Dexie v1 database upgrades to v2 and keeps grants.
- [x] Run `node scripts/vitest.mjs run packages/privacy/src/__tests__/consent.test.ts packages/privacy/src/__tests__/dexie-store.test.ts`.
- [x] Do not commit unless Rya asks.

### Task 3: Enable external capabilities and broker isolation

**Files:**

- Modify: `packages/privacy/src/types.ts`
- Modify: `packages/privacy/src/policy.ts`
- Modify: `packages/privacy/src/broker.ts`
- Modify: `packages/privacy/src/__tests__/policy.test.ts`
- Modify: `packages/privacy/src/__tests__/broker.test.ts`
- Modify: `apps/web/lib/privacy/runtime.ts`
- Modify: `apps/web/lib/privacy/__tests__/runtime.test.ts`

**Interfaces:**

```ts
export interface PrivacyRuntime {
  readonly sessionId: string;
  readonly consents: ConsentRegistry;
  createBroker(principal: Principal): CapabilityBroker;
  revokeConsent(id: string): Promise<void>;
  dispose(): Promise<void>;
  // existing fields unchanged
}
```

- [x] Add `ai.requested`, `ai.completed`, `ai.failed`, and `ai.aborted` to `AuditEvent`.
- [x] Change `assertPolicyAllows` so `network.connect`, `ai.invoke`, and `credential.use` can pass policy when a matching grant exists. Keep `sync.push` and `sync.pull` as `external_unavailable`.
- [x] Keep `credential.use` high-risk. It requires a confirmation scoped to the provider and item count.
- [x] In `matchingGrant`, reject session-only grants whose `sessionId` does not equal the broker session.
- [x] Add `createBroker(principal)` to `PrivacyRuntime`. Reuse one broker per principal ID.
- [x] Track every created broker. `dispose` ends all brokers before closing the privacy store.
- [x] Add `revokeConsent(id)`: revoke consent, find grants with `auditRef === id`, and revoke them through the matching principal broker so active handles abort.
- [x] Test: network, AI, and credential grants can be requested with valid scopes.
- [x] Test: credential use without confirmation is denied.
- [x] Test: sync remains unavailable.
- [x] Test: broker in session B cannot use a session-only grant from session A.
- [x] Test: revoking a consent revokes its grants and aborts an active handle.
- [x] Run `node scripts/vitest.mjs run packages/privacy/src/__tests__/policy.test.ts packages/privacy/src/__tests__/broker.test.ts apps/web/lib/privacy/__tests__/runtime.test.ts`.
- [x] Do not commit unless Rya asks.

### Task 4: Add vault key hierarchy and setup/unlock

**Files:**

- Create: `packages/credential-vault/package.json`
- Create: `packages/credential-vault/src/types.ts`
- Create: `packages/credential-vault/src/errors.ts`
- Create: `packages/credential-vault/src/aad.ts`
- Create: `packages/credential-vault/src/record.ts`
- Create: `packages/credential-vault/src/vault.ts`
- Create: `packages/credential-vault/src/memory-store.ts`
- Create: `packages/credential-vault/src/index.ts`
- Modify: `packages/crypto/src/kdf.ts`
- Modify: `packages/crypto/src/index.ts`
- Create: `packages/credential-vault/src/__tests__/vault.test.ts`
- Create: `packages/credential-vault/src/__tests__/domains.test.ts`

**Interfaces:**

```ts
export const CREDENTIAL_VAULT_KEK_DOMAIN = "opennest:credential-vault-kek:v1";
export const MAX_VAULT_UNLOCK_ATTEMPTS = 5;
export const VAULT_UNLOCK_RETRY_MS = 30_000;
export const DEFAULT_VAULT_AUTO_LOCK_MS = 5 * 60 * 1000;
export const MIN_VAULT_PASSPHRASE_LENGTH = 12;

export interface VaultRecordV1 {
  version: 1;
  vaultId: string;
  activeKid: string;
  kdf: KdfParameters;
  wrappedDek: WrappedKey;
  entries: VaultEntryRecord[];
  failedAttempts: number;
  retryAfter: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface CredentialVaultStore {
  get(): Promise<VaultRecordV1 | null>;
  put(record: VaultRecordV1): Promise<void>;
  delete(): Promise<void>;
}

export interface CredentialVaultSession {
  readonly vaultId: string;
  readonly unlockedAt: number;
  readonly expiresAt: number;
  readonly isUnlocked: (at: number) => boolean;
  readonly touch: (at: number) => void;
  readonly lock: () => void;
}

export interface CredentialVault {
  get(): Promise<VaultRecordV1 | null>;
  hasVault(): Promise<boolean>;
  setup(
    passphrase: string,
    options?: { autoLockMs?: number }
  ): Promise<CredentialVaultSession>;
  unlock(
    passphrase: string,
    options?: { autoLockMs?: number }
  ): Promise<CredentialVaultSession>;
  changePassphrase(
    session: CredentialVaultSession,
    currentPassphrase: string,
    nextPassphrase: string
  ): Promise<void>;
  delete(): Promise<void>;
}
```

- [x] Add `CREDENTIAL_VAULT_KEK_DOMAIN` to `ALLOWED_DOMAINS` in `packages/crypto/src/kdf.ts`. Keep `deriveWorkspaceKek` and `deriveBackupKek` domain-specific.
- [x] Reuse `createKdfParameters`, `deriveKekBytes`, `wrapKeyBytes`, `unwrapKeyBytes`, `encryptAesGcm`, `decryptAesGcm`, `randomBytes`, `randomId`, `base64Url*`.
- [x] `setup` requires 12 or more characters. Do not trim the passphrase. Create 128-bit salt, vault ID, active key ID, 256-bit DEK, wrapped DEK, and empty entries.
- [x] `unlock` enforces persisted failed-attempt backoff: 5 failures, 30-second retry.
- [x] On successful unlock, reset failures and return a session with `vaultId`, `unlockedAt`, `expiresAt`, `touch`, `lock`, `isUnlocked`.
- [x] The in-memory DEK is non-extractable where possible and is dropped on lock.
- [x] `changePassphrase` requires the current passphrase, creates a new salt, and rewraps the same DEK.
- [x] Parse and reject malformed records: wrong version, wrong KDF domain, bad salt, bad wrapped key, unknown fields, invalid timestamps, invalid retry state.
- [x] Test: setup then unlock round-trip.
- [x] Test: wrong passphrase and 5-attempt rate limit.
- [x] Test: 11-character passphrase is rejected, 12 is accepted, leading or trailing spaces are preserved.
- [x] Test: changing the passphrase invalidates the old one and keeps the same DEK.
- [x] Test: record JSON contains no passphrase, DEK, or plaintext secret.
- [x] Test: workspace KEK and backup KEK cannot unwrap the vault DEK.
- [x] Run `node scripts/vitest.mjs run packages/credential-vault/src/__tests__/vault.test.ts packages/credential-vault/src/__tests__/domains.test.ts`.
- [x] Do not commit unless Rya asks.

### Task 5: Add vault entries, rotation, and secret access

**Files:**

- Modify: `packages/credential-vault/src/types.ts`
- Modify: `packages/credential-vault/src/aad.ts`
- Modify: `packages/credential-vault/src/record.ts`
- Modify: `packages/credential-vault/src/vault.ts`
- Modify: `packages/credential-vault/src/index.ts`
- Create: `packages/credential-vault/src/__tests__/entries.test.ts`

**Interfaces:**

```ts
export interface VaultEntryRecord {
  readonly id: string;
  readonly providerId: string;
  readonly accountLabel: string;
  readonly version: 1;
  readonly kid: string;
  readonly wrappedCek: WrappedKey;
  readonly iv: string;
  readonly ciphertext: string;
  readonly tag: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface VaultEntryMetadata {
  readonly id: string;
  readonly providerId: string;
  readonly accountLabel: string;
  readonly version: 1;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface CredentialVault {
  list(session: CredentialVaultSession): Promise<readonly VaultEntryMetadata[]>;
  create(
    session: CredentialVaultSession,
    input: { providerId: string; accountLabel: string; secret: string }
  ): Promise<VaultEntryMetadata>;
  update(
    session: CredentialVaultSession,
    entryId: string,
    input: { accountLabel?: string; secret?: string }
  ): Promise<VaultEntryMetadata>;
  remove(session: CredentialVaultSession, entryId: string): Promise<void>;
  withSecret<T>(
    session: CredentialVaultSession,
    entryId: string,
    providerId: string,
    operation: (secret: string) => Promise<T>
  ): Promise<T>;
  rotate(session: CredentialVaultSession): Promise<void>;
}
```

- [x] Validate provider ID with the same rules as capability qualifiers, label 1 to 120 characters, secret 1 to 8,192 bytes, maximum 50 entries, unique entry IDs.
- [x] Wrap a fresh CEK with the vault DEK for every create or update. Encrypt the secret with the entry CEK and a fresh nonce.
- [x] AAD for the wrapped CEK binds `vaultId`, `activeKid`, `entryId`, `providerId`, `accountLabel`, `entryVersion`, and `"entry-key"`.
- [x] AAD for the secret binds `vaultId`, `activeKid`, `entryId`, `providerId`, `accountLabel`, `entryVersion`, and `"entry-secret"`.
- [x] `withSecret` checks session expiry and provider ID before decrypting. It returns only the operation result, never the secret.
- [x] `update` rewraps only that entry. Other entries keep their ciphertext.
- [x] `rotate` creates a new active key ID and vault DEK, then rewraps every entry with a new CEK. The old vault DEK no longer decrypts new records.
- [x] Test: create, list, update, remove, and `withSecret` round-trip.
- [x] Test: wrong provider ID is rejected.
- [x] Test: swapping entry IDs, provider IDs, labels, key IDs, or ciphertext fails authentication.
- [x] Test: nonces are unique across wrapped keys and secret ciphertexts.
- [x] Test: update leaves other entries unchanged.
- [x] Test: rotation preserves secrets and invalidates the old DEK.
- [x] Test: lock and expiry reject `withSecret`, create, update, remove, and list.
- [x] Test: record JSON contains no secret.
- [x] Run `node scripts/vitest.mjs run packages/credential-vault/src/__tests__/entries.test.ts`.
- [x] Do not commit unless Rya asks.

### Task 6: Add credential stores and runtime

**Files:**

- Create: `apps/web/lib/credentials/dexie-store.ts`
- Create: `apps/web/lib/credentials/session-store.ts`
- Create: `apps/web/lib/credentials/runtime.ts`
- Create: `apps/web/lib/credentials/errors.ts`
- Create: `apps/web/lib/credentials/__tests__/dexie-store.test.ts`
- Create: `apps/web/lib/credentials/__tests__/session-store.test.ts`
- Create: `apps/web/lib/credentials/__tests__/runtime.test.ts`
- Modify: `apps/web/next.config.ts`: add `@opennest/credential-vault`.
- Modify: `scripts/check-browser-graph.mjs`: add credential-vault entry point.

**Interfaces:**

```ts
export interface CredentialHandle {
  readonly kind: "session" | "vault";
  readonly id: string;
  readonly providerId: string;
}

export interface SessionCredentialMetadata {
  readonly id: string;
  readonly providerId: string;
  readonly accountLabel: string;
  readonly createdAt: number;
}

export interface SessionCredentialStore {
  put(input: {
    providerId: string;
    accountLabel: string;
    secret: string;
  }): Promise<SessionCredentialMetadata>;
  list(): readonly SessionCredentialMetadata[];
  remove(id: string): void;
  removeProvider(providerId: string): void;
  clear(): void;
  withSecret<T>(
    id: string,
    providerId: string,
    operation: (secret: string) => Promise<T>
  ): Promise<T>;
}

export interface CredentialRuntime {
  readonly session: SessionCredentialStore;
  readonly vault: CredentialVault;
  createSessionCredential(input: {
    providerId: string;
    accountLabel: string;
    secret: string;
  }): Promise<SessionCredentialMetadata>;
  setupVault(passphrase: string): Promise<void>;
  unlockVault(passphrase: string): Promise<void>;
  getVaultSession(): CredentialVaultSession | null;
  lockVault(): void;
  resolve(handle: CredentialHandle): Promise<string>;
  clearAllData(): Promise<void>;
  dispose(): Promise<void>;
}
```

- [x] Create Dexie database `opennest-credentials`, version 1, table `vaults: "id"`, row `{ id: "default", record }`.
- [x] Store only the parsed vault record. No secret outside ciphertext.
- [x] Create an in-memory session credential store. Secrets live in a private map. `list` returns metadata only.
- [x] `resolve` maps `session` handles through `withSecret` and `vault` handles through the unlocked vault session. It rejects mismatched provider IDs.
- [x] `clearAllData` clears session credentials, deletes the vault record, and locks the vault.
- [x] Add `@opennest/credential-vault` to `transpilePackages`.
- [x] Add `packages/credential-vault/src/index.ts` to the browser graph entries.
- [x] Test: Dexie vault record survives reopen.
- [x] Test: serialized Dexie record contains no plaintext secret.
- [x] Test: session credentials are cleared on `clear`.
- [x] Test: `resolve` rejects wrong provider and locked vault.
- [x] Test: `clearAllData` removes vault and session credentials.
- [x] Run `node scripts/vitest.mjs run apps/web/lib/credentials/__tests__/dexie-store.test.ts apps/web/lib/credentials/__tests__/session-store.test.ts apps/web/lib/credentials/__tests__/runtime.test.ts`.
- [x] Run `npm run check:browser-graph`.
- [x] Do not commit unless Rya asks.

### Task 7: Add AI provider contracts, registry, and endpoint policy

**Files:**

- Create: `packages/ai/package.json`
- Create: `packages/ai/src/types.ts`
- Create: `packages/ai/src/errors.ts`
- Create: `packages/ai/src/endpoint.ts`
- Create: `packages/ai/src/registry.ts`
- Create: `packages/ai/src/presets.ts`
- Create: `packages/ai/src/payload.ts`
- Create: `packages/ai/src/memory-store.ts`
- Create: `packages/ai/src/index.ts`
- Create: `packages/ai/src/__tests__/endpoint.test.ts`
- Create: `packages/ai/src/__tests__/registry.test.ts`
- Modify: `apps/web/next.config.ts`: add `@opennest/ai`.
- Modify: `scripts/check-browser-graph.mjs`: add AI entry point.

**Interfaces:**

```ts
export type AiProviderKind = "local" | "remote" | "custom" | "mcp";
export type AiAuthType = "none" | "bearer" | "x-api-key";
export type AiCapability = "chat" | "embedding" | "vision" | "tools";

export interface AiProviderConfig {
  readonly id: string;
  readonly label: string;
  readonly kind: AiProviderKind;
  readonly adapter: "openai-compatible";
  readonly endpoint: string;
  readonly models: readonly string[];
  readonly capabilities: readonly AiCapability[];
  readonly auth: AiAuthType;
  readonly dataPolicyUrl: string | null;
  readonly maxContextTokens: number | null;
  readonly maxOutputTokens: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface AiProviderStore {
  list(): Promise<AiProviderConfig[]>;
  get(id: string): Promise<AiProviderConfig | null>;
  put(config: AiProviderConfig): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

export interface AiProviderRegistry {
  list(): Promise<AiProviderConfig[]>;
  get(id: string): Promise<AiProviderConfig | null>;
  create(
    input: Omit<AiProviderConfig, "id" | "createdAt" | "updatedAt">
  ): Promise<AiProviderConfig>;
  update(
    id: string,
    input: Omit<AiProviderConfig, "id" | "createdAt" | "updatedAt">
  ): Promise<AiProviderConfig>;
  remove(id: string): Promise<void>;
}
```

- [x] Validate IDs, labels, models, capabilities, auth, token limits, and data policy URLs.
- [x] Reject `kind: "mcp"` and `capabilities` containing `"tools"` in D4B with `unsupported_provider_kind` or `unsupported_capability`.
- [x] `local` accepts HTTP only for loopback hosts. `remote` and `custom` require HTTPS.
- [x] Reject userinfo, query strings, fragments, wildcard hosts, empty hosts, and non-HTTP protocols.
- [x] Reject mixed content and remote HTTP.
- [x] Provide presets: OpenAI-compatible, Ollama, LM Studio, Custom. No keys.
- [x] Define `validateAiRequest`, `joinEndpoint`, and `hashPayload` in `payload.ts`.
- [x] Test: valid local and remote endpoints pass.
- [x] Test: remote HTTP, userinfo, query, fragment, and wildcard fail.
- [x] Test: registry create, update, and delete.
- [x] Test: duplicate model and empty model list are rejected.
- [x] Test: tools and MCP are rejected.
- [x] Test: presets contain no credentials.
- [x] Add package to `transpilePackages` and browser graph entries.
- [x] Run `node scripts/vitest.mjs run packages/ai/src/__tests__/endpoint.test.ts packages/ai/src/__tests__/registry.test.ts`.
- [x] Run `npm run check:browser-graph`.
- [x] Do not commit unless Rya asks.

### Task 8: Add OpenAI-compatible adapter and mock adapter

**Files:**

- Create: `packages/ai/src/transport.ts`
- Create: `packages/ai/src/openai-compatible.ts`
- Create: `packages/ai/src/mock.ts`
- Modify: `packages/ai/src/types.ts`
- Modify: `packages/ai/src/index.ts`
- Create: `packages/ai/src/__tests__/adapter.test.ts`

**Interfaces:**

```ts
export interface AiCredentialHandle {
  readonly kind: "session" | "vault";
  readonly id: string;
  readonly providerId: string;
}

export interface AiTransportRequest {
  readonly url: string;
  readonly providerId: string;
  readonly allowedOrigin: string;
  readonly auth: AiAuthType;
  readonly method: "GET" | "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
  readonly credential: AiCredentialHandle | null;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
}

export interface AiTransportResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array> | null;
  readonly text: () => Promise<string>;
}

export interface AiTransport {
  send(request: AiTransportRequest): Promise<AiTransportResponse>;
}

export interface AiPreparedPayload {
  readonly provider: AiProviderConfig;
  readonly request: AiRequest;
  readonly endpoint: string;
  readonly origin: string;
  readonly body: string;
  readonly payloadHash: string;
  readonly payloadBytes: number;
}

export interface AiSendInput {
  readonly prepared: AiPreparedPayload;
  readonly transport: AiTransport;
  readonly credential: AiCredentialHandle | null;
  readonly signal: AbortSignal;
}

export interface AiProviderAdapter {
  readonly config: AiProviderConfig;
  prepare(request: AiRequest): Promise<AiPreparedPayload>;
  complete(input: AiSendInput): Promise<AiCompletion>;
  stream(input: AiSendInput): AsyncIterable<AiStreamEvent>;
  embed(input: AiSendInput): Promise<AiEmbedding>;
  health(input: AiSendInput): Promise<AiHealth>;
  abort(): void;
}
```

- [x] `prepare` validates messages, model membership, token limits, and total request size. It returns the exact body string, endpoint, origin, hash, and bytes.
- [x] `complete` posts to `/chat/completions` with `stream: false` and parses text, model, usage, and finish reason safely.
- [x] `stream` posts with `stream: true`, parses SSE `data:` lines and `[DONE]`, and yields text deltas.
- [x] `embed` posts to `/embeddings` and validates finite vectors.
- [x] `health` calls `GET /models` and returns a safe status. It still goes through the transport.
- [x] `abort` aborts the active adapter request.
- [x] Map HTTP 401, 403, 429, 5xx, malformed JSON, network errors, and aborts to safe `AiError` codes. Never include response bodies.
- [x] Mock adapter supports scripted complete, stream, error, and abort cases.
- [x] Test: complete, stream, abort, malformed response, HTTP failure, embed, and health.
- [x] Test: transport receives the exact body string returned by `prepare`.
- [x] Test: no adapter test makes a real network call.
- [x] Run `node scripts/vitest.mjs run packages/ai/src/__tests__/adapter.test.ts`.
- [x] Do not commit unless Rya asks.

### Task 9: Add browser transport and CSP

**Files:**

- Create: `apps/web/lib/ai/transport.ts`
- Create: `apps/web/lib/ai/errors.ts`
- Create: `apps/web/lib/ai/__tests__/transport.test.ts`
- Modify: `apps/web/next.config.ts`
- Create: `apps/web/__tests__/next-config.test.ts`

**Interfaces:**

```ts
export interface BrowserAiTransportOptions {
  readonly resolveCredential: (handle: AiCredentialHandle) => Promise<string>;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

export function createBrowserAiTransport(options: BrowserAiTransportOptions): AiTransport;
```

- [x] Re-validate the request URL, origin, protocol, userinfo, query, and fragment before fetch.
- [x] Reject a credential whose provider ID does not match. Reject a credential for `auth: "none"`. Require a credential for `bearer` and `x-api-key`.
- [x] Inject only `Authorization: Bearer <secret>` or `x-api-key: <secret>`. Do not allow arbitrary headers.
- [x] Use `credentials: "omit"`, `referrerPolicy: "no-referrer"`, `redirect: "error"`, `cache: "no-store"`, `mode: "cors"`.
- [x] Enforce `AI_MAX_REQUEST_BYTES = 256 * 1024`, `AI_MAX_RESPONSE_BYTES = 2 * 1024 * 1024`, `AI_TIMEOUT_MS = 60_000`, `AI_STREAM_TIMEOUT_MS = 120_000`.
- [x] Read response with a byte limiter. Abort and fail with `response_too_large` when the limit is crossed.
- [x] Clear timers and response readers in all paths.
- [x] Change production CSP to `connect-src 'self' https: http://localhost:* http://127.0.0.1:*`. Keep development `ws:` and `wss:`. Chromium rejects IPv6 literals in CSP source lists.
- [x] Add a test that the CSP includes HTTPS and loopback but does not include broad `http:`.
- [x] Test: credential header is injected and the raw secret never appears in an error.
- [x] Test: HTTP redirect fails.
- [x] Test: wrong origin, wrong provider, missing credential, and unexpected credential fail.
- [x] Test: timeout, oversized response, network error, and abort map to safe codes.
- [x] Test: console methods are not called with secrets or bodies.
- [x] Run `node scripts/vitest.mjs run apps/web/lib/ai/__tests__/transport.test.ts apps/web/__tests__/next-config.test.ts`.
- [x] Do not commit unless Rya asks.

### Task 10: Add AI runtime orchestration

**Files:**

- Create: `apps/web/lib/ai/runtime.ts`
- Create: `apps/web/lib/ai/__tests__/runtime.test.ts`

**Interfaces:**

```ts
export interface AiCredentialChoice {
  readonly kind: "session" | "vault";
  readonly id: string;
  readonly providerId: string;
}

export interface AiRequestInput {
  readonly providerId: string;
  readonly model: string;
  readonly messages: readonly AiMessage[];
  readonly dataClasses: readonly DataClass[];
  readonly purpose: string;
  readonly credential: AiCredentialChoice | null;
  readonly stream: boolean;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface AiPreparedRequest {
  readonly prepared: AiPreparedPayload;
  readonly provider: AiProviderConfig;
  readonly dataClasses: readonly DataClass[];
  readonly purpose: string;
  readonly credential: AiCredentialChoice | null;
  readonly expiresAt: number;
}

export interface AiRuntime {
  isEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<void>;
  listProviders(): Promise<AiProviderConfig[]>;
  prepare(input: AiRequestInput): Promise<AiPreparedRequest>;
  approveAndSend(
    input: AiPreparedRequest,
    options?: { signal?: AbortSignal }
  ): Promise<AiCompletion>;
  approveAndStream(
    input: AiPreparedRequest,
    options?: { signal?: AbortSignal }
  ): AsyncIterable<AiStreamEvent>;
  revokeConsent(id: string): Promise<void>;
  listConsents(): Promise<ConsentRecord[]>;
  dispose(): Promise<void>;
}
```

- [x] Reject when AI is disabled, provider is missing, model is unknown, auth requires a missing credential, data classes are outside `D1` and `D2`, or payload exceeds limits.
- [x] `prepare` calls the adapter and returns the exact preview. It does not create consent or grants.
- [x] `approveAndSend` re-reads the provider, re-prepares, and compares hash and origin. Any change returns `payload_changed`.
- [x] Create one consent with a 5-minute expiry.
- [x] Create session-only, one-use grants for `ai.invoke:<provider>`, `network.connect:<origin>`, and optionally `credential.use:<provider>`. Set `auditRef` to the consent ID.
- [x] For credential use, create a high-risk confirmation with the provider scope digest and `itemCount: 1`.
- [x] Append `ai.requested` before consuming consent. If audit fails, revoke grants and consent.
- [x] Consume consent with the exact expectation. If it fails, revoke grants.
- [x] Invoke capabilities with linked abort signals. Abort the adapter and all handles on user abort or revocation.
- [x] Append `ai.completed`, `ai.failed`, or `ai.aborted` with safe reason codes only.
- [x] Streaming consumes the adapter stream and audits completion in `finally`.
- [x] Test: no network without approval.
- [x] Test: payload substitution fails.
- [x] Test: replay fails with `consent_used`.
- [x] Test: consent mismatch on model or origin fails.
- [x] Test: credential use requires high-risk confirmation.
- [x] Test: abort aborts transport and audits `ai.aborted`.
- [x] Test: audit and consent records contain no prompt or secret.
- [x] Run `node scripts/vitest.mjs run apps/web/lib/ai/__tests__/runtime.test.ts`.
- [x] Do not commit unless Rya asks.

### Task 11: Add AI store, app integration, and delete-all cleanup

**Files:**

- Create: `apps/web/lib/ai/store.ts`
- Create: `apps/web/lib/ai/__tests__/store.test.ts`
- Modify: `apps/web/lib/data/app-data-provider.tsx`
- Modify: `apps/web/lib/privacy/runtime.ts`
- Modify: `apps/web/lib/privacy/data-controls.ts`
- Modify: `apps/web/lib/privacy/__tests__/data-controls.test.ts`
- Modify: `apps/web/lib/data/__tests__/app-data-provider.test.tsx`

**Interfaces:**

```ts
export interface AiStore {
  init(): Promise<void>;
  close(): Promise<void>;
  reset(): Promise<void>;
  readonly providers: AiProviderStore;
  getEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<void>;
}

export interface ReadyAppData {
  readonly ai: AiRuntime;
  readonly credentials: CredentialRuntime;
  // existing fields unchanged
}
```

- [x] Create Dexie database `opennest-ai`, version 1, tables `providers: "id, kind, updatedAt"` and `meta: "key"`.
- [x] Default `enabled` is false when the row is missing.
- [x] Add memory AI store for tests and non-IndexedDB environments.
- [x] Build credentials and AI after privacy in `buildRuntime`.
- [x] Pass `openAiStore` and `openCredentialStore` through `AppDataProviderProps`.
- [x] Register `setAuxiliaryCleanup` on the privacy runtime so `deleteAll` clears AI providers, AI settings, consents, vault, and session credentials.
- [x] Dispose AI first, then credentials, then privacy, in every teardown path.
- [x] Disabling AI aborts active AI requests but keeps provider configs and credentials.
- [x] Test: AI is disabled by default.
- [x] Test: provider configs persist across runtime rebuilds.
- [x] Test: disabling AI aborts an active request.
- [x] Test: delete-all clears AI store, vault, session credentials, and consents.
- [x] Test: app data provider exposes AI and disposes it on unmount.
- [x] Run `node scripts/vitest.mjs run apps/web/lib/ai/__tests__/store.test.ts apps/web/lib/privacy/__tests__/data-controls.test.ts apps/web/lib/data/__tests__/app-data-provider.test.tsx`.
- [x] Do not commit unless Rya asks.

### Task 12: Add AI settings and credential UI

**Files:**

- Create: `apps/web/components/ai-settings.tsx`
- Create: `apps/web/components/ai-provider-dialog.tsx`
- Create: `apps/web/components/ai-credentials.tsx`
- Modify: `apps/web/components/settings-view.tsx`
- Create: `apps/web/components/__tests__/ai-settings.test.tsx`
- Create: `apps/web/components/__tests__/ai-credentials.test.tsx`
- Modify: `packages/localization/src/en.ts`
- Modify: `packages/localization/src/id.ts`

**Interfaces:**

- Consumes `AiRuntime`, `CredentialRuntime`, and `AiProviderConfig`.
- Produces provider create, edit, and delete, AI toggle, session credential create and remove, vault setup, unlock, lock, change, rotate, and delete, and credential create, update, and remove.

- [x] Add a settings card with the AI toggle, provider list, add provider, edit, delete, and link to `/ai`.
- [x] Add provider dialog with presets, endpoint, models, auth, data policy URL, token limits, and local warning.
- [x] Require the local warning checkbox before saving a local or loopback provider.
- [x] Show remote endpoint validation errors inline. Do not send a network request.
- [x] Add session credential form with write-only password input. Clear the field after save. Never display the value.
- [x] Add vault setup with no-recovery warning and confirmation checkbox.
- [x] Add vault unlock, lock, passphrase change, rotation, delete, and entry management.
- [x] Deleting a provider removes session credentials for that provider. Vault entries are kept and shown as unlinked.
- [x] Test: AI is off by default and the console link is disabled.
- [x] Test: local warning blocks save until checked.
- [x] Test: remote HTTP is rejected inline.
- [x] Test: secret input is cleared after save and the secret is absent from the DOM.
- [x] Test: vault setup warns that there is no recovery.
- [x] Test: wrong vault passphrase and rate limit messages.
- [x] Test: provider deletion removes session credentials but keeps vault entries.
- [x] Add complete English and Indonesian strings.
- [x] Run `node scripts/vitest.mjs run apps/web/components/__tests__/ai-settings.test.tsx apps/web/components/__tests__/ai-credentials.test.tsx packages/localization/src/__tests__/parity.test.ts`.
- [x] Do not commit unless Rya asks.

### Task 13: Add AI console and consent dialog

**Files:**

- Create: `apps/web/app/ai/page.tsx`
- Create: `apps/web/components/ai-console.tsx`
- Create: `apps/web/components/ai-consent-dialog.tsx`
- Create: `apps/web/components/__tests__/ai-console.test.tsx`
- Modify: `packages/localization/src/en.ts`
- Modify: `packages/localization/src/id.ts`

**Interfaces:**

- Consumes `AiRuntime`, `AiPreparedRequest`, and `CredentialRuntime`.
- Produces a minimal, non-persistent AI request console.

- [x] Add `/ai` with provider and model selects, prompt textarea, credential select, stream checkbox, and "Review request".
- [x] Show empty states for AI off, no provider, no credential, and locked vault.
- [x] Show a consent dialog with provider label, endpoint origin, model, data classes, approximate bytes, credential label, retention notice, and prompt preview.
- [x] State clearly that no workspace files or notes are attached.
- [x] On approve, call `approveAndSend` or `approveAndStream`. Disable the button while sending.
- [x] Render response as plain text in a `<pre>` or `white-space: pre-wrap` element. Never use HTML or Markdown rendering.
- [x] Add abort while streaming. Show "Cancelled" and a manual "Review again" action. No automatic retry.
- [x] Do not persist prompts, responses, or chat history.
- [x] Test: AI off shows disabled state and makes no network call.
- [x] Test: prepare opens the dialog with the exact preview.
- [x] Test: cancel sends nothing.
- [x] Test: approve sends the prepared request once.
- [x] Test: double approve is blocked by the UI and consent is one-time.
- [x] Test: response containing HTML is displayed as text.
- [x] Test: abort is handled and no retry occurs.
- [x] Test: no prompt or response is written to localStorage.
- [x] Add complete English and Indonesian strings.
- [x] Run `node scripts/vitest.mjs run apps/web/components/__tests__/ai-console.test.tsx packages/localization/src/__tests__/parity.test.ts`.
- [ ] Do not commit unless Rya asks.

### Task 14: Add privacy inventory, consent history, and backup exclusion

**Files:**

- Modify: `packages/privacy/src/inventory.ts`
- Create: `apps/web/components/privacy-consents.tsx`
- Modify: `apps/web/components/privacy-center.tsx`
- Modify: `apps/web/components/privacy-audit.tsx`
- Modify: `apps/web/components/backup-export-dialog.tsx`
- Create: `apps/web/components/__tests__/privacy-consents.test.tsx`
- Create: `apps/web/lib/privacy/__tests__/backup-exclusion.test.ts`
- Modify: `packages/localization/src/en.ts`
- Modify: `packages/localization/src/id.ts`
- Modify: `docs/privacy-center.md`
- Modify: `docs/backup-format-v2.md`
- Modify: `docs/e2ee-key-management.md`

**Interfaces:**

- `privacy.consents.list()` and `privacy.revokeConsent(id)`.

- [x] Add inventory entries: `ai-provider-config` (D1), `ai-credentials-session` (D3), `ai-credential-vault` (D3), `ai-consents` (D4).
- [x] Mark AI credentials and consents as not included in backups. Vault is IndexedDB and excluded. Session credentials are memory and excluded.
- [x] Set the `ai-provider` flow matrix entry to `available: true` with explicit consent, destination Z2, and data classes D1 and D2.
- [x] Add consent history with provider, model, origin, data classes, timestamps, status, and revoke action. Do not show payload or secret.
- [x] Show AI audit event labels.
- [x] Add the backup note: AI providers, consents, session credentials, and vault credentials are not included.
- [x] Test: inventory contains all AI entries with correct backup flags.
- [x] Test: consent history never renders payload or secret.
- [x] Test: revoke removes the consent and revokes grants.
- [x] Test: backup v1 and v2 with a session and vault secret contain neither secret, provider config, nor consent.
- [x] Test: restoring a backup does not restore AI credentials or provider access.
- [x] Test: workspace recovery does not unlock the vault and vault passphrase does not unlock the workspace.
- [x] Add complete English and Indonesian strings.
- [x] Run `node scripts/vitest.mjs run apps/web/components/__tests__/privacy-consents.test.tsx apps/web/lib/privacy/__tests__/backup-exclusion.test.ts packages/localization/src/__tests__/parity.test.ts`.
- [ ] Do not commit unless Rya asks.

### Task 15: Add E2E, docs, and final verification

**Files:**

- Create: `scripts/e2e-ai.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `ROADMAP.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/ai-security-review.md`

**E2E coverage:**

- [x] Start Next production server and a local OpenAI-compatible mock server on a different loopback port.
- [x] Assert AI is off and no request reaches the mock server on page load.
- [x] Enable AI, add a local provider, and verify the localhost warning.
- [x] Add a session credential and assert the secret is not in the DOM after save.
- [x] Review and approve a prompt. Assert exactly one request, exact body, `Authorization: Bearer ...`, and rendered response.
- [x] Assert no request before approval.
- [x] Return an HTML payload from the mock and assert it renders as text, not HTML.
- [x] Set up the vault, add a vault credential, reload, unlock, and send another request.
- [x] Assert the vault remains locked after reload until the passphrase is entered.
- [x] Delete all data and assert provider config, consent, vault, and enabled flag are gone.
- [x] Verify mobile layout at 412 x 915 without horizontal overflow.
- [x] Assert the CSP includes HTTPS and loopback and that the local provider fetch works.
- [x] Add `test:e2e:ai` and include it in `test:e2e`.
- [x] Update docs with CORS limitations, no automatic retries, no tools or MCP, no document context, no vault recovery, and residual XSS risk.
- [x] Run `node scripts/e2e-ai.mjs`.
- [x] Run `npm test`.
- [x] Run `npm run typecheck`.
- [x] Run `npm run lint`.
- [x] Run `npm run format:check`.
- [x] Run `npm run build`.
- [x] Run `npm run test:e2e`.
- [x] Run `npm run check:browser-graph`.
- [x] Run `npm audit --omit=dev` and report the existing test-toolchain advisories.
- [x] Do not claim D4 complete. D4A extension remains separate.
- [ ] Do not commit unless Rya asks.

---

## Completion Gate

D4B is complete only when:

- AI is off by default and no request can happen without a consumed consent.
- Session-only and vault credentials both work, and vault credentials survive reload while remaining locked.
- The vault uses a separate key domain and no recovery path.
- Credentials are absent from backup v1, backup v2, logs, audit entries, consent records, and exported data.
- Remote HTTP, userinfo, query credentials, cross-origin redirects, and missing credentials fail safely.
- Abort, timeout, CORS failure, HTTP failure, malformed response, and oversized response leave clear local errors.
- Consent history, grant revocation, delete-all, and privacy inventory include AI data.
- All localization parity checks pass.
- Unit, integration, E2E, typecheck, lint, format, build, browser graph, and audit checks are run and reported honestly.
- The plan does not mark D4 complete while D4A extension is still missing.
