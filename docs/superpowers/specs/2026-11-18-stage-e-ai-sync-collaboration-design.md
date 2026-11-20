# Stage E: AI, Sync, and Collaboration Design

- Status: Approved; decision records accepted 2026-11-18; implementation complete; release gates open
- Date: 2026-11-18
- Stage: E
- Related: ADR 0008, ADR 0009, ADR 0011, ADR 0012, ADR 0013, ADR 0015
- Decision records: ADR 0016, ADR 0017, ADR 0018, ADR 0019, ADR 0020
- Gates: `docs/stage-e-gate-register.md`
- Plan: `docs/superpowers/plans/2026-11-18-stage-e-ai-sync-collaboration.md`

## Intent

Stage E adds the final capability set: optional self-hosted collaboration,
multi-device sync, AI document Q&A, AI-powered extensions, and a read-only MCP
server. The product must remain local-first, accountless by default, and useful
without a server or AI provider.

The user chose real-time collaboration, self-hosted first, with cloud later. A
shared workspace is one invite-only workspace per deployment, with owner, editor,
and viewer roles. Shared workspaces do not claim end-to-end encryption in this
stage.

## Decision Records

- [ADR 0016: Server authentication and tenant boundary](../../adr/0016-server-auth-and-tenant.md)
- [ADR 0017: Server sync protocol](../../adr/0017-sync-protocol.md)
- [ADR 0018: Real-time collaboration](../../adr/0018-real-time-collaboration.md)
- [ADR 0019: AI document Q&A and egress](../../adr/0019-ai-document-qa-and-egress.md)
- [ADR 0020: Read-only MCP server](../../adr/0020-mcp-server.md)

The ADRs are binding for implementation details. This spec remains the product
authority when an ADR is silent. The gate register records release evidence and
does not close an external review by itself.

## Goals

- Keep the local-only PWA accountless and fully functional offline.
- Add a separate self-hosted Node server with authentication, authorization,
  sync authority, file versions, and WebSocket collaboration.
- Add invite-only real-time note editing with presence.
- Synchronize notes, metadata, and files across devices and workspace members.
- Add local document retrieval and AI answers with validated citations.
- Add host-mediated AI access for extensions.
- Add an authenticated, read-only MCP server for exposing selected workspace
  context to external AI clients.
- Preserve existing ports, validation, backup formats, and SQLite adapter
  behavior.

## Non-goals

- Public sharing links.
- Federation.
- A multi-tenant SaaS or hosted OpenNest Cloud in this plan.
- End-to-end encryption for shared workspaces.
- E2EE group keys, device rosters for shared content, or a new cryptographic claim.
- OCR and PDF extraction.
- Real-time binary editing.
- MCP tool execution or OpenNest as an MCP client.
- Multi-process or clustered server deployment.

## Anti-goals

- A shared workspace that silently exposes one workspace to another.
- A viewer who can write through HTTP, WebSocket, or sync push.
- A server that becomes required for local file and note access.
- AI answers that invent citations or send content without per-request consent.
- A second data model for the server.
- A local-only user who is forced to create an account.

## Constraints

- Node.js `>=24.0.0`.
- TypeScript strict mode, no `any`.
- The browser application must not import `node:*` or server-only code.
- SQLite remains the server adapter, with WAL, foreign keys, and a 5-second busy
  timeout.
- One writer process per database and blob root.
- Existing file limit remains 25 MiB.
- Existing sync outbox limits remain 1000 rows and 30 days.
- AI request limit remains 256 KiB, response limit 2 MiB, and consent lifetime 5
  minutes.
- All user-facing text must exist in English and Indonesian.
- Stage D security review, external cryptographic review, E2EE claim gate, and
  first hosted CI run remain open.

## Approaches Considered

1. **Layered, one data model, self-hosted first.** Build server and auth, then
   sync, then real-time, then AI and MCP. Recommended.
2. **Collaboration-first.** Build Yjs and shared editing before auth and sync.
   Faster demo, but permissions, conflict handling, and tenant isolation become
   retrofits.
3. **Separate server product.** Keep the PWA local-only and build a second schema
   for the server. Rejected because it duplicates the product and violates ADR
   0015's one-data-model boundary.

The approved approach is 1.

## Architecture

### Components

- `apps/server`: Node 24 composition root for auth, sync, files, WebSocket
  collaboration, MCP, backup, and operations endpoints.
- `packages/sync-protocol`: shared request and response schemas for sync push and
  pull.
- `packages/collaboration`: Yjs document helpers, update encoding, and awareness
  types shared by browser and server.
- `apps/web/lib/sync`: client sync engine, offline retry, and conflict UI.
- `apps/web/lib/collaboration`: browser Yjs provider and presence.
- `apps/web/lib/ai/retrieval`: local chunking, candidate retrieval, and citation
  validation.
- `apps/server/src/mcp`: authenticated read-only MCP transport and tools.
- Existing `@opennest/core`, `@opennest/privacy`, `@opennest/ai`,
  `@opennest/storage-dexie`, and `@opennest/storage-sqlite` remain the domain and
  storage layers.

### Server storage

- Workspace content remains in the existing SQLite workspace database and
  filesystem blob root.
- Auth, sessions, invites, membership, audit, and MCP tokens live in a separate
  `auth.sqlite` file.
- Server-only workspace tables for file versions and sync authority are added by
  server migrations after the core migrations.
- No Dexie, IndexedDB, service worker, or browser API may run on the server.

### Authentication and membership

- The first owner is created by a local CLI command that reads the password from
  stdin.
- The server is invite-only after bootstrap.
- Passwords use `scrypt` with `N=32768`, `r=8`, `p=1`, a 16-byte salt, and a
  32-byte hash.
- Sessions use a 32-byte random token. Only its SHA-256 hash is stored. The cookie
  is `HttpOnly`, `Secure`, and `SameSite=Lax`; state-changing requests also need a
  CSRF token.
- Sessions last 30 days. Invites last 7 days and are single-use.
- Roles are `owner`, `editor`, and `viewer`. One workspace per deployment.
- Revoking a member revokes their active sessions.

### Sync

- The server is the canonical workspace authority.
- Clients keep using the existing outbox, entity revisions, field revisions,
  tombstones, and conflict records.
- Push is idempotent by `opId`. The server records applied operations and assigns
  canonical workspace revisions.
- Pull uses a cursor encoded from the canonical revision.
- Content-bearing conflicts always preserve both values and require a user
  decision.
- Offline clients queue operations and retry with backoff.
- Backup v1 and v2 continue to exclude sync sidecars and device identity.

### Files

- Files are versioned. Each upload creates an immutable version.
- Concurrent uploads from the same base create a conflict copy instead of
  overwriting.
- Downloads set an explicit content type, `Content-Disposition: attachment`, and
  `X-Content-Type-Options: nosniff`.
- Uploaded files are never executed.
- File names are metadata, never filesystem paths.

### Real-time notes

- Yjs owns live note text while a collaboration session is connected.
- The server keeps one room per note, authenticates the WebSocket handshake, and
  authorizes the role before accepting updates.
- Viewers are read-only.
- Updates are limited to 256 KiB and 200 per minute.
- Dirty snapshots are persisted every 2 seconds and on last disconnect.
- A collaboration snapshot updates note content and sync metadata without adding
  an outbox row. This prevents duplicate text operations.
- Presence is memory-only and never persisted.
- Real-time editing requires a server connection. Offline editing continues
  locally and creates a conflict copy when it meets remote changes.

### AI document Q&A

- Retrieval is local. Existing FTS candidates are chunked in memory.
- No persistent plaintext retrieval index is created.
- Q&A covers Markdown notes and text-readable files only.
- The user selects content. Only selected passages may be sent to a remote
  provider, after per-request consent.
- AI requests use `D2` for selected document content and must reject `D3`.
  `D3` is the secrets class in ADR 0008, not document content. The prompt is
  derived `D4` data and inherits the `D2` handling policy.
- The model receives numbered passage IDs. Every citation must match a supplied
  passage ID. Invalid citations are removed.
- If no valid citation remains, the answer is marked unsupported.
- Citations link back to the note or file and the passage range.

### AI-powered extensions

- Extensions use a host-mediated `ai.generate` method.
- Extensions never receive credentials, provider handles, or network access.
- Every AI call requires host consent and is bounded by the existing extension
  message limits.
- Provider selection and audit stay in the host.

### MCP server

- OpenNest acts as an MCP server, not an MCP client.
- The server is authenticated by a workspace-scoped bearer token.
- Tokens are stored as SHA-256 hashes and can be revoked.
- Tools are read-only: list notes, read note, search, list files, and read a text
  file.
- No write tools, shell, network fetch, or tool execution.
- Output is bounded to 64 KiB per call.
- MCP is disabled by default and requires a separate security review before
  release.

### Operations

- Single process, Node 24, optional reverse proxy and Docker packaging.
- TLS termination is the operator's responsibility and is documented.
- Backup, restore, migration, rollback, and delete-all procedures are documented.
- The server exposes only health, auth, sync, file, collaboration, and MCP
  endpoints.
- Logs contain redacted metadata only.

## Security and Privacy Boundaries

- Shared workspace content is visible to the server operator. No E2EE claim is
  made for shared workspaces.
- Personal workspace E2EE remains optional and unchanged.
- Metadata such as titles, filenames, tags, folder names, sizes, timestamps, and
  sync metadata remains visible to the server.
- Object identifiers are not capabilities. Every access checks the session,
  workspace membership, and role.
- The server rejects viewer writes at the HTTP, WebSocket, and sync layers.
- AI egress is per request and payload-bound.
- MCP tokens are scoped to one workspace and cannot read another.
- Stage D external reviews and the E2EE claim gate remain open.

## Testing Strategy

- Unit tests for auth primitives, protocol validation, chunking, citations, and
  role checks.
- Integration tests for sync push and pull, conflicts, file versions, and
  membership.
- WebSocket tests for viewer denial, reconnect, oversized updates, and snapshot
  persistence.
- Browser E2E for two-user editing, presence, offline reconnect, file conflict,
  AI consent, citation rejection, and MCP isolation.
- Full non-browser gates: lint, format check, typecheck, unit and integration
  tests, production build.
- Browser E2E runs in the local environment when available; hosted CI remains a
  separate open gate.

## Open Gates

`docs/stage-e-gate-register.md` is the release gate. No gate is closed by this
design.

- Stage D overall security review, extension sandbox review, and AI and vault
  review.
- External cryptographic review and E2EE claim gate, including R-13-7.
- Collaboration security review before multi-user release.
- MCP security review before MCP release.
- AI egress review before remote document Q&A release.
- Self-hosted release operations review.
- First hosted CI run.
- Cloud sync operations and security review after self-hosted is stable.

## What Is Left to the Builder

- Exact SQLite migration mechanics for server-only tables.
- Exact Yjs persistence batching and backpressure tuning.
- MCP transport version details.
- Docker and reverse-proxy packaging details.
- Rate-limit storage and cleanup policy.
- Final copy, empty states, and accessibility details.
