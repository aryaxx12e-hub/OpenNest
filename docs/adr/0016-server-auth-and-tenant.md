# ADR 0016: Server authentication and tenant boundary

- Status: Accepted for implementation; security review pending
- Date: 2026-11-18
- Accepted: 2026-11-18
- Context: Stage E AI, Sync, and Collaboration
- Related: ADR 0008, ADR 0009, ADR 0012, ADR 0015
- Product conflict: none; the shared-workspace trust boundary must be disclosed
- Design: `docs/superpowers/specs/2026-11-18-stage-e-ai-sync-collaboration-design.md`
- Plan: `docs/superpowers/plans/2026-11-18-stage-e-ai-sync-collaboration.md`

## Context and problem

ADR 0015 approved a single-user, single-tenant Node server as a Stage E
candidate. Stage E collaboration requires more than that boundary: multiple
people need to reach one workspace, with different permissions, without turning
OpenNest into a multi-tenant hosted service.

The product has no authentication, session model, membership model, or server
audit log. Adding collaboration without those controls would let object
identifiers become access capabilities and would make viewer read-only behavior a
UI convention rather than an enforced rule.

## Goals

- Define the smallest safe authentication and membership model for one shared
  workspace.
- Keep local-only mode accountless.
- Enforce viewer read-only behavior at every transport.
- Keep workspace content in the existing workspace database and keep identity in
  a separate database.
- Make every access decision explicit and testable.

## Non-goals

- Multi-tenant hosting or OpenNest Cloud.
- Public sharing links.
- Federation.
- Organization-wide roles or custom permission builders.
- Password reset by email.
- Social login, passkeys, or enterprise identity providers.
- End-to-end encryption for shared workspaces.
- Server-side key escrow.

## Constraints

- Node.js `>=24.0.0`.
- One workspace per deployment.
- The first owner is created by a local CLI command.
- The server is invite-only after bootstrap.
- Auth data must not live in the workspace database.
- No server code may import browser storage or service worker code.
- All workspace access must check the session and membership.
- Object identifiers are not capabilities.
- Stage D security review and the E2EE claim gate remain open.

## Alternatives considered

1. Reuse a hosted identity provider. Rejected for the first release because it
   adds an external account dependency and a new data processor before the
   self-hosted boundary is reviewed.
2. Use HTTP Basic authentication. Rejected because it has no session revocation,
   no CSRF model, and weak audit semantics.
3. Use signed stateless tokens only. Rejected because revocation would require a
   separate denylist and would complicate member removal.
4. Use opaque server-side sessions with a separate auth database and invite-only
   membership. Recommended.
5. Treat the workspace as multi-tenant from the start. Rejected as unnecessary
   for one workspace per deployment and harder to secure before review.

## Decision

### Deployment and tenant boundary

- One deployment serves one workspace.
- The workspace ID still appears in authorization checks. It is not a tenant
  routing key and does not permit cross-workspace access.
- There is no public workspace discovery, public sign-up, or cross-workspace
  directory.
- A future multi-tenant service needs a new ADR and a separate security review.

### Bootstrap

- `bootstrap-owner` runs locally and reads the password from stdin, not argv.
- It creates the first owner only when no owner exists.
- It prints the owner email and no password.
- The bootstrap status endpoint is public only until the first owner exists.
- After bootstrap, all workspace API routes require a session.

### Credentials and sessions

- Passwords use `scrypt` with `N=32768`, `r=8`, `p=1`, a 16-byte random salt, and
  a 32-byte hash.
- Password comparison uses a constant-time comparison.
- Sessions use a 32-byte random token. Only the SHA-256 hash is stored.
- Session lifetime is 30 days.
- Session cookies are `HttpOnly`, `Secure`, and `SameSite=Lax`.
- State-changing requests require a CSRF token bound to the session.
- Login failures return a generic response and do not reveal whether an email
  exists.
- Login attempts are rate-limited. The first implementation keeps counters in
  memory and documents the single-process limitation.
- Logout revokes the session. Member revocation revokes all active sessions for
  that member.

### Membership and roles

- Roles are `owner`, `editor`, and `viewer`.
- Owners manage invites, roles, revocation, and server tokens.
- Editors can read and write notes, files, folders, tags, and sync operations.
- Viewers can read workspace content and presence but cannot write.
- No member can grant a role higher than their own.
- An owner cannot revoke the last owner.
- Invites are single-use and expire after 7 days.
- Invite acceptance creates exactly one member in one transaction.

### Authorization

- Every request resolves the session, the member, and the workspace before
  reading or writing workspace data.
- HTTP writes require `editor` or `owner`.
- Sync push requires `editor` or `owner`. Sync pull requires membership.
- WebSocket collaboration authenticates the handshake before joining a room.
  `viewer` joins read-only and cannot apply updates.
- File access checks membership and role even when the caller knows the file ID.
- MCP tokens are scoped to one workspace and one read-only role.
- Authorization failures return a generic response and do not disclose whether
  the object exists.

### Storage separation

- Identity, sessions, invites, membership, MCP tokens, and audit metadata live in
  a separate `auth.sqlite`.
- Workspace content remains in the existing workspace SQLite database and blob
  root.
- `auth.sqlite` uses WAL, foreign keys, and `busy_timeout=5000`.
- The server has one writer process per database and blob root.
- No browser storage adapter is used on the server.

### Audit

- Audit records contain actor, action, target, result, and timestamp.
- Audit records may contain workspace and object identifiers.
- Audit records never contain note text, file bytes, passwords, session tokens,
  MCP tokens, AI content, or encryption keys.
- Membership changes and token changes are audited in the same transaction where
  possible.

### Trust disclosure

- Shared workspace content is visible to the server operator.
- The operator can read workspace content and metadata unless a future shared
  encryption design changes that boundary.
- OpenNest must not claim E2EE for a shared workspace in this stage.
- Personal workspace encryption remains optional and does not turn a shared
  workspace into an E2EE workspace.

## Consequences

- Local-only mode stays accountless and does not need `auth.sqlite`.
- A self-hosted operator must protect the server, TLS termination, backups, and
  the data directory.
- Losing the last owner password has no email recovery path. Recovery is an
  operator procedure against the self-hosted deployment.
- Session state and rate limits are single-process.
- Multi-tenant hosting, public sharing, and shared E2EE remain separate work.
- The collaboration and MCP security reviews must still pass before release.

## Residual risks

- A compromised server or operator can read shared workspace content and
  metadata.
- A compromised browser session can act as the member until revoked or expired.
- In-memory rate limiting resets on restart and does not coordinate across
  processes.
- A stolen MCP token grants read-only access to one workspace until revoked.
- Password strength and operator TLS quality are deployment responsibilities.

## Gate conditions

This ADR approves implementation, not a security claim. The authentication and
tenant boundary is ready for release only when:

1. The collaboration security review covers session, membership, and WebSocket
   authorization.
2. The MCP security review covers token scope, revocation, and output limits.
3. Tests prove viewer denial at HTTP, sync, and WebSocket layers.
4. Tests prove cross-workspace access is denied for every route.
5. Documentation states that shared workspace content is visible to the operator.
6. The Stage E gate register records the evidence.
