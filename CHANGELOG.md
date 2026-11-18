# Changelog

All notable changes to OpenNest are documented in this file. The format follows
Keep a Changelog, and the project intends to use semantic versioning once
releases begin.

## [Unreleased]

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

### Security

- Remote providers require HTTPS. Loopback HTTP is allowed only for explicit
  local providers, and redirects, userinfo, query strings, fragments, and
  wildcards are rejected.
- The AI and credential-vault implementation has not been independently
  reviewed. There are no automatic retries, and remote providers remain subject
  to browser CORS behavior. XSS while the vault is unlocked remains a residual
  risk. No E2EE or AI confidentiality claim is made.
