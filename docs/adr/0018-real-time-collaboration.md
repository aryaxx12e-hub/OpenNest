# ADR 0018: Real-time collaboration

- Status: Accepted for implementation; security review pending
- Date: 2026-11-18
- Accepted: 2026-11-18
- Context: Stage E AI, Sync, and Collaboration
- Related: ADR 0009, ADR 0012, ADR 0013, ADR 0016, ADR 0017
- Product conflict: none for notes; real-time binary editing is not approved
- Design: `docs/superpowers/specs/2026-11-18-stage-e-ai-sync-collaboration-design.md`
- Plan: `docs/superpowers/plans/2026-11-18-stage-e-ai-sync-collaboration.md`

## Context and problem

Markdown notes currently autosave through the repository and sync through the
outbox model. Multiple members editing one note at the same time need convergent
text updates without creating a text operation per keystroke or overwriting a
whole note on every save.

The shared workspace is not E2EE. Real-time collaboration therefore has to make
a clear trust choice: the server sees live note text, and the browser and server
must both enforce membership and role before accepting updates.

## Goals

- Provide real-time Markdown note editing for editors and owners.
- Keep viewers read-only.
- Converge concurrent text edits without silent loss.
- Persist durable snapshots without duplicating text operations in the outbox.
- Keep presence ephemeral.
- Keep local-only mode independent from the collaboration server.

## Non-goals

- Real-time editing for files, images, PDFs, or binary content.
- Shared workspace E2EE.
- Group key management or encrypted Yjs updates.
- Offline real-time collaboration.
- Presence history, cursors, comments, or chat.
- Multi-process room coordination.
- Public anonymous rooms.

## Constraints

- One workspace per deployment.
- Yjs is the live text model while a room is connected.
- The server authenticates the WebSocket handshake before joining a room.
- The server authorizes the member and role before accepting updates.
- Viewers cannot apply updates on the server or the client.
- One room per note.
- Update size is limited to 256 KiB.
- Each connection is limited to 200 updates per minute.
- Dirty snapshots are written every 2 seconds and on the last disconnect.
- Presence is memory-only and never persisted.
- Shared workspace content is visible to the server operator.
- No E2EE claim is made for shared workspaces.

## Alternatives considered

1. Reuse whole-note autosave for collaboration. Rejected because concurrent
   editors overwrite each other and every save creates a large text operation.
2. Use a custom operational transform. Rejected because Yjs is mature and already
   fits the CRDT requirement for text.
3. Use Yjs only in the browser and persist the whole note through the existing
   autosave path. Rejected because autosave and Yjs would race and duplicate text
   operations.
4. Use Yjs rooms on the server with a `CollaborationStore` snapshot path that does
   not append an outbox row. Recommended.
5. Use a third-party hosted collaboration service. Rejected because it adds an
   external processor and contradicts the self-hosted boundary.

## Decision

### Live document model

- Yjs owns note text while a collaboration session is connected.
- One Yjs document represents one Markdown note.
- The server keeps one room per note.
- The client loads the current note into Yjs before enabling editing.
- Markdown remains the durable text format. Yjs state is a collaboration
  artifact, not a second user-facing note format.
- Note metadata such as title, tags, folder, and timestamps stays in the existing
  repository and sync model.

### Transport and authorization

- The browser opens a WebSocket to the collaboration endpoint.
- The handshake requires a valid session cookie and an allowed origin.
- The server resolves the workspace and membership before joining the room.
- `owner` and `editor` join read-write.
- `viewer` joins read-only. The server rejects inbound document updates from a
  viewer.
- Cross-workspace and unknown note access is rejected without disclosing
  existence.
- Revoking a member or ending a session closes that member's active collaboration
  connections.
- The room is destroyed when the last participant disconnects.

### Limits

- A document update is limited to 256 KiB.
- A connection is limited to 200 updates per minute.
- Oversized or rate-limited updates are rejected and do not enter the Yjs
  document.
- Awareness messages are limited separately and are never persisted.
- The implementation must bound room memory and close abusive connections.

### Persistence

- A dirty room is snapshotted every 2 seconds.
- A room is snapshotted on the last disconnect.
- A snapshot writes the note body and its sync metadata in one transaction.
- The snapshot path uses `CollaborationStore.writeSnapshot`.
- `CollaborationStore.writeSnapshot` must not append a text operation to the
  outbox. The live session is the source of intermediate text updates, and a
  snapshot is the durable write. This prevents duplicate text operations.
- Snapshot writes are serialized per note.
- A failed snapshot keeps the room dirty and retries on the next interval.
- The server does not acknowledge a durable write until the snapshot transaction
  commits.
- Presence is not part of the snapshot.

### Offline behavior

- Real-time collaboration requires a server connection.
- Local-only mode never opens a collaboration connection.
- When a connected note goes offline, the local editor continues to work through
  the existing local repository and autosave path.
- On reconnect, if the local note differs from the server snapshot and the server
  has remote changes, the client preserves the local text as a conflict copy
  instead of silently replacing it.
- Conflict copies are visible in the workspace and are not overwritten by the
  live session.

### Presence

- Presence includes display name, connection state, and an ephemeral participant
  color.
- Presence is held in memory only.
- Presence has a short TTL and is removed on disconnect.
- Presence is never written to SQLite, Dexie, backups, logs, or audit records.
- No cursor tracking, typing history, or per-character attribution is stored.

### Encryption boundary

- Shared workspace collaboration is not E2EE.
- The server sees note text and presence metadata.
- The client must not describe a shared workspace as E2EE.
- Personal workspace encryption remains separate. Enabling it does not enable
  E2EE collaboration.
- No Yjs update may be presented as end-to-end encrypted while R-13-7 remains
  open.

## Consequences

- Yjs and `y-protocols` become runtime dependencies of the collaboration package.
- The server holds live room state and must be single-process for the first
  release.
- The durable note write moves to the snapshot path while a room is live.
- Offline editors can still lose their preferred merge position, but they do not
  lose their text because a conflict copy is preserved.
- Client disconnect, server crash, or process shutdown can lose at most the
  unsnapshotted interval, which is bounded by the 2-second cadence and the last
  disconnect write.
- Real-time file editing remains out of scope.

## Residual risks

- A compromised server or operator can read live note text.
- A compromised editor session can modify notes until revoked.
- A server crash can lose a small unsnapshotted interval.
- A malicious editor can send abusive updates until rate-limited or revoked.
- Room memory is bounded by participant and note limits, not by horizontal
  scaling.
- Presence reveals display names and activity timing to workspace members.

## Gate conditions

This ADR approves implementation, not a collaboration security claim. The
collaboration path is ready for release only when:

1. The collaboration security review covers handshake authentication, origin
   checks, role enforcement, room isolation, limits, and snapshot transactions.
2. Two-client convergence and viewer denial tests pass.
3. Tests prove `writeSnapshot` does not append an outbox row.
4. Tests prove presence is not persisted and is removed on disconnect.
5. Documentation states that shared workspace content is visible to the operator.
6. The Stage E gate register records the evidence.
