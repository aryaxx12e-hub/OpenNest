# Stage D Remaining Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every remaining Stage D item that can be delivered internally, record the optional storage and self-hosting decisions, prepare the independent review handoff, and leave the security, cryptographic, and E2EE gates honestly open until an external reviewer signs.

**Architecture:** Add startup blob reconciliation to the SQLite adapter, record two ADR-backed scope decisions, prepare review evidence without self-certifying it, add a minimal non-E2E CI workflow, and update the roadmap, README, and changelog without claiming Stage D is complete.

**Tech Stack:** TypeScript strict, Node.js 24, `node:sqlite`, filesystem blobs, Vitest, Next.js 16, GitHub Actions, Markdown ADRs.

**Spec:** `ROADMAP.md` Stage D and Cross-Stage Quality Gates; `PRD.md` Stage D; `SECURITY.md`; ADR 0003, ADR 0004, ADR 0012, ADR 0013; `docs/e2ee-security-review.md`; `docs/ai-security-review.md`; `docs/extensions.md`.

## Global Constraints

- Node.js must stay at `>=24.0.0` because the SQLite adapter uses `node:sqlite`.
- Do not add runtime dependencies or native modules.
- Do not commit unless Rya explicitly asks. Use checkpoints and stop after each task.
- Do not mark Stage D complete while the independent security review, independent cryptographic review, or E2EE claim gate is open.
- Do not claim that AI, extensions, or workspace encryption have been independently reviewed.
- Do not claim that hosted CI passed. The repository has no remote and no hosted run.
- SQLite startup reconciliation assumes one writer process per database and blob root. Document this assumption; do not claim multi-process safety.
- Run targeted tests after each task. Run the full non-E2E quality gates once in the closeout task.
- Do not run browser E2E unless a task changes UI, copy, or a browser security flow.
- Keep docs in English to match the existing repository. Avoid code comments.
- Keep user-facing copy unchanged. No localization work is needed for this plan.
- The optional storage adapter is explicitly deferred. Do not implement one in this plan.
- Self-hosting stays an evaluation. Do not add a server, HTTP API, authentication, or deployment code.

## Review Focus

- Startup reconciliation must never delete a blob still referenced by a file row. A partial or malformed database read must fail closed, not treat the library as empty.
- A failed cleanup must close the database handle and leave the adapter retryable. It must not stay half-open with `connection` set.
- Stale `.tmp` cleanup must respect the age threshold so a fresh write is not removed. The single-writer assumption must be documented rather than silently assumed.
- The optional storage deferral must remain explicit in the roadmap. It must not look like an adapter was shipped.
- The review dossier and handoff packet must say `Not assigned` until a real independent reviewer signs. They must not imply an internal audit is an external review.
- The self-hosting evaluation must not approve multi-user or public deployment. It may approve only further Stage E design for a single-user, single-tenant server.

---

## File Structure

**SQLite adapter:**

- `packages/storage-sqlite/src/blob-store.ts`: blob reconciliation and stale temporary-file cleanup.
- `packages/storage-sqlite/src/storage.ts`: startup wiring, option plumbing, and failed-open cleanup.
- `packages/storage-sqlite/src/index.ts`: exported reconciliation types.
- `packages/storage-sqlite/src/__tests__/blob-store.test.ts`: unit tests for the blob store.
- `packages/storage-sqlite/src/__tests__/startup-recovery.test.ts`: startup and retry tests.
- `packages/storage-sqlite/README.md`: single-writer and startup-cleanup documentation.

**Decision records:**

- `docs/adr/0014-optional-storage-adapters.md`: explicit deferral.
- `docs/adr/0015-self-hosting-boundary.md`: self-hosting boundary.
- `docs/self-hosting-evaluation.md`: evaluation evidence and open controls.

**Review evidence:**

- `docs/extension-security-review.md`: D4A release gate and checklist.
- `docs/stage-d-security-review.md`: canonical Stage D internal audit and sign-off record.
- `docs/security-review-handoff.md`: independent reviewer packet.
- `docs/extensions.md`, `docs/ai-security-review.md`, `docs/e2ee-security-review.md`, `SECURITY.md`: links and status alignment.

**CI and status:**

- `.github/workflows/ci.yml`: non-E2E quality workflow.
- `docs/development.md`: CI scope and local E2E boundary.
- `ROADMAP.md`, `README.md`, `CHANGELOG.md`: status and release notes.

---

### Task 1: Record the optional storage adapter deferral

**Files:**

- Create: `docs/adr/0014-optional-storage-adapters.md`
- Modify: `ROADMAP.md` Stage D list

**Interfaces:**

- Consumes: PRD section 8 storage requirements, ADR 0003 storage ports, ADR 0008 trust zones.
- Produces: ADR 0014, the recorded reason and revisit conditions for optional storage adapters.

- [ ] **Step 1: Write ADR 0014**

Create the ADR with this decision text:

```markdown
## Decision

OpenNest will not add another storage adapter in Stage D. Dexie and SQLite remain
the supported storage implementations. The optional storage adapter item is
deferred, not implemented.

A future adapter is reconsidered only when all of these exist:

1. A concrete provider or browser API with a supported portability story.
2. An explicit permission, consent, and revocation model.
3. Encrypted blob semantics compatible with ADR 0013.
4. Backup, restore, export, and delete-all behavior for externally stored bytes.
5. Adapter conformance tests and a security review of the new trust boundary.
```

Include Context, Alternatives considered, Consequences, and Revisit conditions. State that a Chromium-only File System Access adapter is not approved by this ADR.

- [ ] **Step 2: Update the roadmap**

Replace the unchecked optional storage line with:

```markdown
- [x] Optional storage adapters: explicitly deferred by ADR 0014.
```

- [ ] **Step 3: Verify formatting**

Run: `node scripts/prettier.mjs --check docs/adr/0014-optional-storage-adapters.md ROADMAP.md`

Expected: PASS.

- [ ] **Step 4: Checkpoint**

Review the ADR and the roadmap line. Do not commit.

---

### Task 2: Add blob reconciliation and stale temporary-file cleanup

**Files:**

- Modify: `packages/storage-sqlite/src/blob-store.ts`
- Modify: `packages/storage-sqlite/src/index.ts`
- Test: `packages/storage-sqlite/src/__tests__/blob-store.test.ts`

**Interfaces:**

- Consumes: `BlobKey`, `assertSafeBlobKey`, and the existing `FileSystemBlobStore` directory layout.
- Produces:

```ts
export interface BlobReconcileOptions {
  staleTempAgeMs?: number;
  now?: () => number;
}

export interface BlobReconcileResult {
  removedBlobs: number;
  removedMetadata: number;
  removedTemporaryFiles: number;
}

export const DEFAULT_STALE_TEMP_AGE_MS: number;

reconcile(
  knownKeys: BlobKey[],
  options?: BlobReconcileOptions
): Promise<BlobReconcileResult>
```

- [ ] **Step 1: Write the failing reconciliation test**

Add imports for `access`, `utimes`, and `writeFile` to `packages/storage-sqlite/src/__tests__/blob-store.test.ts`, plus `randomUUID` from `node:crypto`. Add this test:

```ts
it("removes orphan blobs, metadata, and stale temporary files", async () => {
  const store = await makeStore();
  const nextKey = idGenerator(120);
  const kept = nextKey() as BlobKey;
  const orphan = nextKey() as BlobKey;

  await store.put(kept, new Blob([new Uint8Array([1])], { type: "text/plain" }));
  await store.put(orphan, new Blob([new Uint8Array([2, 3])], { type: "text/plain" }));

  const directory = path.join(store.rootDir, "blobs", kept.slice(0, 2));
  const stale = path.join(directory, `.${kept}.${randomUUID()}.tmp`);
  const fresh = path.join(directory, `.${kept}.${randomUUID()}.tmp`);
  const now = Date.now();
  const old = new Date(now - 25 * 60 * 60 * 1000);

  await writeFile(stale, new Uint8Array([4]));
  await writeFile(fresh, new Uint8Array([5]));
  await utimes(stale, old, old);
  await utimes(fresh, new Date(now), new Date(now));

  const result = await store.reconcile([kept], {
    staleTempAgeMs: 24 * 60 * 60 * 1000,
    now: () => now,
  });

  expect(result).toEqual({
    removedBlobs: 1,
    removedMetadata: 1,
    removedTemporaryFiles: 1,
  });
  expect(await store.has(kept)).toBe(true);
  expect(await store.has(orphan)).toBe(false);
  await expect(access(stale)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(fresh)).resolves.toBeUndefined();
});
```

Add a second test proving a referenced blob and its metadata survive even when an unrelated file exists in the blob directory:

```ts
it("keeps referenced blobs and metadata while ignoring unrelated files", async () => {
  const store = await makeStore();
  const key = idGenerator(121)() as BlobKey;

  await store.put(key, new Blob([new Uint8Array([7])], { type: "text/plain" }));

  const directory = path.join(store.rootDir, "blobs", key.slice(0, 2));
  const unrelated = path.join(directory, "notes.txt");
  const metadata = path.join(directory, `${key}.meta.json`);
  await writeFile(unrelated, "keep");

  const result = await store.reconcile([key], { staleTempAgeMs: 0 });

  expect(result).toEqual({
    removedBlobs: 0,
    removedMetadata: 0,
    removedTemporaryFiles: 0,
  });
  expect(await store.has(key)).toBe(true);
  await expect(access(metadata)).resolves.toBeUndefined();
  await expect(access(unrelated)).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/vitest.mjs run packages/storage-sqlite/src/__tests__/blob-store.test.ts`

Expected: FAIL because `reconcile` does not exist.

- [ ] **Step 3: Implement reconciliation**

Add `DEFAULT_STALE_TEMP_AGE_MS = 24 * 60 * 60 * 1000` and the two exported interfaces. Implement `reconcile` to:

1. Build a `Set` from `knownKeys` after validating each key with `assertSafeBlobKey`.
2. Walk the same `blobs/<prefix>/` directories used by `usage()` and `purgeOrphans`.
3. Remove an unreferenced blob file and its `.meta.json` if present. Count each removal.
4. Remove a file whose name starts with `.` and ends with `.tmp` only when `now() - mtimeMs >= staleTempAgeMs`. Count the removal. Do not remove fresh temporary files.
5. Ignore files that are neither blob files, metadata files, nor internal temporary files.
6. Return the counts.

Keep `purgeOrphans` behavior and return value unchanged. It must not start deleting temporary files; startup uses `reconcile` for that.

Export `BlobReconcileOptions`, `BlobReconcileResult`, and `DEFAULT_STALE_TEMP_AGE_MS` from `packages/storage-sqlite/src/index.ts`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/vitest.mjs run packages/storage-sqlite/src/__tests__/blob-store.test.ts`

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run: `node scripts/prettier.mjs --check packages/storage-sqlite/src/blob-store.ts packages/storage-sqlite/src/index.ts packages/storage-sqlite/src/__tests__/blob-store.test.ts`

Expected: PASS. Do not commit.

---

### Task 3: Reconcile blobs when SQLite opens

**Files:**

- Modify: `packages/storage-sqlite/src/storage.ts`
- Create: `packages/storage-sqlite/src/__tests__/startup-recovery.test.ts`
- Modify: `packages/storage-sqlite/README.md`

**Interfaces:**

- Consumes: `FileSystemBlobStore.reconcile`, `DEFAULT_STALE_TEMP_AGE_MS`.
- Produces: `SqliteStorageOptions.staleTempAgeMs?: number` and startup cleanup in `init()`.

- [ ] **Step 1: Write the failing startup tests**

Create `packages/storage-sqlite/src/__tests__/startup-recovery.test.ts` with this setup:

```ts
// @vitest-environment node

import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { idGenerator, type BlobKey } from "@opennest/core";
import { afterEach, describe, expect, it } from "vitest";

import { createSqliteStorage } from "../index";

const AT = "2026-11-18T10:00:00.000Z" as never;
const open: Array<ReturnType<typeof createSqliteStorage>> = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((storage) => storage.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "opennest-sqlite-startup-"));
  roots.push(root);
  return root;
}
```

Add this first test:

```ts
it("removes orphan blobs and stale temp files when reopening", async () => {
  const root = await makeRoot();
  const databaseFile = path.join(root, "database.sqlite");
  const blobRoot = path.join(root, "blobs");
  const nextKey = idGenerator(130);
  const kept = nextKey() as BlobKey;
  const orphan = nextKey() as BlobKey;

  const first = createSqliteStorage({ databaseFile, blobRoot });
  open.push(first);
  await first.init();
  const workspace = await first.workspaces.ensureWorkspace({ at: AT });
  await first.files.create({
    workspaceId: workspace.id,
    folderId: null,
    name: "kept.txt",
    mimeType: "text/plain",
    sizeBytes: 1,
    blobKey: kept,
    checksum: null,
    at: AT,
  });
  await first.blobs.put(kept, new Uint8Array([1]));
  await first.blobs.put(orphan, new Uint8Array([2]));
  await first.close();

  const temp = path.join(
    blobRoot,
    "blobs",
    kept.slice(0, 2),
    `.${kept}.${randomUUID()}.tmp`
  );
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
  await writeFile(temp, new Uint8Array([3]));
  await utimes(temp, old, old);

  const reopened = createSqliteStorage({ databaseFile, blobRoot });
  open.push(reopened);
  await reopened.init();

  expect(await reopened.blobs.has(kept)).toBe(true);
  expect(await reopened.blobs.has(orphan)).toBe(false);
  await expect(access(temp)).rejects.toMatchObject({ code: "ENOENT" });
});
```

Add a second test:

```ts
it("removes a fresh temporary file when staleTempAgeMs is zero", async () => {
  const root = await makeRoot();
  const databaseFile = path.join(root, "database.sqlite");
  const blobRoot = path.join(root, "blobs");
  const kept = idGenerator(131)() as BlobKey;

  const first = createSqliteStorage({ databaseFile, blobRoot });
  open.push(first);
  await first.init();
  const workspace = await first.workspaces.ensureWorkspace({ at: AT });
  await first.files.create({
    workspaceId: workspace.id,
    folderId: null,
    name: "kept.txt",
    mimeType: "text/plain",
    sizeBytes: 1,
    blobKey: kept,
    checksum: null,
    at: AT,
  });
  await first.blobs.put(kept, new Uint8Array([1]));
  await first.close();

  const temp = path.join(
    blobRoot,
    "blobs",
    kept.slice(0, 2),
    `.${kept}.${randomUUID()}.tmp`
  );
  await writeFile(temp, new Uint8Array([2]));

  const reopened = createSqliteStorage({
    databaseFile,
    blobRoot,
    staleTempAgeMs: 0,
  });
  open.push(reopened);
  await reopened.init();

  expect(await reopened.blobs.has(kept)).toBe(true);
  await expect(access(temp)).rejects.toMatchObject({ code: "ENOENT" });
});
```

Add a third test for failed-open retry:

```ts
it("closes a failed open and allows a retry", async () => {
  const root = await makeRoot();
  const blobRoot = path.join(root, "blobs");
  const storage = createSqliteStorage({
    databaseFile: path.join(root, "database.sqlite"),
    blobRoot,
  });
  open.push(storage);

  await writeFile(blobRoot, "not a directory");

  await expect(storage.init()).rejects.toBeDefined();

  await rm(blobRoot, { force: true });
  await mkdir(blobRoot, { recursive: true });
  await storage.init();

  expect(storage.schemaVersion).toBeGreaterThan(0);
  await storage.close();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/vitest.mjs run packages/storage-sqlite/src/__tests__/startup-recovery.test.ts`

Expected: FAIL because startup does not reconcile blobs and the failed init leaves the adapter unusable.

- [ ] **Step 3: Wire reconciliation into `init()`**

Add `staleTempAgeMs?: number` to `SqliteStorageOptions`.

Change `init()` so that after `openDatabase` and `bootstrapSync` succeed it:

1. Selects every `files.blobKey` from the database.
2. Calls `blobs.reconcile` with those keys and `staleTempAgeMs ?? DEFAULT_STALE_TEMP_AGE_MS`.

If any step throws, close the opened SQLite connection, set `connection`, `db`, and `schemaVersion` back to their closed values, set `closed = true`, and throw the mapped error. A later `init()` must be able to retry.

Change `reset()` to clear all blobs and temporary files with `blobs.reconcile([], { staleTempAgeMs: 0 })` instead of `blobs.purgeOrphans([])`. Keep restore on `purgeOrphans`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node scripts/vitest.mjs run packages/storage-sqlite`

Expected: PASS, including the shared conformance suite.

- [ ] **Step 5: Document the operational boundary**

In `packages/storage-sqlite/README.md`, add a short `Startup cleanup` section stating:

- `init()` removes blobs that no file row references.
- `init()` removes temporary files older than 24 hours by default.
- This assumes one writer process per database and blob root.
- Multi-process self-hosting must define its own locking strategy before deployment.

- [ ] **Step 6: Checkpoint**

Run: `node scripts/prettier.mjs --check packages/storage-sqlite/src/storage.ts packages/storage-sqlite/src/__tests__/startup-recovery.test.ts packages/storage-sqlite/README.md`

Expected: PASS. Do not commit.

---

### Task 4: Complete the self-hosting evaluation and boundary ADR

**Files:**

- Create: `docs/self-hosting-evaluation.md`
- Create: `docs/adr/0015-self-hosting-boundary.md`
- Modify: `ROADMAP.md` Stage D list

**Interfaces:**

- Consumes: PRD sections 8 and 9, ADR 0003, ADR 0004, ADR 0008, ADR 0012, ADR 0013.
- Produces: a recorded Stage D self-hosting decision and the Stage E boundary.

- [ ] **Step 1: Write the evaluation**

Create `docs/self-hosting-evaluation.md` with these sections:

- Requirements: local-first default, optional server, SQLite adapter, backup/restore, E2EE, no mandatory account.
- Deployment models: current static PWA, single-user Node server with SQLite, container or reverse proxy, public multi-user service.
- Composition root: separate HTTP layer and SQLite adapter; no browser Dexie, no service worker, no server API in Stage D.
- Required controls before implementation: authentication, authorization, tenant isolation, TLS, CSRF, request and upload limits, secure cookies, CSP, audit, safe file serving, path traversal prevention, no execution of uploaded files.
- Data lifecycle: backup, restore, migration, delete-all, keyring handling, encrypted blob storage, metadata leakage.
- Operations: Node 24, SQLite WAL and locking, filesystem permissions, backup retention, upgrade and rollback, observability, rate limits.
- Multi-process risk: startup reconciliation assumes one writer; a server needs a documented locking and deployment model.
- Decision and open gates.

Use this decision statement verbatim:

```markdown
A single-user, single-tenant self-hosted server is a candidate for Stage E. A
public multi-user deployment is not approved. Stage D implements no server.
```

- [ ] **Step 2: Write ADR 0015**

Create `docs/adr/0015-self-hosting-boundary.md` with status `Accepted`. Record:

```markdown
## Decision

The Stage D self-hosting evaluation is complete. Stage E may design a
single-user, single-tenant Node server using the SQLite adapter and a filesystem
blob root.

This ADR does not approve multi-user access, collaboration, federation, public
exposure, or a hosted service. Those require a separate authentication and tenant
ADR, a multi-user threat model, and a collaboration security review.

Stage D adds no server code.
```

Include consequences: no HTTP API, no auth implementation, no deployment
pipeline, no multi-process claim, and no self-hosting support claim.

- [ ] **Step 3: Update the roadmap**

Replace the unchecked self-hosting line with:

```markdown
- [x] Self-hosting architecture evaluation: ADR 0015.
```

- [ ] **Step 4: Verify formatting**

Run: `node scripts/prettier.mjs --check docs/self-hosting-evaluation.md docs/adr/0015-self-hosting-boundary.md ROADMAP.md`

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Review the decision language. It must not approve a server implementation. Do not commit.

---

### Task 5: Create the extension security review gate

**Files:**

- Create: `docs/extension-security-review.md`
- Modify: `docs/extensions.md`

**Interfaces:**

- Consumes: ADR 0010, `docs/extensions.md`, extension E2E evidence.
- Produces: D4A review scope, checklist, residual risks, and a `Not assigned` review record.

- [ ] **Step 1: Write the review document**

Create `docs/extension-security-review.md` using the structure of `docs/ai-security-review.md`:

```markdown
# Extension security review

Status: implementation complete; internal Stage D audit pending; independent
review not started. This document is a release gate and checklist, not a report.
OpenNest makes no claim that the extension sandbox has been independently
reviewed.
```

Include:

- Scope: manifest parsing, integrity, install and update consent, opaque-origin iframe, blob worker, host API, capability grant, storage isolation, lifecycle, safe mode, audit, backup exclusion, PWA cache.
- Out of scope: registry, signatures, auto-update, network access, workspace writes, credentials, AI tools, multi-user extensions.
- Threat model: malicious package, compromised update, sandbox escape, message spoofing, capability confusion, storage quota abuse, timing and size side channels, host-origin compromise.
- Required controls: the existing controls from `docs/extensions.md`, stated as review assertions.
- Checklist sections: Design, Implementation, Isolation, Capabilities and grants, Storage and lifecycle, Product and operations, Evidence.
- Residual risks: browser sandbox bugs, compromised host origin, unsigned sideload packages, side channels, user trust decision.
- Required artifacts: ADR 0010, extension docs, implementation plan, changed-file list, test evidence, build and E2E instructions, known limitations.
- Claim criteria: independent sign-off, no critical or high finding open, and accurate documentation before any sandbox security claim.
- Finding handling: Critical, High, Medium, Low, matching the E2EE review.
- Review record table with `Reviewer: Not assigned`, `Review date: Not started`, `Commit reviewed: Not started`, `Result: Not started`.

- [ ] **Step 2: Link it from the extension docs**

In `docs/extensions.md`, replace the sentence `Independent security review has not been completed.` with a link to `docs/extension-security-review.md` and the same status. Keep the out-of-scope `Independent security review` bullet, but append `See docs/extension-security-review.md for the gate.`

- [ ] **Step 3: Verify formatting**

Run: `node scripts/prettier.mjs --check docs/extension-security-review.md docs/extensions.md`

Expected: PASS.

- [ ] **Step 4: Checkpoint**

Confirm the review record still says `Not assigned`. Do not commit.

---

### Task 6: Build the Stage D security dossier and run the internal audit

**Files:**

- Create: `docs/stage-d-security-review.md`
- Modify: `docs/ai-security-review.md`
- Modify: `docs/e2ee-security-review.md`
- Modify: `docs/extensions.md`
- Modify: `SECURITY.md`

**Interfaces:**

- Consumes: every domain checklist, existing test evidence, the new extension review gate.
- Produces: the canonical Stage D internal audit record, findings log, and claim status.

- [ ] **Step 1: Write the dossier**

Create `docs/stage-d-security-review.md` with status:

```markdown
Status: internal audit in progress; independent review not started. This is not
a security report and it does not close the Stage D gate.
```

Include:

- Scope: Privacy Center, data management, backup and restore, SQLite recovery, D4A, D4B, D3, PWA, CSP, file serving, dependency supply chain, self-hosting boundary.
- Out of scope: sync, collaboration, MCP, external storage adapters, compromised device or browser, metadata confidentiality, reliable memory zeroization.
- Evidence table columns: Area, Evidence, Command, Result, Date.
- Findings table columns: ID, Severity, Area, Summary, Owner, Status, Test or commit.
- Domain review links to `docs/extension-security-review.md`, `docs/ai-security-review.md`, and `docs/e2ee-security-review.md`.
- External sign-off table with `Reviewer`, `Date`, `Commit`, `Result`, all `Not assigned` or `Not started`.
- Claim status: no E2EE claim, no AI confidentiality claim, no extension sandbox security claim.
- Gate conditions: external reviewers sign, critical and high findings are fixed, and claims match the implementation.

- [ ] **Step 2: Run the dependency audit**

Run: `npm audit --audit-level=high`

Record the exact result in the evidence table. If an actionable high or critical advisory exists, create a finding and fix it with a regression test before continuing. Do not suppress the audit to make the plan look green.

- [ ] **Step 3: Search for unsafe rendering and execution sinks**

Run:

```bash
git grep -n -E "dangerouslySetInnerHTML|innerHTML|outerHTML|document\\.write|eval\\(|new Function" -- apps packages
```

Record every production hit and classify it. Test-only hits stay in the finding notes.

- [ ] **Step 4: Run targeted security tests**

Run:

```bash
node scripts/vitest.mjs run apps/web/lib/extensions apps/web/lib/ai apps/web/lib/credentials apps/web/lib/crypto apps/web/lib/privacy packages/storage-sqlite
```

Record the test count and result. If the command fails, stop and fix the failure before continuing. Do not run the full E2E suite in this task.

- [ ] **Step 5: Record findings and fix high-risk issues**

For each finding, add a row to the findings table. If a finding needs production code changes, append a new numbered task to this plan with exact files and tests before changing code. Critical and high findings must be fixed with regression tests. Medium and low findings may be accepted with an owner and reason.

- [ ] **Step 6: Align the domain docs**

Add a link to the Stage D dossier in `docs/ai-security-review.md`, `docs/e2ee-security-review.md`, and `docs/extensions.md`. Add a link from `SECURITY.md` under the relevant status section.

Do not change `Not assigned` to a reviewer name. Do not change the no-claim language.

- [ ] **Step 7: Verify formatting**

Run: `node scripts/prettier.mjs --check docs/stage-d-security-review.md docs/ai-security-review.md docs/e2ee-security-review.md docs/extensions.md SECURITY.md`

Expected: PASS.

- [ ] **Step 8: Checkpoint**

Confirm the dossier says internal audit, not external review, and the E2EE claim gate is still closed. Do not commit.

---

### Task 7: Prepare the independent reviewer handoff

**Files:**

- Create: `docs/security-review-handoff.md`
- Modify: `docs/stage-d-security-review.md`

**Interfaces:**

- Consumes: Stage D dossier, extension, AI, and E2EE review gates.
- Produces: a self-contained packet an independent reviewer can start from.

- [ ] **Step 1: Write the handoff packet**

Create `docs/security-review-handoff.md` with status `Packet prepared; reviewer not assigned.` Include:

- Review streams: D4A extension sandbox, D4B AI and credential vault, D3 cryptographic and implementation review, unified Stage D review.
- Required artifacts: ADRs, threat models, review checklists, this plan, changed-file list, test evidence, build instructions, E2E instructions, known risks, and claim language.
- Commands reviewers can run: `npm ci`, `npm run build`, `npm test`, `npm run test:e2e:extensions`, `npm run test:e2e:ai`, `npm run test:e2e:encryption`.
- Scope exclusions: sync, collaboration, MCP, external storage, compromised device, metadata confidentiality, reliable memory zeroization.
- Logistics: private channel, synthetic test data only, do not send real passphrases, recovery keys, credentials, notes, or files.
- Finding handling and severity definitions.
- Sign-off table with `Reviewer`, `Organization`, `Date`, `Commit`, `Result`, all `Not assigned` or `Not started`.

- [ ] **Step 2: Link the packet from the dossier**

Add a `Reviewer handoff` section in `docs/stage-d-security-review.md` linking `docs/security-review-handoff.md`.

- [ ] **Step 3: Verify formatting**

Run: `node scripts/prettier.mjs --check docs/security-review-handoff.md docs/stage-d-security-review.md`

Expected: PASS.

- [ ] **Step 4: Checkpoint**

Confirm no reviewer is invented and no sign-off is implied. Do not commit.

---

### Task 8: Add the minimal CI workflow

**Files:**

- Create: `.github/workflows/ci.yml`
- Modify: `docs/development.md`
- Modify: `ROADMAP.md` Cross-Stage Quality Gates

**Interfaces:**

- Consumes: existing npm scripts and Node 24 requirement.
- Produces: a GitHub Actions workflow for lint, formatting, typecheck, tests, and build.

- [ ] **Step 1: Create the workflow**

Create the `.github/workflows/` directory if it does not exist, then create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  quality:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    env:
      NEXT_TELEMETRY_DISABLED: "1"
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run format:check
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

Do not add Playwright or browser E2E to this workflow.

- [ ] **Step 2: Document the CI boundary**

Add a `CI` section to `docs/development.md` stating:

- The workflow is `.github/workflows/ci.yml`.
- It runs lint, formatting, typecheck, Vitest, the browser graph check, and the production build.
- Browser E2E stays local because it requires system Playwright and Chromium.
- The repository has no remote yet, so the first hosted run is pending.

- [ ] **Step 3: Update the roadmap quality gate**

Update the CI bullet to:

```markdown
- [ ] CI workflow covering the repository quality gates. The workflow is defined
      at `.github/workflows/ci.yml`; the first hosted run is pending because the
      repository has no remote.
```

Keep it unchecked.

- [ ] **Step 4: Validate formatting**

Run: `node scripts/prettier.mjs --check .github/workflows/ci.yml docs/development.md ROADMAP.md`

Expected: PASS. Prettier parses the YAML.

- [ ] **Step 5: Checkpoint**

Do not claim hosted CI passed. Do not commit.

---

### Task 9: Close out internal Stage D work and run the final gates

**Files:**

- Modify: `ROADMAP.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `SECURITY.md` only if a link is still missing

**Interfaces:**

- Consumes: all previous tasks.
- Produces: accurate status, changelog, and one final verification record.

- [ ] **Step 1: Update the roadmap statuses**

Set:

```markdown
- [x] Optional storage adapters: explicitly deferred by ADR 0014.
- [x] Self-hosting architecture evaluation: ADR 0015.
- [x] SQLite interrupted-restore orphan blob and stale `.tmp` cleanup.
- [ ] Security review. Internal Stage D dossier complete; independent review not
      started.
- [ ] External cryptographic review and E2EE claim gate (D3 implementation
      complete; independent review not started, so no E2EE claim).
- [ ] CI workflow defined; first hosted run pending because the repository has no
      remote.
```

Keep the Stage D status as `in progress`.

- [ ] **Step 2: Update the README status**

Change the status paragraph to:

```markdown
Status: Stage C delivered. Stage D internal work is complete; independent security
and cryptographic review, the E2EE claim gate, and the first hosted CI run remain
open. Independent review is still pending, so no E2EE, AI confidentiality, or
extension sandbox security claim is made.
```

Keep the existing feature descriptions accurate. Do not add a CI badge.

- [ ] **Step 3: Update the changelog**

Add under `Unreleased`:

- Added SQLite startup reconciliation for orphan blobs and stale temporary files.
- Recorded optional storage adapter deferral in ADR 0014.
- Added the self-hosting boundary evaluation and ADR 0015.
- Added the Stage D security dossier, extension review gate, and reviewer handoff packet.
- Added a CI workflow for non-browser quality gates.

Add a Security note that the external reviews and E2EE claim gate remain open.

- [ ] **Step 4: Run the full non-E2E gates once**

Run each command and record the result:

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```

Expected: all pass. If any command fails, fix the failure, rerun that command, then rerun the full sequence from `npm run lint` through `npm run build` once. Do not run browser E2E because this plan does not change UI or browser security flows.

- [ ] **Step 5: Report the remaining gates**

Write a short closeout report to Rya with:

- Files changed.
- Test counts and build result.
- Which roadmap items are now complete or explicitly deferred.
- The external review, E2EE claim, and hosted CI gates still open.
- The single-writer limitation for SQLite cleanup.
- The fact that CI is defined but has never run on a hosted remote.

- [ ] **Step 6: Checkpoint**

Do not commit unless Rya asks.

---

## External Gates

These are real release gates and are not executable by this plan:

- Independent D4A extension security review.
- Independent D4B AI and credential-vault security review.
- Independent cryptographic and implementation review of D3.
- E2EE claim decision after review, with sync excluded until R-13-7 is resolved.
- First hosted CI run after the repository has a remote.
- Stage E self-hosted server implementation, gated by ADR 0015 and a separate auth and tenant ADR.

## Completion Definition

This plan is complete when the internal tasks above are finished, targeted tests pass, the final non-E2E gates pass, and the documentation accurately records the open external gates. It does not complete Stage D by itself.
