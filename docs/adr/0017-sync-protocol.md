# ADR 0017: Server sync protocol

- Status: Accepted for implementation; security review pending
- Date: 2026-11-18
- Accepted: 2026-11-18
- Context: Stage E AI, Sync, and Collaboration
- Related: ADR 0005, ADR 0008, ADR 0012, ADR 0013, ADR 0016
- Product conflict: none; the server is optional
- Design: `docs/superpowers/specs/2026-11-18-stage-e-ai-sync-collaboration-design.md`
- Plan: `docs/superpowers/plans/2026-11-18-stage-e-ai-sync-collaboration.md`

## Context and problem

ADR 0012 added the local sync-compatible data model: per-entity and per-field
revisions, tombstones, an outbox, conflict records, and workspace sync state. It
did not define a transport or a server authority.

Multi-device sync needs one canonical order for applied operations. Without it,
two clients can acknowledge different revisions, replay the same operation twice,
or overwrite content that the user never chose to discard. The server must define
canonical revisions without breaking local-first use, existing repositories, or
backup behavior.

## Goals

- Define an idempotent push and pull protocol over the existing outbox model.
- Make the server the canonical workspace authority.
- Preserve concurrent content instead of silently discarding it.
- Keep offline retry and conflict handling explicit.
- Keep sync optional and keep local-only mode functional.
- Keep workspace backups independent from sync sidecars and identity.

## Non-goals

- Real-time text collaboration. That is ADR 0018.
- Shared workspace E2EE or group keys.
- Sync for personal encrypted workspaces.
- Peer-to-peer sync.
- Federation.
- Public sharing.
- A general event-sourcing system.
- Multi-process server deployment.

## Constraints

- The server uses the existing workspace SQLite database and blob root.
- The protocol reuses existing outbox, revision, tombstone, and conflict rules.
- The server must not trust client clocks or client-assigned canonical revisions.
- Push must be idempotent by `opId`.
- Pull must never return an operation twice for the same cursor.
- Sync must require a member session.
- Viewer push must be rejected.
- Backup v1 and backup v2 must not include sync sidecars or device identity.
- Stage D security review and the E2EE claim gate remain open.

## Alternatives considered

1. Let the client be authoritative. Rejected because concurrent clients would
   choose different winners and the server could not provide a stable cursor.
2. Make the server a full event-sourcing system. Rejected because it would
   replace the existing entity model and complicate backup and restore.
3. Use WebSocket for all sync. Rejected because push and pull are request and
   response operations, and HTTP gives simpler idempotency and error handling.
4. Use HTTP push and pull over the existing outbox and revision model, with
   canonical server revisions and cursors. Recommended.
5. Use last-write-wins only. Rejected because it silently discards concurrent
   content.

## Decision

### Canonical authority

- The server assigns the canonical workspace revision.
- Every applied operation receives exactly one canonical revision in one
  transaction.
- Client workspace revisions are local observations. The server does not accept
  them as canonical.
- The workspace revision is monotonic and never reused.
- Entity and field revisions still describe local write order. The canonical
  revision orders applied operations across devices.

### Push

- `POST /api/sync/push` accepts a batch of outbox operations for one workspace.
- Every operation carries `opId`, entity type, entity ID, operation kind, base
  entity revision, base workspace revision, field patches, payload hash, device
  ID, and local sequence.
- `opId` is globally unique for the workspace and is the idempotency key.
- Replaying an accepted `opId` returns the original result and does not advance
  the canonical revision.
- Applying a batch is one transaction. A failed operation fails the batch.
- The server validates membership and role before accepting any operation. Viewer
  push is rejected.
- The server validates payload shape, payload hash, field paths, entity type, and
  operation kind before writing.
- The server rejects an operation whose base revision is behind a tombstone that
  the operation would resurrect.
- The response returns accepted `opId` values, rejected operations with stable
  error codes, canonical revisions, and any generated conflicts.

### Pull

- `POST /api/sync/pull` or `GET /api/sync/pull` accepts a cursor and returns
  operations after that cursor.
- The cursor encodes a canonical workspace revision and is opaque to the client.
- The server pages the response. A page is bounded by the protocol schema and the
  server body limit.
- A response includes the next cursor only when more operations exist.
- The client persists the cursor only after applying the page.
- Pull requires membership. A viewer may pull.
- Deleted or unauthorized objects do not leak their existence through errors.

### Conflict policy

- Non-overlapping field changes merge.
- Overlapping field changes that carry user content are not silently merged. The
  server preserves the incoming value and creates a conflict record that
  references both revisions.
- The UI requires an explicit user choice for content-bearing conflicts.
- A delete tombstone wins over a concurrent update. The update is not applied.
  If the update carries user content, the server preserves it as a conflict copy
  so the user can restore it explicitly.
- Tombstones are not resurrected by replay or by a stale update.
- Restore is an explicit operation with its own revision. It is not an update to
  a deleted entity.
- Conflict records are workspace data and survive a page reload.

### Offline retry

- The client keeps operations in the outbox while offline.
- Retry uses bounded exponential backoff with jitter.
- A network error, timeout, `408`, `429`, or `5xx` is retryable.
- A stable `4xx` validation or authorization error is terminal for that operation
  and surfaces to the user.
- The client does not retry an operation after the user resolves or discards it.
- The outbox remains bounded at 1,000 rows and 30 days. The client never silently
  drops a user write to satisfy the limit.

### Backup and restore

- Backup v1 and backup v2 exclude sync sidecars, server canonical revisions, sync
  cursors, device identity, auth data, sessions, invites, and MCP tokens.
- A restored workspace is a new local baseline and must not reuse a server cursor
  from another workspace.
- Server-side workspace backups are an operator responsibility. They are not
  implied by the client backup feature.
- The server backup procedure must include the workspace database and blob root,
  and must exclude `auth.sqlite` unless the operator explicitly wants identity
  data.

### Encryption boundary

- Shared workspace sync carries workspace content to the server. Shared
  workspace E2EE is not supported in this stage.
- Personal workspace encryption remains local-only in this stage.
- Sync must not merge encrypted and plaintext values as if they were compatible.
- No sync path may be used to claim E2EE while R-13-7 remains open.

### Limits and failure behavior

- The protocol rejects malformed JSON, unknown operation types, oversized
  payloads, invalid hashes, and invalid field paths.
- The server returns a stable error code and a correlation ID, not a stack trace.
- A partial batch is not committed.
- The server logs metadata only, never note text or file bytes.
- The client surfaces terminal failures and keeps the local value intact.

## Consequences

- The server becomes a new canonical authority and a new backup and operations
  responsibility for self-hosted deployments.
- Existing repositories continue to work locally. The sync engine is an optional
  adapter over them.
- A visible conflict is preferred over silent data loss.
- Clients need durable cursors and idempotent retries.
- Sync does not provide real-time editing. Notes in a live session use ADR 0018.
- Cloud sync remains deferred.

## Residual risks

- Clients can observe workspace revisions and timing metadata.
- A server operator can read shared workspace content.
- A malicious client can submit invalid operations until rate-limited or
  revoked.
- Conflict volume can grow under adversarial or high-latency use.
- Clock skew can affect display timestamps, even though it does not affect
  canonical ordering.

## Gate conditions

This ADR approves implementation, not a sync security claim. The sync path is
ready for release only when:

1. Tests prove idempotency, cursor stability, tombstone behavior, viewer denial,
   and cross-workspace denial.
2. The collaboration security review covers sync authorization and conflict
   handling.
3. Backup tests prove sync sidecars and device identity are excluded.
4. Documentation states that shared workspace content reaches the server.
5. The Stage E gate register records the evidence.
