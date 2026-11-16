# Stage D1 Trust and Capability Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an enforceable local capability model, a metadata-only audit chain, a separate privacy store, and a working Privacy Center without adding AI, extensions, sync, E2EE, or network egress.

**Architecture:** `packages/privacy` holds pure policy, grant, audit, broker, scope, and inventory logic. `apps/web/lib/privacy` holds the Dexie store, runtime bootstrap, brokered services, and data controls. `AppDataProvider` exposes brokered services and privacy controls instead of raw storage, and `/privacy` renders the Privacy Center shell.

**Tech Stack:** TypeScript, React 19, Next.js 16, Dexie 4, Vitest 3, fake-indexeddb, existing `@opennest/core`, `@opennest/ui`, and `@opennest/localization`.

**Spec:** `docs/superpowers/specs/2026-11-14-stage-d0-architecture-decision-pack.md` sections 8 and 9, `docs/adr/0008-privacy-and-trust-boundaries.md`, `docs/adr/0009-permission-and-capability-model.md`.

## Global Constraints

- Accept only ADR 0008 and ADR 0009 in D1. Keep ADR 0010 to 0013 `Proposed`.
- Do not change `packages/core` ports, domain models, or existing storage schemas.
- Do not add an external dependency. Reuse installed `dexie@4.4.7` and `fake-indexeddb@6.2.8`.
- Default deny. No fallback from a missing grant to a broader built-in grant.
- The broker derives the principal from runtime context, never from a request field.
- Exact scopes only. Reject wildcards, path traversal, empty scopes, duplicate IDs, and ambiguous selectors.
- Every grant, denial, and high-risk data action is audited without titles, filenames, note text, file bytes, credentials, or capability handle IDs.
- Built-in local grants are persistent, non-revocable, and scoped to the single workspace.
- External capabilities stay denied in D1. No AI, extension, sync, E2EE, or network request is added.
- Backup v1 stays compatible. Drafts, grants, audit entries, and search results are not included in backup v1.
- UI copy exists in English and Indonesian.
- Mobile layout must remain usable at 360 px and the bottom navigation must remain readable with six items.
- Do not commit unless the user explicitly asks. Each task ends with verification, not a commit.

## Review Focus

- A component reads `storage` directly and bypasses the broker. Every existing direct use is replaced or brokered, and a test proves a missing grant denies the operation.
- Revocation happens while an operation is running. The operation is aborted, its result is discarded, and a later handle use is denied.
- Audit storage fails or the chain is tampered with. High-risk actions fail closed, ordinary reads surface a warning, and a reload preserves the chain.
- Delete all data leaves drafts, grants, audit entries, or a stale workspace behind, or reports success after a partial failure.
- Export or restore shows the wrong scope or omits the backup-exclusion copy. Tests pin the exact scope digest, item counts, and exclusion text.

---

## File Structure

### New package

- `packages/privacy/package.json`: workspace package metadata, exports `./src/index.ts`.
- `packages/privacy/src/types.ts`: principal, capability, scope, grant, handle, audit, inventory, store interfaces.
- `packages/privacy/src/capabilities.ts`: catalog, parsing, capability families, built-in matrix.
- `packages/privacy/src/scope.ts`: scope normalization, exact-ID validation, origin validation, subset check, digest.
- `packages/privacy/src/grants.ts`: grant registry and lifecycle.
- `packages/privacy/src/policy.ts`: default-deny policy, built-in grants, high-risk confirmation checks.
- `packages/privacy/src/audit.ts`: append-only hash chain and verification.
- `packages/privacy/src/broker.ts`: principal-bound request, handle, invocation, revocation, rate limit.
- `packages/privacy/src/inventory.ts`: data inventory and cross-zone flow matrix.
- `packages/privacy/src/hash.ts`: SHA-256 helper.
- `packages/privacy/src/index.ts`: public exports.
- `packages/privacy/src/__tests__/capabilities.test.ts`
- `packages/privacy/src/__tests__/scope.test.ts`
- `packages/privacy/src/__tests__/grants.test.ts`
- `packages/privacy/src/__tests__/policy.test.ts`
- `packages/privacy/src/__tests__/audit.test.ts`
- `packages/privacy/src/__tests__/broker.test.ts`
- `packages/privacy/src/__tests__/inventory.test.ts`

### New app layer

- `apps/web/lib/privacy/dexie-store.ts`: Dexie DB `opennest-privacy`, version 1.
- `apps/web/lib/privacy/__tests__/dexie-store.test.ts`
- `apps/web/lib/privacy/runtime.ts`: session, principal, store, built-in grants, broker, data controls.
- `apps/web/lib/privacy/data-controls.ts`: overview, export, restore, delete, blob reads, draft counts.
- `apps/web/lib/privacy/errors.ts`: privacy error keys and user-facing error mapping.
- `apps/web/lib/privacy/__tests__/runtime.test.ts`
- `apps/web/lib/privacy/__tests__/data-controls.test.ts`
- `apps/web/app/privacy/page.tsx`
- `apps/web/components/privacy-center.tsx`
- `apps/web/components/privacy-overview.tsx`
- `apps/web/components/privacy-inventory.tsx`
- `apps/web/components/privacy-audit.tsx`
- `apps/web/components/privacy-grants.tsx`
- `apps/web/components/__tests__/privacy-center.test.tsx`
- `apps/web/components/__tests__/privacy-overview.test.tsx`

### Modified

- `apps/web/package.json`: add `dexie` dependency and `fake-indexeddb` devDependency.
- `apps/web/lib/data/app-data-provider.tsx`: expose `privacy`, remove raw `storage` from ready context.
- `apps/web/lib/data/services.ts`: no core contract change; add brokered wrapper helpers if needed.
- `apps/web/components/backup-panel.tsx`: use `privacy.data` and broker-backed export/restore.
- `apps/web/components/dashboard.tsx`: use `privacy.data.overview()`.
- `apps/web/components/file-preview.tsx`: use `privacy.data.readBlob()`.
- `apps/web/components/app-shell.tsx`: add `/privacy` navigation item.
- `apps/web/components/settings-view.tsx`: add link to Privacy Center.
- `packages/localization/src/en.ts`: add privacy, inventory, audit, grant, export, delete, and revocation copy.
- `packages/localization/src/id.ts`: same keys with Indonesian copy.
- `docs/adr/0008-privacy-and-trust-boundaries.md`: status `Accepted`.
- `docs/adr/0009-permission-and-capability-model.md`: status `Accepted`.
- `ROADMAP.md`: mark D1 items only when the gate passes.
- `docs/privacy-center.md`: capability catalog, inventory, audit events, built-in grants, revocation limits.

---

## Task 1: Accept ADR 0008 and 0009

**Files:**

- Modify: `docs/adr/0008-privacy-and-trust-boundaries.md`
- Modify: `docs/adr/0009-permission-and-capability-model.md`

**Interfaces:**

- Consumes: user approval recorded in this session.
- Produces: accepted foundational ADRs for all later tasks.

- [ ] **Step 1: Change only the status lines**

Set each ADR's status to `Accepted`, preserving the date and the rest of the document.

- [ ] **Step 2: Verify the status**

Run: `rg -n '^## Status|Accepted|Proposed' docs/adr/0008-privacy-and-trust-boundaries.md docs/adr/0009-permission-and-capability-model.md`
Expected: both D1 ADRs say `Accepted`; ADR 0010 to 0013 still say `Proposed`.

---

## Task 2: Privacy package and capability catalog

**Files:**

- Create: `packages/privacy/package.json`
- Create: `packages/privacy/src/types.ts`
- Create: `packages/privacy/src/capabilities.ts`
- Create: `packages/privacy/src/scope.ts`
- Create: `packages/privacy/src/hash.ts`
- Create: `packages/privacy/src/index.ts`
- Test: `packages/privacy/src/__tests__/capabilities.test.ts`
- Test: `packages/privacy/src/__tests__/scope.test.ts`

**Interfaces:**

- Produces:
  - `type PrincipalType = "built-in" | "extension" | "ai-provider" | "sync-target" | "external-storage" | "user"`
  - `interface Principal { id: string; type: PrincipalType; label: string }`
  - `type Capability = "workspace.read.metadata" | "workspace.read.content" | "workspace.write" | "workspace.export" | "workspace.delete" | `network.connect:${string}`|`credential.use:${string}`|`ai.invoke:${string}` | "sync.push" | "sync.pull"`
  - `type ResourceScope = { kind: "workspace"; workspaceId: string } | { kind: "folder"; workspaceId: string; folderId: string; includeDescendants: boolean } | { kind: "notes"; workspaceId: string; noteIds: string[] } | { kind: "files"; workspaceId: string; fileIds: string[] } | { kind: "origin"; origin: string } | { kind: "provider"; providerId: string }`
  - `parseCapability(value: string): ParsedCapability`
  - `normalizeScope(scope: ResourceScope): ResourceScope`
  - `scopeDigest(scope: ResourceScope): Promise<string>`
  - `assertScopeSubset(granted: ResourceScope, requested: ResourceScope): void`

- [ ] **Step 1: Write failing catalog and scope tests**

```ts
it("rejects wildcard and traversal identifiers", () => {
  expect(() =>
    normalizeScope({ kind: "notes", workspaceId: "w1", noteIds: ["*"] })
  ).toThrow();
  expect(() =>
    normalizeScope({ kind: "files", workspaceId: "w1", fileIds: ["../x"] })
  ).toThrow();
});

it("normalizes origins and rejects credentials or insecure non-loopback http", () => {
  expect(
    normalizeScope({ kind: "origin", origin: "HTTPS://Example.COM:443/path" })
  ).toEqual({
    kind: "origin",
    origin: "https://example.com",
  });
  expect(() =>
    normalizeScope({ kind: "origin", origin: "http://example.com" })
  ).toThrow();
  expect(() =>
    normalizeScope({ kind: "origin", origin: "https://user:pass@example.com" })
  ).toThrow();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/vitest.mjs run packages/privacy/src/__tests__/capabilities.test.ts packages/privacy/src/__tests__/scope.test.ts`
Expected: FAIL because the package and functions do not exist.

- [ ] **Step 3: Implement the catalog and scope helpers**

Use a static catalog for the five workspace capabilities and the named external capabilities. Parse `network.connect:<origin>`, `credential.use:<provider-id>`, and `ai.invoke:<provider-id>` only when the suffix is exact. Reject empty, wildcard, control-character, path-traversal, and duplicate selectors. Normalize origins with `URL`; remove default ports, reject credentials, hashes, wildcards, and `http` unless the host is `localhost`, `127.0.0.1`, or `[::1]`.

- [ ] **Step 4: Run the tests to verify they pass**

Run the same command. Expected: PASS.

---

## Task 3: Grant registry and policy

**Files:**

- Create: `packages/privacy/src/grants.ts`
- Create: `packages/privacy/src/policy.ts`
- Test: `packages/privacy/src/__tests__/grants.test.ts`
- Test: `packages/privacy/src/__tests__/policy.test.ts`

**Interfaces:**

- Consumes: `Principal`, `Capability`, `ResourceScope`, `scopeDigest`, `normalizeScope` from Task 2.
- Produces:
  - `interface CapabilityGrant { id: string; principalId: string; capability: Capability; scope: ResourceScope; purpose: string; createdAt: number; expiresAt: number | null; maxUses: number | null; uses: number; sessionOnly: boolean; sessionId: string | null; status: "active" | "revoked"; builtIn: boolean; auditRef: string | null; revokedAt: number | null }`
  - `createGrantRegistry(input: { store: GrantStore; now: () => number; generateId: () => string }): GrantRegistry`
  - `builtInGrants(input: { workspaceId: string; now: number; generateId: () => string }): CapabilityGrant[]`
  - `effectiveGrantStatus(grant: CapabilityGrant, now: number): "active" | "expired" | "exhausted" | "revoked"`
  - `assertGrantAllows(grant: CapabilityGrant, request: { capability: Capability; scope: ResourceScope; now: number }): void`

- [ ] **Step 1: Write failing lifecycle tests**

```ts
it("expires, exhausts, and revokes grants", () => {
  const grant = activeGrant({ expiresAt: 200, maxUses: 2 });
  expect(effectiveGrantStatus(grant, 201)).toBe("expired");
  expect(effectiveGrantStatus({ ...grant, uses: 2 }, 100)).toBe("exhausted");
  expect(effectiveGrantStatus({ ...grant, status: "revoked" }, 100)).toBe("revoked");
});

it("does not let a built-in grant authorize an external capability", () => {
  expect(() =>
    assertGrantAllows(builtInGrants({ workspaceId: "w1", now: 1, generateId })[0], {
      capability: "ai.invoke:openai",
      scope: { kind: "provider", providerId: "openai" },
      now: 1,
    })
  ).toThrow();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/vitest.mjs run packages/privacy/src/__tests__/grants.test.ts packages/privacy/src/__tests__/policy.test.ts`
Expected: FAIL for missing implementation.

- [ ] **Step 3: Implement the registry and policy**

Persist grants through the `GrantStore` interface. Create built-ins for `workspace.read.metadata`, `workspace.read.content`, `workspace.write`, `workspace.export`, and `workspace.delete`, all scoped to the workspace, persistent, and non-revocable. Enforce a default external TTL of 24 hours, a maximum of 30 days, a non-empty purpose of at most 200 characters, and a 500-item maximum for selected notes or files. Require a recent `HighRiskConfirmation` for `workspace.export`, `workspace.delete`, and `credential.use`.

- [ ] **Step 4: Run the tests to verify they pass**

Run the same command. Expected: PASS.

---

## Task 4: Audit hash chain

**Files:**

- Create: `packages/privacy/src/audit.ts`
- Test: `packages/privacy/src/__tests__/audit.test.ts`

**Interfaces:**

- Consumes: SHA-256 helper and audit store.
- Produces:
  - `interface AuditEntry { id: string; sequence: number; at: number; event: AuditEvent; outcome: AuditOutcome; principalId: string | null; capability: string | null; scopeDigest: string | null; itemCount: number | null; reason: string | null; prevHash: string | null; hash: string }`
  - `createAuditLog(input: { store: AuditStore; now: () => number; generateId: () => string; hash?: (value: string) => Promise<string> }): AuditLog`
  - `interface AuditLog { append(input: AuditInput): Promise<AuditEntry>; list(): Promise<AuditEntry[]>; verify(): Promise<AuditVerification>; clear(): Promise<void> }`

- [ ] **Step 1: Write failing audit tests**

```ts
it("chains entries and detects tampering", async () => {
  const store = createMemoryAuditStore();
  const log = createAuditLog({ store, now: () => 1, generateId });
  await log.append({
    event: "grant.created",
    outcome: "allowed",
    principalId: "builtin:local",
  });
  await log.append({ event: "data.exported", outcome: "completed", itemCount: 3 });
  expect((await log.verify()).valid).toBe(true);

  const rows = await store.list();
  await store.clear();
  await store.append({ ...rows[0], reason: "tampered" });
  expect((await log.verify()).valid).toBe(false);
});

it("does not store content-like fields", async () => {
  const log = createAuditLog({
    store: createMemoryAuditStore(),
    now: () => 1,
    generateId,
  });
  const entry = await log.append({
    event: "data.exported",
    outcome: "completed",
    principalId: "builtin:local",
    itemCount: 3,
  });
  expect(Object.keys(entry)).not.toContain("content");
  expect(Object.keys(entry)).not.toContain("title");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/vitest.mjs run packages/privacy/src/__tests__/audit.test.ts`
Expected: FAIL for missing implementation.

- [ ] **Step 3: Implement the append-only chain**

Serialize appends through a promise queue. Use canonical JSON without the `hash` field, `prevHash` from the last entry, and SHA-256. `verify` checks sequence, previous hash, and each hash. `clear` removes all entries for a full data deletion. Audit append failure must be surfaced to the caller; the broker decides fail-closed behavior.

- [ ] **Step 4: Run the tests to verify they pass**

Run the same command. Expected: PASS.

---

## Task 5: Capability broker

**Files:**

- Create: `packages/privacy/src/broker.ts`
- Test: `packages/privacy/src/__tests__/broker.test.ts`

**Interfaces:**

- Consumes: `GrantRegistry`, `AuditLog`, `Principal`, `Capability`, `ResourceScope`, `scopeDigest`.
- Produces:
  - `createCapabilityBroker(input: { principal: Principal; sessionId: string; grants: GrantRegistry; audit: AuditLog; now: () => number; generateId: () => string; onRevoke?: () => void; maxCallsPerWindow?: number; windowMs?: number }): CapabilityBroker`
  - `interface CapabilityBroker { request(input: CapabilityRequest): Promise<CapabilityHandle>; invoke<T>(handle: CapabilityHandle, operation: (signal: AbortSignal) => Promise<T>): Promise<T>; revoke(grantId: string): Promise<void>; revokeAll(): Promise<number>; listGrants(): Promise<CapabilityGrant[]>; endSession(): Promise<void> }`
  - `class CapabilityDeniedError extends Error { code: "unknown" | "expired" | "revoked" | "exhausted" | "mismatch" | "rate_limited" | "confirmation_required" | "confirmation_stale" }`

- [ ] **Step 1: Write failing broker tests**

```ts
it("binds a handle to its principal and session", async () => {
  const a = createBroker("built-in:local", "session-a");
  const b = createBroker("built-in:other", "session-b");
  const handle = await a.request(workspaceReadRequest());
  await expect(b.invoke(handle, async () => "secret")).rejects.toMatchObject({
    code: "mismatch",
  });
});

it("cancels an in-flight operation on revoke and rejects later use", async () => {
  let started: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    started = resolve;
  });
  const broker = createBroker("built-in:local", "session-a");
  const handle = await broker.request(workspaceReadRequest());
  const running = broker.invoke(handle, async (signal) => {
    started();
    await gate;
    if (signal.aborted) throw new Error("aborted");
    return "late";
  });
  await gate;
  await broker.revoke(handle.grantId);
  await expect(running).rejects.toMatchObject({ code: "revoked" });
  await expect(broker.invoke(handle, async () => "later")).rejects.toMatchObject({
    code: "revoked",
  });
});

it("denies a request with no matching grant", async () => {
  const broker = createBroker("ai-provider:openai", "session-a");
  await expect(
    broker.request({
      capability: "ai.invoke:openai",
      scope: { kind: "provider", providerId: "openai" },
      purpose: "Draft a note",
    })
  ).rejects.toMatchObject({ code: "unknown" });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/vitest.mjs run packages/privacy/src/__tests__/broker.test.ts`
Expected: FAIL for missing implementation.

- [ ] **Step 3: Implement the broker**

Resolve the principal only from the closure. Validate the request with `assertGrantAllows`, compute the scope digest, record the denied or allowed audit event, and issue an opaque handle bound to principal, grant, scope, session, and expiry. `invoke` checks handle identity, session, grant status, use count, and expiry; registers an `AbortController`; calls the operation with its signal; discards results after revocation; and records completion or failure. Rate-limit calls per principal and capability with a sliding window and audit the denial. `revoke` marks the grant revoked, aborts active operations, calls `onRevoke`, and records the audit event.

- [ ] **Step 4: Run the tests to verify they pass**

Run the same command. Expected: PASS.

---

## Task 6: Data inventory and flow matrix

**Files:**

- Create: `packages/privacy/src/inventory.ts`
- Test: `packages/privacy/src/__tests__/inventory.test.ts`

**Interfaces:**

- Produces:
  - `dataInventory: readonly DataInventoryEntry[]`
  - `flowMatrix: readonly FlowMatrixEntry[]`
  - `inventoryByClass(entries?: readonly DataInventoryEntry[]): Record<DataClass, DataInventoryEntry[]>`

- [ ] **Step 1: Write failing inventory tests**

```ts
it("marks drafts, grants, audit, and search results as excluded from backup v1", () => {
  const ids = dataInventory
    .filter((entry) => !entry.includedInBackup)
    .map((entry) => entry.id);
  expect(ids).toEqual(expect.arrayContaining(["drafts", "grants", "audit", "search"]));
});

it("states that revocation cannot recall data already received by an external party", () => {
  expect(flowMatrix.find((flow) => flow.id === "ai-provider")?.revocationLimitKey).toBe(
    "privacy.flows.revocationLimit"
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/vitest.mjs run packages/privacy/src/__tests__/inventory.test.ts`
Expected: FAIL for missing implementation.

- [ ] **Step 3: Implement the static inventory**

Include workspace, folders, tags, file metadata, file bytes, notes, drafts, grants, audit, search results, and backups. Mark drafts as derived from notes and deleted with source. Mark search results as in-memory and derived from notes and files. Mark backups as D5 and external to the app after download. Include flows for built-in local use, backup export, backup restore, AI provider, extension, and sync. External flows are `available: false` in D1 and require explicit consent in a future stage.

- [ ] **Step 4: Run the tests to verify they pass**

Run the same command. Expected: PASS.

---

## Task 7: Dexie privacy store

**Files:**

- Modify: `apps/web/package.json`
- Create: `apps/web/lib/privacy/dexie-store.ts`
- Test: `apps/web/lib/privacy/__tests__/dexie-store.test.ts`

**Interfaces:**

- Consumes: `PrivacyStore`, `GrantStore`, `AuditStore` from `@opennest/privacy`.
- Produces: `createDexiePrivacyStore(options?: { databaseName?: string; indexedDB?: IDBFactory; IDBKeyRange?: typeof IDBKeyRange }): PrivacyStore`

- [ ] **Step 1: Write failing persistence tests**

```ts
it("persists grants and audit entries across a close and reopen", async () => {
  const name = uniqueDatabaseName();
  const store = createDexiePrivacyStore({ databaseName: name });
  await store.init();
  await store.grants.put(grantFixture({ id: "grant-1" }));
  await store.audit.append(auditFixture({ id: "audit-1", sequence: 0 }));
  await store.close();

  const reopened = createDexiePrivacyStore({ databaseName: name });
  await reopened.init();
  expect(await reopened.grants.get("grant-1")).not.toBeNull();
  expect((await reopened.audit.list()).map((entry) => entry.id)).toEqual(["audit-1"]);
  await reopened.close();
});

it("resets grants, audit, and metadata", async () => {
  const store = createDexiePrivacyStore({ databaseName: uniqueDatabaseName() });
  await store.init();
  await store.grants.put(grantFixture({ id: "grant-1" }));
  await store.audit.append(auditFixture({ id: "audit-1", sequence: 0 }));
  await store.reset();
  expect(await store.grants.list()).toEqual([]);
  expect(await store.audit.list()).toEqual([]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/vitest.mjs run apps/web/lib/privacy/__tests__/dexie-store.test.ts`
Expected: FAIL because the store does not exist.

- [ ] **Step 3: Implement the store**

Use Dexie version 1 with tables `grants: "id, principalId, capability, status, expiresAt"`, `audit: "id, sequence, at, event"`, and `meta: "key"`. Add `dexie` to app dependencies and `fake-indexeddb` to devDependencies. Use `fake-indexeddb/auto` only in tests. `reset` clears all three tables in one transaction. Map Dexie failures through the privacy error type.

- [ ] **Step 4: Run the tests to verify they pass**

Run the same command. Expected: PASS.

---

## Task 8: Privacy runtime and data controls

**Files:**

- Create: `apps/web/lib/privacy/runtime.ts`
- Create: `apps/web/lib/privacy/data-controls.ts`
- Create: `apps/web/lib/privacy/errors.ts`
- Test: `apps/web/lib/privacy/__tests__/runtime.test.ts`
- Test: `apps/web/lib/privacy/__tests__/data-controls.test.ts`

**Interfaces:**

- Consumes: `StorageAdapter`, `AppServices`, `buildBackup`, `parseBackupFile`, `clearAllNoteDrafts`, privacy package.
- Produces:
  - `createPrivacyRuntime(input: { storage: StorageAdapter; services: AppServices; workspace: Workspace; drafts: DraftStorage; openPrivacyStore?: () => Promise<PrivacyStore>; now?: () => number; generateId?: () => string }): Promise<PrivacyRuntime>`
  - `interface PrivacyRuntime { sessionId: string; principal: Principal; store: PrivacyStore; broker: CapabilityBroker; grants: GrantRegistry; audit: AuditLog; data: DataControls; services: BrokeredAppServices; dispose(): Promise<void> }`
  - `interface DataControls { overview(): Promise<DataOverview>; inventory(): readonly DataInventoryEntry[]; flows(): readonly FlowMatrixEntry[]; exportAll(): Promise<BuiltBackup>; restore(snapshot: BackupSnapshot): Promise<void>; deleteAll(): Promise<void>; readBlob(blobKey: BlobKey): Promise<Blob | null> }`

- [ ] **Step 1: Write failing runtime tests**

```ts
it("bootstraps built-in grants and denies an unbrokered capability", async () => {
  const runtime = await createTestRuntime();
  expect((await runtime.grants.list()).map((grant) => grant.capability)).toEqual(
    expect.arrayContaining(["workspace.read.metadata", "workspace.write"])
  );
  const handle = await runtime.broker.request({
    capability: "workspace.read.metadata",
    scope: { kind: "workspace", workspaceId: "w1" },
    purpose: "Render the dashboard",
  });
  await expect(runtime.broker.invoke(handle, async () => "ok")).resolves.toBe("ok");
});

it("reconciles built-in grants after a restore changes the workspace", async () => {
  const runtime = await createTestRuntime();
  await runtime.data.restore(snapshotForWorkspace("w2"));
  expect(
    (await runtime.grants.list()).every((grant) => grant.scope.workspaceId === "w2")
  ).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/vitest.mjs run apps/web/lib/privacy/__tests__/runtime.test.ts apps/web/lib/privacy/__tests__/data-controls.test.ts`
Expected: FAIL for missing implementation.

- [ ] **Step 3: Implement runtime and controls**

Bootstrap a session ID, the built-in principal, the privacy store, built-in grants, audit, and broker. Wrap each `AppServices` method with the matching capability. Use `workspace.read.metadata` for lists, get, and overview; `workspace.read.content` for note content and blobs; `workspace.write` for create, update, move, tag, and link; `workspace.export` for export; `workspace.delete` for deletes. `exportAll` calls `buildBackup` with a confirmation and audits the summary counts. `restore` requires confirmation, restores storage, clears drafts, audits, and reconciles built-in grants to the restored workspace. `deleteAll` clears drafts first and aborts if any draft cannot be removed, then resets privacy, resets storage, recreates the workspace, and bootstraps built-in grants without an audit entry.

- [ ] **Step 4: Run the tests to verify they pass**

Run the same command. Expected: PASS.

---

## Task 9: Replace direct storage access

**Files:**

- Modify: `apps/web/lib/data/app-data-provider.tsx`
- Modify: `apps/web/components/backup-panel.tsx`
- Modify: `apps/web/components/dashboard.tsx`
- Modify: `apps/web/components/file-preview.tsx`
- Test: `apps/web/lib/data/__tests__/app-data-provider.test.tsx`
- Test: `apps/web/components/__tests__/backup-panel.test.tsx`

**Interfaces:**

- Consumes: `PrivacyRuntime` from Task 8.
- Produces: `ReadyAppData` with `privacy: PrivacyRuntime` and without a public `storage` field.

- [ ] **Step 1: Write failing component tests**

```tsx
it("does not expose raw storage to components", async () => {
  const { result } = await renderProvider();
  expect(result.current).not.toHaveProperty("storage");
  expect(result.current.privacy.data).toBeDefined();
});

it("asks for confirmation before exporting or replacing data", async () => {
  render(<BackupPanel />);
  await user.click(screen.getByRole("button", { name: /export/i }));
  expect(screen.getByRole("dialog")).toBeVisible();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/vitest.mjs run apps/web/lib/data/__tests__/app-data-provider.test.tsx apps/web/components/__tests__/backup-panel.test.tsx`
Expected: FAIL for missing `privacy` and old direct storage behavior.

- [ ] **Step 3: Integrate the runtime**

Create the privacy runtime after storage init and workspace ensure. Pass `window.localStorage` as the draft storage. Replace `storage.restore` in `backup-panel` with `privacy.data.restore`, `storage.blobs.usage` in `dashboard` with `privacy.data.overview`, and `storage.blobs.get` in `file-preview` with `privacy.data.readBlob`. Keep backup parse and download behavior unchanged. Add export confirmation with the exact file, note, folder, and tag counts.

- [ ] **Step 4: Run the tests to verify they pass**

Run the same command. Expected: PASS.

---

## Task 10: Privacy Center UI

**Files:**

- Create: `apps/web/app/privacy/page.tsx`
- Create: `apps/web/components/privacy-center.tsx`
- Create: `apps/web/components/privacy-overview.tsx`
- Create: `apps/web/components/privacy-inventory.tsx`
- Create: `apps/web/components/privacy-audit.tsx`
- Create: `apps/web/components/privacy-grants.tsx`
- Test: `apps/web/components/__tests__/privacy-center.test.tsx`
- Test: `apps/web/components/__tests__/privacy-overview.test.tsx`

**Interfaces:**

- Consumes: `privacy.data.overview`, `inventory`, `flows`, `exportAll`, `deleteAll`, `grants.list`, `audit.list`.
- Produces: `/privacy` route with overview, inventory, grants, consent history, export, and delete.

- [ ] **Step 1: Write failing UI tests**

```tsx
it("shows storage usage, item counts, and the backup exclusion notice", async () => {
  render(<PrivacyOverview />);
  expect(await screen.findByText("1.5 KB")).toBeVisible();
  expect(
    screen.getByText(/drafts, grants, and audit entries are not included/i)
  ).toBeVisible();
});

it("requires confirmation for delete all and reports success", async () => {
  render(<PrivacyCenter />);
  await user.click(screen.getByRole("button", { name: /delete all data/i }));
  expect(screen.getByRole("dialog")).toBeVisible();
  await user.click(screen.getByRole("button", { name: /delete everything/i }));
  expect(await screen.findByRole("status")).toHaveTextContent(/deleted/i);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/vitest.mjs run apps/web/components/__tests__/privacy-center.test.tsx apps/web/components/__tests__/privacy-overview.test.tsx`
Expected: FAIL because the route and components do not exist.

- [ ] **Step 3: Implement the Privacy Center**

Use `PageHeader`, `Card`, `Button`, `ConfirmDialog`, and existing tokens. Show blob bytes and item counts, a data inventory table with data class and backup inclusion, grant rows, audit rows, export, and delete all. Provide loading, error, empty, and success states. Delete copy must state that downloaded backups are not deleted. Revocation copy must state that revocation cannot recall data already received by an external party. All text uses localization keys.

- [ ] **Step 4: Run the tests to verify they pass**

Run the same command. Expected: PASS.

---

## Task 11: Navigation and localization

**Files:**

- Modify: `apps/web/components/app-shell.tsx`
- Modify: `apps/web/components/settings-view.tsx`
- Modify: `packages/localization/src/en.ts`
- Modify: `packages/localization/src/id.ts`
- Test: `apps/web/components/__tests__/app-shell.test.tsx`
- Test: `packages/localization/src/__tests__/parity.test.ts`

**Interfaces:**

- Consumes: Privacy Center route.
- Produces: `nav.privacy`, `privacy.*`, `inventory.*`, `audit.*`, `grants.*` keys in both locales.

- [ ] **Step 1: Write failing navigation and parity tests**

```tsx
it("adds Privacy Center to desktop and mobile navigation", () => {
  render(<AppShell>content</AppShell>);
  expect(screen.getAllByRole("link", { name: /privacy/i })).toHaveLength(2);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/vitest.mjs run apps/web/components/__tests__/app-shell.test.tsx packages/localization/src/__tests__/parity.test.ts`
Expected: FAIL because the key and nav item are missing.

- [ ] **Step 3: Implement navigation and copy**

Add `/privacy` after Search and before Settings. Add a link from Settings. Keep the mobile bottom navigation readable at 360 px with six items. Add complete English and Indonesian copy. Use concrete language for export exclusion, delete coverage, and revocation limits.

- [ ] **Step 4: Run the tests to verify they pass**

Run the same command. Expected: PASS.

---

## Task 12: E2E and documentation

**Files:**

- Modify: `scripts/e2e-stage-c.mjs` or create `scripts/e2e-privacy.mjs`
- Modify: `ROADMAP.md`
- Create: `docs/privacy-center.md`
- Modify: `docs/adr/0008-privacy-and-trust-boundaries.md` only if acceptance evidence needs a note.

**Interfaces:**

- Consumes: all previous tasks.
- Produces: an executable privacy journey and operator documentation.

- [ ] **Step 1: Add the privacy E2E journey**

Open `/privacy`, verify storage and item counts, trigger export, cancel delete, confirm delete, verify the empty workspace, built-in grants, and an empty audit after full deletion.

- [ ] **Step 2: Run the E2E test**

Run: `npm run test:e2e`
Expected: PASS, including the privacy journey and the existing Stage C and PWA journeys.

- [ ] **Step 3: Document the implementation**

Document the capability catalog, built-in grants, scope rules, audit events, data inventory, backup exclusions, deletion order, draft failure behavior, and revocation limits. Update `ROADMAP.md` only after all gates pass.

- [ ] **Step 4: Run the full verification**

Run:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run test:e2e
```

Expected: all commands exit 0. Report any command that cannot run and why.

---

## Self-Review

- Spec coverage: D1 scope, data inventory, derived data, cross-zone flows, capability catalog, grants, revocation, audit, Privacy Center, deletion, and localization each map to a task.
- Type consistency: `CapabilityGrant`, `CapabilityHandle`, `CapabilityBroker`, `PrivacyStore`, `PrivacyRuntime`, and `DataControls` keep the same names across tasks.
- Review focus: direct storage bypass, in-flight revocation, audit tamper and failure, full deletion, and export scope all have explicit tests.
- Scope control: no AI, extension, sync, E2EE, network, or core contract change is included.
- Verification: typecheck, lint, format, unit, integration, build, and E2E are listed as gates.
