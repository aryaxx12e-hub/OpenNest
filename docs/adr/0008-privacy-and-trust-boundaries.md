# ADR 0008: Privacy and trust boundaries

- Status: Accepted
- Date: 2026-11-14
- Context: Stage D0 Privacy and Extensibility
- Related: ADR 0004, ADR 0005, ADR 0006, ADR 0007
- Product conflict: none
- Targeted revision: pass 2 applied 2026-11-14

## Context and problem

OpenNest is a local-first application with no server API in the browser stage.
Future work adds optional AI providers, external storage, self-hosted sync,
OpenNest Cloud, MCP integrations, and extensions. Each of those features crosses
a trust boundary. The current architecture does not define those boundaries, the
data classes that cross them, or the consent required before a crossing happens.

Without a central model, privacy depends on each feature's implementation. That
is not auditable and makes silent data egress possible.

## Goals

- Define trust zones and data classes for the whole product.
- Keep local-only behavior as the default.
- Require explicit, purpose-bound consent for every external flow.
- Define handling rules for content, metadata, secrets, caches, logs, and backups.
- Give reviewers a checklist for future integrations.

## Non-goals

- Implement the Privacy Center.
- Implement encryption or sync.
- Add telemetry or analytics.
- Define a legal compliance program.

## Constraints

- No mandatory account, cloud service, or AI provider.
- No external AI request by default.
- No document upload to a third party without explicit consent.
- No telemetry.
- The existing PWA cache policy must remain fail-closed.
- This ADR changes no Stage B port or schema contract.

## Alternatives considered

1. Decide privacy separately for each feature. Rejected because it produces
   inconsistent behavior and hidden egress.
2. Maintain one static policy document without enforceable boundaries. Rejected
   because it cannot guide implementation or review.
3. Define layered trust zones, data classes, and a flow matrix. Recommended.
4. Use a server-centric security perimeter. Rejected because OpenNest must work
   without a server and must remain local-first.

## Decision

### Trust zones

| Zone | Meaning                                                                                   | Default trust                                                             |
| ---- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Z0   | Device and operating system                                                               | Trusted base, outside application control                                 |
| Z1   | Local browser origin, including the app and its service worker                            | Trusted for local data, not for protecting long-lived secrets against XSS |
| Z2   | User-authorized external service, such as an AI provider, external storage, or MCP server | Untrusted by default                                                      |
| Z3   | OpenNest Cloud or a self-hosted OpenNest server                                           | Untrusted for plaintext content unless E2EE is active                     |
| Z4   | Extension sandbox                                                                         | Untrusted code                                                            |

### Data classes

| Class | Examples                                                                    | Default handling                                             |
| ----- | --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| D0    | Public application assets                                                   | Public                                                       |
| D1    | Metadata: folder names, tags, timestamps, sizes, workspace name             | Local by default                                             |
| D2    | User content: notes, file bytes, extracted text                             | Local by default                                             |
| D3    | Secrets: credentials, capability grants, key material                       | Isolated, never in content storage, logs, or default backups |
| D4    | Derived sensitive data: AI prompts, embeddings, search snippets, audit logs | Local unless explicitly authorized                           |
| D5    | Backups                                                                     | Inherit the highest class of their contents                  |

### Derived data classification

- Prompt, embedding, snippet, cache, search index, and other derived data inherit
  the classification and retention policy of their source data.
- Deleting source data must delete related derived data. A derived artifact that
  cannot be rebuilt must be classified and retained explicitly.
- Export and data inventory must state whether derived data is included. An
  exclusion must be visible, not silent.
- Audit logs must not store sensitive content without an explicit need and
  retention policy. The default is metadata-only and redacted.

### Flow rules

- Default deny for data leaving Z1.
- Every flow declares source, destination, data class, purpose, retention,
  consent, and revocation path.
- Consent is specific to a purpose and a provider. It is not bundled with an
  unrelated action.
- Send the minimum necessary content. Whole-library upload is never implicit.
- No background upload, silent indexing, or third-party request by default.
- Credentials never enter the content zone.
- Logs are redacted and never contain content or secrets.
- PWA caches never store authorized, private, or cross-origin responses.
- E2EE reduces trust in Z3 for encrypted content. It does not protect metadata
  that remains plaintext.
- Extensions never receive direct storage, DOM, network, or credential access.
  They receive mediated capabilities.
- Revocation stops future operations and data flows for the revoked grant.
- Revocation does not guarantee deletion or recall of data already received by an
  external party. UI and documentation must state this boundary before consent.

## Trade-offs

- Consent screens add friction to some future features.
- Requiring a flow declaration slows integration work.
- Data classification must be maintained as the product grows.
- Local-first behavior cannot protect against a compromised device or browser.

## Security and privacy implications

- XSS while the application is unlocked remains a serious threat.
- Metadata leakage is possible even when content is encrypted.
- Supply-chain review is required for every external service and extension.
- A malicious or compromised provider can retain anything the user sends.
- Derived data can leak source content if its classification or deletion policy
  is weaker than the source.
- Revocation cannot recall data that an external party already received.

## Compatibility with Stages A to C

- No domain model, port, or adapter change is required.
- The ADR clarifies the existing boundaries in ADR 0004, ADR 0005, ADR 0006,
  and ADR 0007.
- Existing local features remain available without new consent prompts.

## Dependencies

- This ADR is foundational. ADR 0009 through ADR 0013 depend on it.

## Migration implications

- No user data migration.
- A future consent registry and local audit log should use separate tables.
- Existing local features receive built-in local grants under ADR 0009.

## Conflicts and decisions requiring approval

- No product conflict is introduced by this ADR.
- The Stage D name conflict between `AGENTS.md` and `ROADMAP.md` is tracked in
  the Stage D0 decision pack, not resolved here.

## Acceptance criteria

- A threat model and data inventory exist.
- A cross-zone flow matrix exists.
- Every future integration declares its data classes and consent behavior.
- Derived data inherits source classification, retention, deletion, export, and
  inventory behavior.
- Audit logs are metadata-only unless an explicit sensitive-content policy exists.
- A review checklist exists for network egress and secret handling.
- No unconsented network path is introduced.
- Revocation behavior and its limits are documented in UI and documentation.

## Testing strategy

- Static network egress audit.
- CSP and service worker tests.
- Derived data deletion and export tests.
- Audit log redaction tests.
- Policy unit tests when the consent registry exists.
- Revocation boundary copy review.
- Privacy review before each integration.
