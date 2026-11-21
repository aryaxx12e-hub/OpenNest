# Security Policy

## Supported versions

OpenNest is pre-1.0. The public early access artifact is the source-only
`v0.1.0-beta.1` preview. `v0.1.0-beta.2` adds an owner-personal Android APK. The
APK is an unsupported sideload build, not a Play Store release or a supported
production surface. There is no security update commitment beyond fixes on
`main`.

## Early access preview

The source preview is for local evaluation and feedback. There is no hosted beta,
no OpenNest account, and no OpenNest server deployment in this release. The
preview is unreviewed software. Do not use it as the only copy of important data
or for sensitive personal or business information.

The Android personal build packages the same web application inside a Capacitor
WebView. It disables cleartext traffic and Android backup and requests only the
INTERNET permission. It does not add a security review, a sandbox guarantee, or a
confidentiality claim. Release APKs are signed outside the repository and
published as unsupported personal artifacts.

No E2EE, AI confidentiality, extension sandbox security, or MCP isolation claim
is made for the preview. The Stage D security review, external cryptographic
review, extension review, AI review, and Stage E gates remain open. See
`docs/early-access.md` and `docs/stage-e-gate-register.md`.

## Reporting a vulnerability

Do not open a public issue for a security problem.

Report it privately to the maintainers through the repository's private
vulnerability reporting channel (GitHub Security Advisories on the project
repository). Include:

- A description of the issue and its impact.
- Steps to reproduce, or a minimal proof of concept.
- The commit or version you tested.
- Any suggested mitigation.

You can expect an acknowledgement within a few days. Please give the maintainers
time to ship a fix before disclosing details publicly.

## Scope

OpenNest is local-first. The highest-risk areas are:

- Anything that reads or writes user files.
- Export and import paths, which handle user data directly.
- Anything that could send user data to an external service without explicit
  consent.
- AI provider credentials and AI network egress, including localhost providers.

## Stage D review status

The canonical internal dossier is
[stage-d-security-review.md](./docs/stage-d-security-review.md). It records
evidence and findings for privacy, backup, SQLite recovery, extensions, AI,
encryption, PWA, CSP, and the self-hosting boundary. It is not an independent
report and does not close the Stage D gate. The source-only early access preview
does not close any Stage D gate. No E2EE, AI confidentiality, or extension sandbox
security claim is approved.

## Cryptography and E2EE status

Optional workspace content encryption is implemented under ADR 0013. It has not
been independently reviewed. OpenNest does not claim end-to-end encryption,
database encryption, or metadata confidentiality at this stage.

The design encrypts note bodies, attached file bytes, encrypted drafts, and
backup v2 payloads. Note titles, filenames, tags, folder names and structure,
sizes, timestamps, and sync metadata remain plaintext. Workspace, backup, and
credential-vault keys are separate domains.

The implementation and required automated tests are complete. The E2EE claim
gate remains open until:

- Rollback and replay protection (R-13-7) is resolved, or the claim explicitly
  excludes sync and says so everywhere.
- The external cryptographic and implementation review passes.
- Documentation and UI copy disclose metadata leakage and key-loss risk.

Report suspected crypto flaws through the private vulnerability channel. Do not
include real passphrases, recovery keys, plaintext notes, or private files in a
report. Use synthetic test data.

## AI provider and credential vault status

The D4B AI provider and credential-vault implementation is complete under ADR 0011. No independent security review has been performed. OpenNest makes no claim
that AI credentials are safe against XSS, that provider traffic is confidential,
or that the vault has been reviewed.

The implementation enforces:

- AI is off by default. No network request occurs before an explicit, one-time,
  payload-bound consent limited to 5 minutes.
- Session-only credentials are the default. The passphrase-encrypted vault is
  optional.
- There is no recovery path for the vault in D4B. Losing the vault passphrase
  loses stored credentials. Workspace recovery and backup restore do not open the
  vault.
- Provider configs, consents, session credentials, and vault records are excluded
  from backup v1 and backup v2.
- The vault uses a separate key domain. Workspace keys, backup keys, and vault
  keys are never interchangeable.
- Vault KDF uses PBKDF2-SHA-256 with a 600,000-iteration floor.
- The vault auto-locks after 5 minutes of inactivity.
- There are no automatic retries. A manual retry requires new consent.
- D4B has no tools, MCP execution, document context, or AI chat history.
- Remote providers require HTTPS. Loopback HTTP is allowed only for explicit
  local providers.
- Production CSP uses
  `connect-src 'self' https: http://localhost:* http://127.0.0.1:*`.
  Chromium rejects IPv6 literals in CSP source lists, so loopback IPv6 is not
  in the policy. The transport and capability grants enforce the exact origin.
- D4B does not complete D4 and does not claim tool-call or MCP support. D4A
  extension remains separate.

### AI residual risks

- The broad CSP `connect-src` allows any HTTPS or loopback origin at the policy
  layer. Exact-origin enforcement depends on application code.
- CORS failures are common for remote providers. OpenNest cannot make a provider
  allow browser origins.
- XSS while the vault is unlocked can steal plaintext credentials or use handles.
  Browser JavaScript cannot provide a perfect secret boundary.
- A provider can retain anything the user sends. Provider-side retention and model
  behavior are outside OpenNest's control.
- JavaScript memory zeroization is not guaranteed. Locking reduces exposure but
  cannot prove that old buffers are erased.
- PBKDF2 is weaker than a memory-hard KDF.
- The vault record can be lost through browser storage eviction.

## Our commitments

- No telemetry and no analytics by default.
- No data leaves the device without an explicit user action.
- Dependencies are pinned, and new dependencies are reviewed for necessity.
- No E2EE claim is made before implementation and external review pass.
