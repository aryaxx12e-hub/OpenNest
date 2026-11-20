# Stage E: AI, Sync, and Collaboration Implementation Plan

> **For the implementing agent:** Execute this plan task by task. Use the
> `executing-plans` and `test-driven-development` skills. Do not start server code
> before Task 1 is complete. Implemented behavior must be tested, not assumed.

**Goal:** Add optional self-hosted collaboration, multi-device sync, AI document
Q&A, AI-powered extension capability, and a read-only MCP server without breaking
the local-first, accountless default.

**Architecture:** Keep one data model. Build a separate Node 24 server package
that composes existing core, validation, storage, and backup packages. Use SQLite
for the workspace and a separate `auth.sqlite` for identity and membership. Use
HTTP for sync and files, Yjs over WebSocket for live notes, local retrieval for AI
Q&A, and a read-only MCP adapter.

**Tech stack:** TypeScript strict, Node 24, SQLite, Dexie, React, Yjs,
`y-protocols`, `ws`, Vitest, Playwright or browser checks where available.

**Spec:** `docs/superpowers/specs/2026-11-18-stage-e-ai-sync-collaboration-design.md`

---

## Global Constraints

- Node.js `>=24.0.0`.
- TypeScript strict mode. No `any`. No unnecessary type assertions.
- Browser code must not import `node:*` or server-only modules.
- One workspace per deployment. The first owner is created by a local CLI command.
- Self-hosted first. Cloud is deferred.
- Shared workspaces are invite-only. Roles are `owner`, `editor`, `viewer`.
- No E2EE claim for shared workspaces. No group keys or shared-content E2EE.
- Local-only mode stays accountless. Local notes and files must remain usable
  offline without a server.
- All user-facing text must be localized in English and Indonesian.
- Use existing ports and validation. Do not bypass repositories.
- Do not execute uploaded files.
- Validate MIME types and sizes. Preserve original filenames in metadata.
- One writer process per SQLite database and blob root.
- No code comments unless they explain a non-obvious constraint.
- Do not commit unless Rya explicitly asks. If asked, use small commits and the
  repository commit style.
- Do not claim AI confidentiality, extension isolation, E2EE, or hosted CI is
  complete while the Stage D gates are open.

### Plan-Level Constants

- `scrypt`: `N=32768`, `r=8`, `p=1`, 16-byte salt, 32-byte hash.
- Session lifetime: 30 days. Invite lifetime: 7 days, single use.
- Cookie: `HttpOnly`, `Secure`, `SameSite=Lax`.
- CSRF required on state-changing requests.
- File limit: 25 MiB.
- Outbox: 1,000 rows and 30 days.
- AI request: 256 KiB. AI response: 2 MiB. Consent lifetime: 5 minutes.
- WebSocket update: 256 KiB. 200 updates per minute.
- SQLite WAL, `foreign_keys=ON`, `busy_timeout=5000`.
- MCP output: 64 KiB per call.
- Collaboration snapshot: every 2 seconds while dirty, and on last disconnect.
- AI consent scope: `D2` document content only. `D3` is forbidden.

---

## Phase 0: Decisions and Gates

### Task 1: Write the Stage E architecture decisions and gate register

**Files:**

- Create: `docs/adr/0016-server-auth-and-tenant.md`
- Create: `docs/adr/0017-sync-protocol.md`
- Create: `docs/adr/0018-real-time-collaboration.md`
- Create: `docs/adr/0019-ai-document-qa-and-egress.md`
- Create: `docs/adr/0020-mcp-server.md`
- Create: `docs/stage-e-gate-register.md`
- Modify: `docs/superpowers/specs/2026-11-18-stage-e-ai-sync-collaboration-design.md`
- Modify: `ROADMAP.md`
- Test: documentation review and `npm run format:check`

**Step 1: Write ADR 0016**

Record: self-hosted first, one workspace per deployment, invite-only membership,
owner/editor/viewer roles, separate `auth.sqlite`, local accountless mode remains.
State that object IDs are not capabilities and that viewer writes are denied at
HTTP, sync, and WebSocket layers.

**Step 2: Write ADR 0017**

Record: server canonical authority, idempotent push by `opId`, pull cursor from
canonical revision, preservation of content conflicts, offline retry, and the
exclusion of sync sidecars and device identity from backup.

**Step 3: Write ADR 0018**

Record: Yjs per note, WebSocket authentication and role checks, viewer read-only,
dirty snapshot cadence, presence not persisted, and the outbox bypass in
`CollaborationStore.writeSnapshot`. State that real-time editing requires a
connection and that offline collaboration creates a conflict copy.

**Step 4: Write ADR 0019**

Record: local retrieval, no persistent plaintext index, Markdown and text-readable
files only, per-request consent, `D2` scope, passage IDs, and citation validation.
State that unsupported answers are marked unsupported.

**Step 5: Write ADR 0020**

Record: OpenNest as a read-only MCP server, workspace-scoped hashed bearer tokens,
read-only tool list, 64 KiB output limit, disabled by default, and separate
security review before release.

**Step 6: Write the gate register**

List Stage D gates, collaboration security review, AI egress review, MCP security
review, external cryptography review, E2EE claim gate, hosted CI, and cloud
deferral. Mark every gate closed only with evidence.

**Step 7: Update the spec and ROADMAP**

Point the spec to the ADRs. Add Stage E checkboxes to ROADMAP without marking them
complete. Do not mark Stage D complete.

**Step 8: Run**

```bash
npm run format:check
```

Expected: pass. If formatting fails, run `npm run format` and re-check.

---

## Phase 1: Server Foundation and Authentication

### Task 2: Add the server package, HTTP host, and lifecycle

**Files:**

- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/src/index.ts`
- Create: `apps/server/src/config.ts`
- Create: `apps/server/src/http/router.ts`
- Create: `apps/server/src/http/auth.ts`
- Create: `apps/server/src/errors.ts`
- Create: `apps/server/src/lifecycle.ts`
- Create: `apps/server/src/health.ts`
- Modify: `package.json`
- Modify: `packages/config/src/index.ts`
- Modify: `tsconfig.json`
- Test: `apps/server/src/__tests__/config.test.ts`

**Step 1: Write failing tests first**

Cover:

- Required environment variables and defaults.
- Rejection of missing `OPENNEST_DATA_DIR`.
- Safe `PORT`, `HOST`, and public URL parsing.
- No secret values in error messages.
- Graceful startup and shutdown order.

**Step 2: Implement the package**

Use Node 24. ESM. Export a `startServer(config)` function. Bind only to configured
interfaces. Add `SIGINT` and `SIGTERM` handlers. Close HTTP, WebSocket, and SQLite
in that order.

**Step 3: Add routes**

Only add `GET /health/live` and `GET /health/ready`. Ready checks the workspace DB
and `auth.sqlite`. Do not add unauthenticated workspace routes.

**Step 4: Add package scripts**

Add `dev`, `start`, `typecheck`, and `test` to `apps/server/package.json`. Wire
workspace scripts only after tests pass.

**Step 5: Run**

```bash
npm run typecheck
npm test -- apps/server
```

Expected: pass.

### Task 3: Add auth storage, password hashing, sessions, and invites

**Files:**

- Create: `apps/server/src/auth/auth-db.ts`
- Create: `apps/server/src/auth/password.ts`
- Create: `apps/server/src/auth/session.ts`
- Create: `apps/server/src/auth/membership.ts`
- Create: `apps/server/src/auth/invite.ts`
- Create: `apps/server/src/auth/schema.sql`
- Create: `apps/server/src/cli/bootstrap-owner.ts`
- Test: `apps/server/src/auth/__tests__/password.test.ts`
- Test: `apps/server/src/auth/__tests__/session.test.ts`
- Test: `apps/server/src/auth/__tests__/membership.test.ts`

**Step 1: Write failing tests first**

Cover:

- Salt and hash are 16 and 32 bytes.
- Correct password verifies; wrong password fails.
- Session token is 32 random bytes and only its SHA-256 hash is stored.
- Expired, revoked, and unknown sessions fail.
- Viewer cannot be promoted by a non-owner.
- Invite is single-use and expires after 7 days.
- Revoking a member revokes active sessions.
- Passwords and tokens never appear in logs or error strings.

**Step 2: Implement `auth.sqlite`**

Enable WAL, foreign keys, and `busy_timeout=5000`. Create tables for users,
sessions, invites, and membership. Use transactions for invite acceptance and
member revocation.

**Step 3: Implement the CLI**

`bootstrap-owner` reads the password from stdin, not argv. It creates the first
owner only when no owner exists. It prints the created email and no password.

**Step 4: Run**

```bash
npm test -- apps/server/src/auth
npm run typecheck
```

Expected: pass.

### Task 4: Add login, logout, session cookies, CSRF, and rate limiting

**Files:**

- Create: `apps/server/src/http/cookies.ts`
- Create: `apps/server/src/http/csrf.ts`
- Create: `apps/server/src/http/rate-limit.ts`
- Create: `apps/server/src/routes/auth.ts`
- Modify: `apps/server/src/http/router.ts`
- Test: `apps/server/src/http/__tests__/auth-routes.test.ts`
- Test: `apps/server/src/http/__tests__/csrf.test.ts`

**Step 1: Write failing tests first**

Cover:

- Login sets `HttpOnly`, `Secure`, `SameSite=Lax` cookie.
- Wrong credentials return a generic failure.
- Logout clears the cookie and revokes the session.
- State-changing requests without CSRF fail.
- Rate limiting blocks repeated login attempts.
- Responses do not reveal whether an email exists.

**Step 2: Implement**

Use a double-submit CSRF token bound to the session. Store rate-limit counters in
memory initially, with a documented single-process limitation. Add cleanup.

**Step 3: Run**

```bash
npm test -- apps/server/src/http
npm run typecheck
```

Expected: pass.

### Task 5: Add bootstrap state, invite acceptance, member management, and audit

**Files:**

- Create: `apps/server/src/routes/membership.ts`
- Create: `apps/server/src/audit/audit-log.ts`
- Create: `apps/server/src/audit/schema.sql`
- Create: `apps/server/src/routes/bootstrap.ts`
- Test: `apps/server/src/routes/__tests__/membership.test.ts`
- Test: `apps/server/src/audit/__tests__/audit-log.test.ts`

**Step 1: Write failing tests first**

Cover:

- Bootstrap state is public only until the first owner exists.
- Only owners can invite, change roles, or revoke.
- An owner cannot revoke the last owner.
- Invite acceptance creates exactly one member.
- Audit records metadata only: actor, action, target, result, timestamp.
- Audit records never contain note text, file bytes, passwords, tokens, or AI
  content.

**Step 2: Implement**

Add routes for bootstrap status, invite acceptance, member list, role update, and
revocation. Add audit writes in the same transaction as the membership change
where possible.

**Step 3: Run**

```bash
npm test -- apps/server/src/routes apps/server/src/audit
npm run typecheck
```

Expected: pass.

---

## Phase 2: Sync and Files

### Task 6: Define and test the sync protocol

**Files:**

- Create: `packages/sync-protocol/package.json`
- Create: `packages/sync-protocol/tsconfig.json`
- Create: `packages/sync-protocol/src/index.ts`
- Create: `packages/sync-protocol/src/schemas.ts`
- Create: `packages/sync-protocol/src/types.ts`
- Test: `packages/sync-protocol/src/__tests__/schemas.test.ts`
- Modify: `tsconfig.json`

**Step 1: Write failing tests first**

Cover:

- Valid push and pull requests.
- Rejection of unknown operation types.
- Rejection of oversized payloads.
- Rejection of malformed revisions, cursors, and timestamps.
- Deterministic serialization of `opId` inputs.
- No unsafe `any`.

**Step 2: Implement**

Define push request, push response, pull request, pull response, applied operation,
conflict, and cursor types. Use existing validation conventions. Do not import
browser or Node-only modules.

**Step 3: Run**

```bash
npm test -- packages/sync-protocol
npm run typecheck
```

Expected: pass.

### Task 7: Add server sync authority

**Files:**

- Create: `apps/server/src/sync/sync-service.ts`
- Create: `apps/server/src/sync/sync-store.ts`
- Create: `apps/server/src/routes/sync.ts`
- Create: `apps/server/src/sync/schema.sql`
- Modify: `apps/server/src/http/router.ts`
- Test: `apps/server/src/sync/__tests__/sync-service.test.ts`
- Test: `apps/server/src/sync/__tests__/sync-routes.test.ts`

**Step 1: Write failing tests first**

Cover:

- Push is idempotent by `opId`.
- Replaying an operation returns the original result.
- Canonical revisions advance once per applied operation.
- Pull returns operations after the cursor only.
- Viewer push is rejected.
- Cross-workspace access is rejected.
- Content conflicts preserve both values.
- Tombstones are not resurrected.

**Step 2: Implement**

Use server-only tables for applied operations and canonical revisions. Reuse core
revision rules. Run each push batch in a transaction. Enforce membership before
reading or writing workspace data.

**Step 3: Run**

```bash
npm test -- apps/server/src/sync
npm run typecheck
```

Expected: pass.

### Task 8: Add client sync engine and conflict UI

**Files:**

- Create: `apps/web/lib/sync/client.ts`
- Create: `apps/web/lib/sync/backoff.ts`
- Create: `apps/web/lib/sync/request.ts`
- Create: `apps/web/components/sync-status.tsx`
- Create: `apps/web/components/conflict-dialog.tsx`
- Test: `apps/web/lib/sync/__tests__/client.test.ts`
- Test: `apps/web/lib/sync/__tests__/backoff.test.ts`
- Test: `apps/web/components/__tests__/conflict-dialog.test.tsx`

**Step 1: Write failing tests first**

Cover:

- Offline push queues and retries.
- Retry uses bounded backoff.
- A terminal 4xx stops retrying and surfaces an error.
- Conflicts open a dialog that preserves both values.
- Choosing a value resolves the conflict through the repository.
- Sync status has connecting, online, offline, syncing, and error states.
- Local-only mode never starts the sync engine.

**Step 2: Implement**

Add a client that consumes existing outbox records and the sync protocol. Keep
business logic out of components. Localize all visible strings.

**Step 3: Run**

```bash
npm test -- apps/web/lib/sync apps/web/components/__tests__/conflict-dialog.test.tsx
npm run typecheck
```

Expected: pass.

### Task 9: Add server file versions and conflict copies

**Files:**

- Create: `apps/server/src/files/file-store.ts`
- Create: `apps/server/src/files/file-service.ts`
- Create: `apps/server/src/routes/files.ts`
- Create: `apps/server/src/files/schema.sql`
- Test: `apps/server/src/files/__tests__/file-service.test.ts`
- Test: `apps/server/src/files/__tests__/file-routes.test.ts`

**Step 1: Write failing tests first**

Cover:

- Upload creates an immutable version.
- Concurrent uploads from the same base create a conflict copy.
- 25 MiB limit is enforced.
- MIME type is validated and preserved.
- Original filename is metadata, not a path.
- Download sets safe headers.
- Path traversal is rejected.
- Viewer upload is rejected.
- Cross-workspace file access is rejected.

**Step 2: Implement**

Store blobs under a generated workspace path. Never derive paths from user input.
Use transactions for metadata and a temp file plus rename for blobs. Add cleanup
for abandoned temp files at startup.

**Step 3: Run**

```bash
npm test -- apps/server/src/files
npm run typecheck
```

Expected: pass.

---

## Phase 3: Real-Time Collaboration

### Task 10: Add the collaboration package and server rooms

**Files:**

- Create: `packages/collaboration/package.json`
- Create: `packages/collaboration/tsconfig.json`
- Create: `packages/collaboration/src/index.ts`
- Create: `packages/collaboration/src/document.ts`
- Create: `packages/collaboration/src/awareness.ts`
- Create: `apps/server/src/collaboration/room.ts`
- Create: `apps/server/src/collaboration/server.ts`
- Create: `apps/server/src/collaboration/auth.ts`
- Add: `packages/core/src/ports/collaboration-store.ts`
- Add: `packages/storage-dexie/src/collaboration-store.ts`
- Add: `packages/storage-sqlite/src/collaboration-store.ts`
- Test: `packages/collaboration/src/__tests__/document.test.ts`
- Test: `apps/server/src/collaboration/__tests__/room.test.ts`

**Step 1: Write failing tests first**

Cover:

- Yjs document encodes and applies updates.
- Two documents converge after exchanging updates.
- Awareness state is not persisted.
- Viewer joins read-only and cannot apply updates.
- Unauthenticated handshake is rejected.
- Cross-workspace room access is rejected.
- Oversized updates and rate limits are enforced.
- Snapshot writes update note content and sync metadata without an outbox row.
- Snapshot is written on dirty interval and on last disconnect.

**Step 2: Implement the port**

Add `CollaborationStore` with `loadSnapshot(noteId)` and
`writeSnapshot(noteId, state, metadata)`. The SQLite implementation must update
note content and sync metadata in one transaction and must not append an outbox
row.

**Step 3: Implement the room**

Use one room per note. Authenticate the WebSocket handshake with the session
cookie and CSRF-safe origin checks. Authorize before joining. Track dirty state.
Limit update size and rate. Close cleanly on shutdown.

**Step 4: Run**

```bash
npm test -- packages/collaboration apps/server/src/collaboration
npm run typecheck
```

Expected: pass.

### Task 11: Add the browser provider, live editor, and presence

**Files:**

- Create: `apps/web/lib/collaboration/provider.ts`
- Create: `apps/web/lib/collaboration/use-collaboration.ts`
- Create: `apps/web/components/collaboration/presence.tsx`
- Create: `apps/web/components/collaboration/live-badge.tsx`
- Modify: `apps/web/app/workspace/notes/[id]/note-editor.tsx`
- Modify: `apps/web/components/editor/markdown-editor.tsx`
- Test: `apps/web/lib/collaboration/__tests__/provider.test.ts`
- Test: `apps/web/components/collaboration/__tests__/presence.test.tsx`

**Step 1: Write failing tests first**

Cover:

- Provider connects only when the note is open and the workspace is shared.
- Reconnect backoff is bounded.
- Local-only mode never connects.
- Viewer sees read-only state.
- Presence renders members and removes disconnected members.
- Disconnect does not lose local text.
- All copy is localized.

**Step 2: Implement**

Use Yjs with the existing Markdown editor. Keep the local repository as the
offline source of truth. On reconnect, prefer editor text and let sync resolve the
conflict. Do not add a second note store.

**Step 3: Run**

```bash
npm test -- apps/web/lib/collaboration apps/web/components/collaboration
npm run typecheck
```

Expected: pass.

---

## Phase 4: AI and MCP

### Task 12: Add local retrieval and citations

**Files:**

- Create: `apps/web/lib/ai/retrieval/chunk.ts`
- Create: `apps/web/lib/ai/retrieval/retrieve.ts`
- Create: `apps/web/lib/ai/retrieval/citations.ts`
- Create: `apps/web/lib/ai/retrieval/types.ts`
- Test: `apps/web/lib/ai/retrieval/__tests__/chunk.test.ts`
- Test: `apps/web/lib/ai/retrieval/__tests__/retrieve.test.ts`
- Test: `apps/web/lib/ai/retrieval/__tests__/citations.test.ts`

**Step 1: Write failing tests first**

Cover:

- Notes and text-readable files are chunked with stable passage IDs.
- PDFs and binaries are excluded.
- Retrieval uses existing FTS candidates and does not build a persistent index.
- Passage IDs are stable for the same content and range.
- Citations map to the supplied passages only.
- Unknown citations are removed.
- No valid citation marks the answer unsupported.
- Citation text is escaped.

**Step 2: Implement**

Keep all retrieval in memory for the request. Bound chunk count and total bytes.
Do not persist plaintext embeddings or passage text.

**Step 3: Run**

```bash
npm test -- apps/web/lib/ai/retrieval
npm run typecheck
```

Expected: pass.

### Task 13: Add document Q&A with per-request consent

**Files:**

- Create: `apps/web/lib/ai/qa.ts`
- Create: `apps/web/components/ai/qa-panel.tsx`
- Create: `apps/web/components/ai/consent-dialog.tsx`
- Create: `apps/web/components/ai/citation-list.tsx`
- Modify: `apps/web/lib/ai/provider.ts`
- Modify: `apps/web/lib/ai/runtime.ts`
- Test: `apps/web/lib/ai/__tests__/qa.test.ts`
- Test: `apps/web/components/ai/__tests__/qa-panel.test.tsx`

**Step 1: Write failing tests first**

Cover:

- Consent is required before any remote call.
- Consent is bound to the exact payload selected for that request.
- Consent expires after 5 minutes.
- `D2` is the data class for selected document content. `D3` is forbidden.
- Request is rejected above 256 KiB.
- Response is rejected above 2 MiB.
- Cancellation aborts the request.
- Unsupported answers show the unsupported state.
- Citations link to the source note or text file.
- AI stays off when the feature flag is off or no provider is configured.

**Step 2: Implement**

Build the prompt from numbered passages. Send only selected passages. Validate the
response before rendering. Keep provider credentials in the existing vault.

**Step 3: Run**

```bash
npm test -- apps/web/lib/ai apps/web/components/ai
npm run typecheck
```

Expected: pass.

### Task 14: Add the host-mediated AI extension capability

**Files:**

- Create: `apps/web/lib/extensions/ai-capability.ts`
- Modify: `apps/web/lib/extensions/host.ts`
- Modify: `apps/web/lib/extensions/protocol.ts`
- Modify: `apps/web/lib/extensions/runtime.ts`
- Test: `apps/web/lib/extensions/__tests__/ai-capability.test.ts`

**Step 1: Write failing tests first**

Cover:

- Extensions cannot access credentials or provider handles.
- AI calls require host consent.
- Unknown extension calls are rejected.
- Request and response limits are enforced.
- Audit records metadata only.
- AI capability is off by default.
- Disabled AI does not leak provider errors to the extension.

**Step 2: Implement**

Expose only `ai.generate` through the host. Enforce consent in the host, not the
extension. Reuse the existing sandbox and message limits.

**Step 3: Run**

```bash
npm test -- apps/web/lib/extensions
npm run typecheck
```

Expected: pass.

### Task 15: Add the read-only MCP server

**Files:**

- Create: `apps/server/src/mcp/server.ts`
- Create: `apps/server/src/mcp/tools.ts`
- Create: `apps/server/src/mcp/auth.ts`
- Create: `apps/server/src/mcp/schema.sql`
- Create: `apps/server/src/routes/mcp-tokens.ts`
- Test: `apps/server/src/mcp/__tests__/tools.test.ts`
- Test: `apps/server/src/mcp/__tests__/auth.test.ts`

**Step 1: Write failing tests first**

Cover:

- Missing, invalid, revoked, and cross-workspace tokens are rejected.
- Only read-only tools are exposed.
- Search and read are bounded to the token's workspace.
- Output is capped at 64 KiB.
- Note and file content is returned safely.
- No write tool exists.
- MCP is disabled by default.

**Step 2: Implement**

Store only token hashes. Scope every query by workspace. Add token creation and
revocation routes for owners. Add a separate security review before enabling MCP
in production docs.

**Step 3: Run**

```bash
npm test -- apps/server/src/mcp
npm run typecheck
```

Expected: pass.

---

## Phase 5: Verification and Release Gates

### Task 16: Add E2E coverage, operational docs, and release gates

**Files:**

- Create: `scripts/e2e-sync.mjs`
- Create: `scripts/e2e-collaboration.mjs`
- Create: `scripts/e2e-ai-qa.mjs`
- Create: `scripts/e2e-mcp.mjs`
- Create: `deploy/Dockerfile`
- Create: `deploy/compose.yaml`
- Create: `docs/self-hosting.md`
- Create: `docs/stage-e-release-checklist.md`
- Modify: `README.md`
- Modify: `ROADMAP.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/stage-d-security-review.md`
- Modify: `docs/stage-e-gate-register.md`
- Test: `npm run lint`
- Test: `npm run format:check`
- Test: `npm run typecheck`
- Test: `npm test`
- Test: `npm run build`

**Step 1: Add E2E scripts**

Cover:

- Two users edit one note with presence and reconnect.
- Viewer cannot write.
- Offline edit creates a conflict copy.
- File conflict creates a conflict copy.
- AI consent is required and bad citations are rejected.
- MCP token cannot read another workspace.

**Step 2: Add deployment docs**

Document TLS, reverse proxy, data directory, backup, restore, migration, rollback,
delete-all, single-writer limitation, and MCP disablement. Do not promise
encryption at rest.

**Step 3: Run gates**

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```

Expected: all pass. Record exact counts and any warnings.

**Step 4: Run browser E2E when available**

```bash
node scripts/e2e-sync.mjs
node scripts/e2e-collaboration.mjs
node scripts/e2e-ai-qa.mjs
node scripts/e2e-mcp.mjs
```

Expected: pass, or report the exact environment blocker. Do not claim a pass
without executing it.

**Step 5: Update docs and gates**

Update README status, ROADMAP checkboxes, CHANGELOG, the security dossier, and the
gate register with evidence. Do not mark Stage E complete while collaboration,
MCP, AI egress, external cryptography, E2EE, or hosted CI gates are open.

---

## Deferred Work

- OpenNest Cloud.
- Public sharing links.
- Federation.
- E2EE group keys and shared-content E2EE.
- OCR and PDF extraction.
- Real-time binary editing.
- MCP client mode.
- Multi-process and clustered server deployment.
- Object storage adapter for files.
- Hosted CI until a remote exists.
