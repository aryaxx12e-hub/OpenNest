# ADR 0020: Read-only MCP server

- Status: Accepted for implementation; MCP security review pending
- Date: 2026-11-18
- Accepted: 2026-11-18
- Context: Stage E AI, Sync, and Collaboration
- Related: ADR 0008, ADR 0009, ADR 0011, ADR 0016, ADR 0017
- Product conflict: none; MCP is off by default and read-only
- Design: `docs/superpowers/specs/2026-11-18-stage-e-ai-sync-collaboration-design.md`
- Plan: `docs/superpowers/plans/2026-11-18-stage-e-ai-sync-collaboration.md`

## Context and problem

The PRD lists MCP integration, gated by a separate security and consent design.
OpenNest can act as an MCP client, an MCP server, or both. Acting as a client
would give external tools a path to workspace data and would pull tool execution
into the product. Acting as a server lets an external AI client read selected
workspace context without giving OpenNest a tool-execution surface.

The server is self-hosted and invite-only. MCP must fit that boundary: one
workspace, explicit tokens, no anonymous access, no write tools, and no
cross-workspace reads.

## Goals

- Expose a small read-only workspace context to an external MCP client.
- Authenticate every call with a workspace-scoped token.
- Keep MCP disabled by default.
- Bound output size and rate.
- Avoid tool execution, network fetch, shell access, and write access.
- Keep MCP separate from user sessions and collaboration.

## Non-goals

- OpenNest as an MCP client.
- MCP tool execution inside OpenNest.
- Write, delete, move, tag, or sync tools.
- Shell, filesystem, browser, network fetch, or code execution tools.
- Public or anonymous MCP access.
- OAuth, dynamic client registration, or a public MCP registry.
- Cross-workspace search or administration tools.
- Binary file content, OCR, or PDF extraction.
- A confidentiality claim for an external MCP client.

## Constraints

- One workspace per deployment.
- MCP is disabled by default.
- Tokens are workspace-scoped and read-only.
- Tokens are stored as hashes, never plaintext.
- Configuring a token is an explicit owner action.
- Every call is authenticated, authorized, rate-limited, and audited.
- Output is capped at 64 KiB per call.
- No MCP call may write workspace state.
- Shared workspace content is visible to the server operator.
- Stage D security review and the E2EE claim gate remain open.
- A separate MCP security review must pass before release.

## Alternatives considered

1. OpenNest as an MCP client with tool execution. Rejected because it adds remote
   code execution and a much larger consent and sandbox surface.
2. Public anonymous MCP endpoint. Rejected because it exposes workspace data and
   cannot be safely rate-limited by identity.
3. Session-cookie MCP with no separate token. Rejected because MCP clients are not
   browsers and session cookies widen CSRF and credential exposure.
4. Authenticated HTTP MCP server with workspace-scoped hashed bearer tokens and
   read-only tools. Recommended.
5. stdio MCP only. Rejected for the first self-hosted release because the server
   is already an HTTP process and stdio would require a separate local launcher.

## Decision

### Role and transport

- OpenNest acts as an MCP server, not an MCP client.
- MCP is served by the self-hosted server process over an authenticated HTTP
  endpoint.
- stdio transport is out of scope for the first implementation.
- The exact MCP protocol version and transport details are pinned in the
  implementation and documented for clients.
- MCP is disabled unless an owner explicitly enables it.
- The endpoint is not available in local-only browser mode.

### Authentication

- Owners create, list, and revoke MCP tokens.
- A token is a random opaque value shown once at creation.
- Only its SHA-256 hash and a short display prefix are stored.
- Tokens are scoped to one workspace and the read-only tool set.
- A token is not a user session and cannot access the application UI, sync push,
  collaboration, file upload, or administration routes.
- Missing, invalid, revoked, expired, or cross-workspace tokens are rejected with
  a generic error.
- Revocation takes effect on the next call.
- Tokens are excluded from client backups and workspace backups unless the
  operator explicitly includes `auth.sqlite`.

### Tools

The first release exposes only these read-only tools:

- `list_notes`: bounded note identifiers, titles, and timestamps.
- `read_note`: one note's Markdown content and metadata.
- `search`: workspace search over notes and text-readable files.
- `list_files`: bounded file metadata, excluding bytes.
- `read_text_file`: one text-readable file's content.

The implementation must not add a write tool, a delete tool, a tag tool, a sync
tool, a shell tool, a network fetch tool, or a code execution tool.

### Authorization and isolation

- Every tool call resolves the token, workspace, and membership state before
  reading.
- A token can read only its own workspace.
- Object identifiers are not capabilities. A token cannot read an object from
  another workspace by guessing its ID.
- Deleted objects are not returned.
- The tool set does not expose authentication data, sessions, invites, audit
  records, MCP tokens, AI credentials, or encryption keys.
- MCP does not bypass workspace role rules. A read-only token is read-only even if
  the creator is an owner.

### Limits and error behavior

- Output is capped at 64 KiB per call.
- List and search results are paginated and bounded.
- `read_note` and `read_text_file` reject content over the cap rather than
  silently truncating it.
- Calls are rate-limited per token.
- Errors return stable codes and do not disclose whether an unauthorized object
  exists.
- Logs and audit records contain token ID, tool name, workspace ID, result,
  duration, and timestamp. They never contain note text, file bytes, or token
  values.

### External client boundary

- Creating an MCP token is an explicit authorization to expose workspace content
  to an external MCP client.
- OpenNest cannot control what the external client does with the content after it
  is returned.
- Documentation must state that the external client's provider, retention, and
  logging policies are outside OpenNest's control.
- MCP does not create an E2EE or confidentiality claim.
- A workspace member who is not an owner cannot create a token.

## Consequences

- MCP adds a new authenticated read surface to the self-hosted server.
- MCP remains unavailable in local-only mode.
- The server must store token hashes and expose owner-only token management.
- The read-only tool set is intentionally small and cannot be expanded without a
  new ADR and security review.
- External clients can read selected workspace content until the token is
  revoked.
- MCP does not add tool execution or an OpenNest client.

## Residual risks

- A stolen token grants read-only access to one workspace until revoked.
- An external MCP client may log, retain, or forward returned content.
- Owner error can expose more content than intended by creating a token.
- Search and read limits do not prevent all cost or abuse scenarios.
- A compromised server or operator can read workspace content.
- MCP output can be used in prompt injection or model manipulation outside
  OpenNest.

## Gate conditions

This ADR approves implementation, not an MCP security claim. MCP is ready for
release only when:

1. A separate MCP security review covers authentication, token storage, scope,
   read-only enforcement, output limits, rate limits, audit, and external client
   disclosure.
2. Tests prove missing, invalid, revoked, and cross-workspace tokens are denied.
3. Tests prove only read-only tools are exposed and no write path exists.
4. Tests prove 64 KiB output limits and pagination bounds.
5. Tests prove audit records contain no note text, file bytes, or token values.
6. Documentation states that MCP is disabled by default and that external clients
   are outside OpenNest's trust boundary.
7. The Stage E gate register records the evidence.
