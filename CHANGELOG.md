# Changelog

All notable changes to OpenNest are documented in this file. The format follows
Keep a Changelog, and the project intends to use semantic versioning once
releases begin.

## [Unreleased]

### Pre-D4A milestones

- Stage A: Next.js and TypeScript foundation, Tailwind CSS, localization,
  package boundaries, and test tooling.
- Stage B: domain models, storage ports, IndexedDB and SQLite adapters,
  repository layer, validation, and persistence conformance.
- Stage C: library, notes, tags, search, backup and restore, PWA, offline shell,
  installation, and accessibility work.
- Stage D1-D3: Privacy Center, extension architecture, AI consent and
  credentials, sync-compatible data model, and optional workspace encryption.

### Added

- Shared sync protocol request and response schemas with bounded batches,
  canonical serialization, opaque cursors, conflicts, and stable rejection
  codes.
- A self-hosted Node server foundation with health endpoints, graceful
  lifecycle, a separate auth SQLite database, bootstrap-owner CLI, scrypt
  passwords, opaque sessions, invite-only membership, role checks, CSRF
  protection, login rate limiting, and metadata-only audit records.
- A server sync authority with transactional push and pull routes, replay-safe
  operation IDs, canonical workspace revisions, role-gated access, conflict
  records, tombstones, and opaque workspace-scoped cursors.
- A client sync engine with outbox batching, bounded retry backoff, terminal
  error handling, conflict persistence, a localized status indicator, and a
  conflict dialog that leaves repository writes to its host.
- Server file versioning with immutable versions, concurrent-upload conflict
  copies, role-gated uploads, safe attachment downloads, MIME and size
  validation, generated blob paths, and abandoned temp-file cleanup.
- Real-time collaboration transport with an authenticated same-origin WebSocket
  handshake, Yjs note rooms, viewer read-only enforcement, 256 KiB update and
  per-connection rate limits, ephemeral presence, and 2-second and
  last-disconnect snapshots that write note content and sync metadata without
  outbox rows.
- An opt-in browser collaboration provider with bounded reconnect backoff,
  offline draft preservation, viewer read-only mode, localized connection and
  presence indicators, and a shared Markdown editor. It stays disabled unless
  the deployment sets both public collaboration environment variables.
- Local in-memory retrieval for Markdown notes and text-readable files with
  stable passage IDs, bounded chunk and byte budgets, existing full-text search
  candidates, and citation validation that removes unknown sources and marks
  uncited answers unsupported.
- Document Q&A built on local retrieval with D2-only selected passages, a
  five-minute payload-bound consent, 256 KiB request and 2 MiB response limits,
  cancellation, and validated citations that link to notes or text files.
- A host-mediated `ai.generate` extension capability with host-selected
  providers, per-call consent, 32 KiB prompt and 48 KiB response limits,
  metadata-only audit, generic disabled and failure errors, and off-by-default
  app wiring.
- An off-by-default read-only MCP server with owner-managed hashed workspace
  tokens, five read-only tools, workspace-scoped reads, 64 KiB request and
  output caps, per-token rate limiting, and metadata-only audit. A separate
  security review is still required before production use.
- Protocol-level E2E scripts for server sync conflicts, collaboration presence
  and reconnect, AI Q&A consent and citations, and MCP workspace isolation,
  with a shared server harness and SQLite seed helper.
- A single-process Dockerfile and Compose service for the self-hosted API, plus
  a self-hosting guide covering TLS, reverse proxy, data directory, backup,
  restore, migration, rollback, delete-all, single-writer limits, and MCP
  disablement.
- A Stage E release checklist and gate-register evidence for protocol E2E and
  non-browser gates. Browser E2E remains blocked by missing account, Q&A source
  selection, and MCP token management surfaces.
- Note-to-note links with a searchable picker, linked-note navigation, and a
  one-way link model.
- Per-note Markdown export with safe filenames and clear success and error states.
- Library sorting by name, creation time, or update time, plus document and image
  type filters with a filtered-empty state.
- Backup reminders on the dashboard and in settings, including the last
  successful backup timestamp.
- Browser storage diagnostics for usage, quota, persistence, and eviction
  guidance, with an optional `Keep this data` request.
- Restore recovery guidance that maps errors to concrete next steps and links to
  storage diagnostics.
- Optional AI providers using the OpenAI-compatible chat API, with local and
  remote endpoint validation, presets, and an explicit localhost warning.
- An AI console that shows the exact provider, origin, model, data classes, byte
  size, and prompt before a one-time, payload-bound consent is approved.
- Session-only credentials and an optional passphrase-encrypted credential vault
  with a separate key domain, automatic locking, and no recovery path.
- Plain-text rendering for model output with no tools, MCP execution, document
  context, or AI chat history.
- AI provider, consent, credential, and vault entries in the Privacy Center
  inventory, consent history, and delete-all flow.
- Backup v1 and backup v2 exclusions for AI provider settings, consents, session
  credentials, and vault records.
- Production CSP coverage for HTTPS and loopback AI endpoints with exact-origin
  enforcement in the browser transport.
- AI end-to-end coverage for off-by-default behavior, consent, local providers,
  session and vault credentials, HTML-as-text rendering, and delete-all.
- Tier 1 local sideload extensions with a strict JSON package format, canonical
  SHA-256 integrity, host-version checks, publisher and version update rules, and
  explicit capability consent.
- An extension runner with a trusted shell, opaque-origin iframe, blob worker,
  read-only workspace host API, isolated storage, safe tree UI rendering, and
  per-extension enable, disable, uninstall, and safe mode controls.
- Extension privacy audit events, inventory entries, delete-all cleanup, backup
  exclusions, PWA assets, localization, and a browser end-to-end journey covering
  install, update consent, sandbox probes, storage, disable, safe mode, uninstall,
  reinstall, and privacy history.
- SQLite startup reconciliation for orphan blobs and stale temporary files.
- Explicit optional storage adapter deferral in ADR 0014.
- A self-hosting boundary evaluation and ADR 0015.
- A Stage D security dossier, extension review gate, and reviewer handoff packet.
- A CI workflow for non-browser quality gates.

### Security

- Remote providers require HTTPS. Loopback HTTP is allowed only for explicit
  local providers, and redirects, userinfo, query strings, fragments, and
  wildcards are rejected.
- The AI and credential-vault implementation has not been independently
  reviewed. There are no automatic retries, and remote providers remain subject
  to browser CORS behavior. XSS while the vault is unlocked remains a residual
  risk. No E2EE or AI confidentiality claim is made.
- The extension runtime denies DOM, network, browser storage, credential, and
  workspace write access, enforces package, message, UI, rate, time, and storage
  limits, and isolates extension data from backups and other extensions. The file
  picker checks package size before reading, oversized host responses are
  replaced with a small failure, UI updates are rate-limited, and the install
  dialog warns that local sideload packages are unsigned. The independent
  extension security review has not been completed.
- The Stage D internal security dossier and reviewer handoff are prepared.
  Independent extension, AI, and cryptographic reviews have not started, and the
  E2EE claim gate remains open.
