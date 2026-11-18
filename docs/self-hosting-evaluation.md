# Self-hosting evaluation

- Status: Complete for Stage D
- Date: 2026-11-18
- Context: Stage D Privacy, Security, and Extensibility
- Related: ADR 0003, ADR 0004, ADR 0008, ADR 0012, ADR 0013, ADR 0014,
  ADR 0015
- Decision record: `docs/adr/0015-self-hosting-boundary.md`

## Purpose

This document evaluates whether OpenNest can support a self-hosted deployment,
which model is eligible for later work, and which controls must exist before any
server code is written. It is an architecture evaluation, not an implementation
approval.

## Requirements

A self-hosted deployment must preserve the product constraints:

- Local-first remains the default. A server is optional and never required to use
  the application.
- No mandatory account. A single-user deployment must not depend on a hosted
  identity provider.
- SQLite remains the server storage adapter, with a filesystem blob root.
- Backup, restore, export, delete-all, and storage status must remain available.
- E2EE is optional. When active, the server must not receive plaintext content or
  key material.
- The deployment must not weaken the trust boundaries in ADR 0008.
- The browser application must continue to work without the server.

A self-hosted server is not a second product with a different data model. It must
use the same ports, entities, validation, and backup formats as the local
application.

## Deployment models

| Model                                 | Stage D status | Notes                                                                                                                      |
| ------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Static PWA with browser storage       | Supported      | Current product. No server API.                                                                                            |
| Single-user Node server with SQLite   | Candidate      | Eligible for Stage E design. Requires the controls below.                                                                  |
| Container or reverse-proxy deployment | Candidate      | Only a packaging choice for the single-user model. TLS, proxy headers, and filesystem permissions need an explicit design. |
| Public multi-user service             | Not approved   | Requires authentication, tenant isolation, a multi-user threat model, and a collaboration security review.                 |
| Hosted OpenNest Cloud                 | Not approved   | Outside this evaluation. Needs its own product, security, and operations decision.                                         |

The static PWA remains the only supported deployment in Stage D. The
single-user server is the only self-hosted model that Stage E may design first.

## Composition root

A server must have a separate composition root:

- An HTTP layer that validates requests, authenticates the operator, and maps
  domain errors to responses.
- The existing SQLite adapter with a filesystem blob root.
- The existing domain services and repositories.
- No Dexie, IndexedDB, service worker, or browser-only API on the server.
- No server API, route handler, or background daemon in Stage D.

The browser composition root in ADR 0004 must not be reused as a server root.
Sharing the UI contracts is acceptable; sharing a runtime that assumes browser
storage is not.

## Required controls before implementation

The following controls are prerequisites, not follow-up work:

- Authentication for every non-health endpoint, including a single-user
  deployment. A localhost bind is not an authentication model.
- Authorization checks on every object read and write. Object identifiers must
  not be treated as capabilities.
- Tenant isolation if more than one user, workspace, or trust domain can exist.
  A single-user server must reject a second identity, not merely hide it in the
  UI.
- TLS termination with secure cookies, HSTS, and an explicit trusted-proxy
  policy.
- CSRF protection for state-changing requests, including same-site cookie rules.
- Request size limits, upload size limits, pagination limits, and rate limits.
- A strict Content Security Policy and safe response headers, including
  `X-Content-Type-Options: nosniff`.
- Safe file serving with an explicit content type, `Content-Disposition`, no
  inline execution of active content, and no path traversal.
- Audit logging with redacted metadata only. Content, credentials, and key
  material must never enter logs.
- Keyring handling that keeps workspace, credential-vault, and backup key
  domains separate, consistent with ADR 0013.
- A documented backup, restore, migration, and rollback procedure.
- A documented delete-all procedure that removes database rows, blobs, caches,
  and derived data.

Uploaded files must never be executed. File type checks cannot rely on the
extension alone. HTML, SVG, and other active content need an explicit serving
policy.

## Data lifecycle

A server adds lifecycle questions that the browser product does not answer alone:

- **Backup:** who runs it, where it is stored, whether it is encrypted, and how
  restore is tested.
- **Restore:** how a backup is validated before it replaces live data, and how a
  failed restore is rolled back.
- **Migration:** how schema upgrades are applied, whether a downgrade is
  possible, and what happens when a migration fails.
- **Delete-all:** how the operator confirms deletion of rows, blobs, temporary
  files, caches, and derived data.
- **Keyring:** where wrapped keys live, how the operator unlocks them, and what
  happens when the keyring is lost.
- **Encrypted blobs:** whether file bytes are encrypted before they reach the
  blob root, and how metadata remains visible.
- **Metadata leakage:** titles, filenames, tags, folder names, sizes, timestamps,
  and sync metadata remain plaintext under the current content-encryption design.
  A self-hosted operator and anyone with filesystem access can see them.

E2EE reduces what the server can read. It does not make the server trusted with
metadata, availability, or deletion. The E2EE claim gate remains open until
R-13-7 and external review are resolved.

## Operations

A supported self-hosted deployment needs an operations contract:

- Node.js 24 or newer, matching the repository floor and `node:sqlite`.
- SQLite in WAL mode with a busy timeout. The current adapter uses a 5-second busy
  timeout.
- One writer process per database and blob root. Startup reconciliation reads
  every referenced blob key and removes unreferenced blobs and stale temporary
  files. That cleanup is not safe under concurrent writers without additional
  locking.
- Filesystem permissions that restrict the database, blob root, keyring, and
  backups to the service account.
- Backup retention and a tested restore drill.
- Upgrade and rollback steps, including a pre-upgrade backup.
- Observability limited to health, error rate, latency, and redacted metadata.
- Rate limits and resource limits to prevent a single client from exhausting the
  process.
- A public exposure checklist that covers TLS, proxy headers, firewalls, and
  secret management.

The current adapter is a library, not a server runtime. It has no HTTP listener,
process supervisor, deployment manifest, or multi-process coordination.

## Multi-process risk

Startup reconciliation currently assumes one writer process per database and blob
root. Two writers can race while one scans blobs and the other uploads a new file.
A server that runs multiple workers, a clustered process manager, or multiple
containers against the same volume must define locking, leadership, or a shared
reconciliation service before deployment.

This evaluation does not approve a multi-process claim. The single-user model is
single-process unless a later design adds a safe coordination layer.

## Decision

A single-user, single-tenant self-hosted server is a candidate for Stage E. A
public multi-user deployment is not approved. Stage D implements no server.

## Open gates

- Authentication and authorization design.
- Tenant isolation and multi-user threat model, if multi-user is ever proposed.
- TLS, proxy, cookie, CSRF, CSP, rate-limit, and audit design.
- Keyring and encrypted-blob storage design.
- Backup, restore, migration, rollback, and delete-all runbooks.
- Multi-process locking or an explicit single-process deployment constraint.
- The Stage D security review, external cryptographic review, and E2EE claim
  gate.

None of these gates is closed by this document. ADR 0015 records the boundary
only.
