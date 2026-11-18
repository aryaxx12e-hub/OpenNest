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
