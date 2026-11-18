# Stage D0: Privacy and Extensibility architecture decision pack

- Status: Proposed, pending owner approval
- Date: 2026-11-14
- Scope: architecture analysis and decision records only
- Code changes: none
- ADR range: 0008 to 0013

## 1. Purpose

Stage D0 defines the architecture needed before OpenNest implements the Privacy
Center, permission model, extension platform, AI providers, sync-compatible data
model, and E2EE.

This pack contains:

1. An assessment of the current architecture.
2. Six proposed ADRs.
3. A dependency map.
4. A product conflict register.
5. Risks and gated questions.
6. A recommended D1 to D4 sequence.
7. Stage D acceptance criteria.

No decision in this pack is accepted merely because it is written here. Each ADR
is `Proposed` until the owner approves it.

## 2. Source of truth and constraints

The product direction comes from `PRD.md`, `ROADMAP.md`, `AGENTS.md`, `README.md`,
and the accepted ADRs `0001` to `0007`.

Stage D0 follows these constraints:

- Preserve local-first and offline behavior.
- Do not make cloud, accounts, AI, or extensions mandatory.
- Do not change Stage B contracts without approval.
- Do not implement AI, cloud sync, collaboration, or marketplace features.
- Do not assume the PWA can run local CLI agents.
- Do not create custom cryptographic algorithms.
- Do not claim E2EE before implementation and security review.
- Do not add dependencies.
- Do not change application code in this stage.

## 3. Current architecture assessment

### 3.1 What exists

- One browser adapter instance and one composition root. See
  `apps/web/lib/data/app-data-provider.tsx:54-65` and ADR 0004.
- One default workspace. See `apps/web/lib/data/services.ts:102`.
- Core ports and domain models in `@opennest/core`. See
  `packages/core/src/ports.ts` and `packages/core/src/domain.ts`.
- Dexie and SQLite adapters with a shared conformance suite. See ADR 0003.
- Local backup v1 with base64 blobs. See ADR 0005 and
  `packages/validation/src/backup.ts`.
- PWA shell, offline navigation, and update barrier. See ADR 0006 and
  `scripts/pwa/service-worker.js`.
- Draft journal in localStorage. See ADR 0007 and
  `apps/web/lib/autosave/draft-journal.ts`.
- No server API in the browser stage. See `docs/development.md:223-224`.
- No telemetry and no external AI calls.

### 3.2 Strengths to preserve

- Ports and adapters are separated.
- The conformance suite keeps Dexie and SQLite aligned.
- Restore is fail-closed rather than partial.
- The service worker bypasses authorized, cross-origin, non-GET, and API requests.
- Autosave has a synchronous draft fallback and an update barrier.
- Localization and accessibility are established practices.
- The app already works without an account or network service.

### 3.3 Gaps mapped to ADRs

| Gap                                                                        | Evidence                                                                                          | ADR                        |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------- |
| No trust zones, data classes, or egress rules                              | No consent or flow policy exists                                                                  | 0008                       |
| No permission or capability model                                          | All same-origin code has full local access                                                        | 0009                       |
| No extension execution boundary                                            | No manifest, sandbox, or host API                                                                 | 0010                       |
| No AI provider or credential model                                         | No provider adapters or secret storage                                                            | 0011                       |
| No sync metadata, field revisions, outbox, tombstones, or conflict records | Domain has no device ID, field revision, or outbox                                                | 0012                       |
| No trusted device or server roster                                         | `deviceId` is local only and not an authentication credential                                     | 0012 and a future auth ADR |
| No derived-data or revocation boundary                                     | Permissions and AI can create derived outputs; deletion scope and revocation limits are undefined | 0008                       |
| No encryption or key lifecycle                                             | Notes, drafts, and backups are plaintext                                                          | 0013                       |
| Single workspace, no owner or tenant                                       | `apps/web/lib/data/services.ts:102`                                                               | 0012 and a future auth ADR |
| Backup v1 is plaintext                                                     | ADR 0005 and `packages/validation/src/backup.ts`                                                  | 0013                       |
| Drafts are plaintext in localStorage                                       | ADR 0007 lines 60-62                                                                              | 0013                       |
| SQLite has no server composition root                                      | `docs/adr/0004-stage-c-presentation-and-data-runtime.md:60-62`                                    | 0012 readiness only        |

### 3.4 Architecture risks already visible

- Backup validation is strict at the top level but loose for entity rows.
- Checksum format is validated but checksums are not recomputed during import.
- Note content length is not bounded during backup restore.
- Duplicate note links are not rejected during backup restore.
- Restore does not compare the target workspace kind or schema version.
- Search uses `limit` and `offset`, not a cursor.
- The single-workspace assumption is embedded in the app runtime.
- The draft journal is plaintext.
- SQLite migration and blob rollback behavior need a future self-hosting review.

These are recorded as risks, not silently fixed in Stage D0.

## 4. Decision register

| ADR                                                               | Decision                                                                                                                                                | Status                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| [0008](../../adr/0008-privacy-and-trust-boundaries.md)            | Define trust zones, data classes, derived-data inheritance, consent, egress, and revocation limits                                                      | Proposed                       |
| [0009](../../adr/0009-permission-and-capability-model.md)         | Use capability grants enforced by an application broker                                                                                                 | Proposed                       |
| [0010](../../adr/0010-extension-architecture.md)                  | Use declarative packs and sandboxed code extensions                                                                                                     | Proposed                       |
| [0011](../../adr/0011-ai-provider-and-credential-architecture.md) | Use provider adapters with session-only or encrypted BYOK credentials; the credential vault has its own key hierarchy                                   | Accepted for D4B; D4A separate |
| [0012](../../adr/0012-sync-compatible-data-model.md)              | Add sidecar sync metadata, per-field revisions, replayable outbox, tombstones, and conflict preservation; unresolved questions are implementation gates | Proposed                       |
| [0013](../../adr/0013-e2ee-key-management-strategy.md)            | Use separate workspace E2EE and backup key hierarchies, each with independent recovery and rotation                                                     | Proposed                       |

## 5. Dependency map

```text
0008 Privacy and trust
  -> 0009 Permissions
  -> 0012 Sync-compatible model

0009 Permissions
  -> 0010 Extensions
  -> 0011 AI and credentials
  -> 0012 Sync-compatible model

0012 Sync-compatible model
  -> 0013 E2EE

Future auth and tenant ADR
  -> 0012 trusted device identity, server roster, and canonical revision authority
     (not implemented in D2)

0013 E2EE
  -. shared primitives and envelope conventions only; no key material reuse .->
  0011 AI credential vault (separate hierarchy)

0011 AI and credentials
  -> 0010 AI-powered extensions (optional)
```

There is no circular dependency. ADR 0010 and ADR 0011 can run in parallel after
ADR 0009. ADR 0011 does not wait for ADR 0013 because it owns a separate key
hierarchy and reuses only approved primitives.

The 0013 to 0011 link is not a key dependency. Workspace E2EE, the AI credential
vault, and backup encryption have separate key hierarchies, recovery, rotation,
and trust boundaries. They may share approved primitives, not keys. Workspace
recovery must not open the credential vault. Credential-vault recovery must not
open the workspace. Workspace backups exclude credentials, and the backup DEK is
never a live workspace DEK.

## 6. Product conflict register

Every conflict with a previous product decision is recorded here. None is
resolved unilaterally.

### C-01: Stage D naming conflict

- `AGENTS.md:87` names Stage D "Data Ownership" and lists export, import, backup
  validation, restore, storage usage, and data deletion.
- `ROADMAP.md:86-96` names Phase 4 "Privacy and Extensibility".
- Stage D0 follows the ROADMAP naming for this architecture pack.
- This document does not rewrite `AGENTS.md`.
- Required decision: confirm whether "Stage D" in `AGENTS.md` is renamed or
  whether this work is tracked as Stage D0 before Stage D Data Ownership.

### C-02: Draft storage conflicts with E2EE

- ADR 0007 stores drafts as plaintext in localStorage.
- ADR 0013 cannot claim E2EE while a plaintext draft path exists.
- Recommended resolution: encrypt the draft envelope with the workspace DEK and
  amend ADR 0007.
- Fallback: disable draft recovery in E2EE mode with a clear warning.
- Required decision: accept the amendment and choose the draft behavior.
- ADR 0007 remains in force until the amendment is accepted.

### C-03: Backup default changes with E2EE

- ADR 0005 defines plaintext backup format v1.
- ADR 0013 proposes encrypted backup format v2 as the default when E2EE is on.
- v1 remains importable into a local-only workspace. v2 is additive.
- Backup v2 has its own key hierarchy. Its backup DEK is never a live workspace
  DEK, and its backup recovery key is distinct from the workspace recovery key.
- Restoring v1 into a synced workspace is disallowed until full-resync and
  tombstone reconciliation rules are approved (gate G-12-8).
- Required decision: approve the encrypted default, the plaintext export warning,
  the backup key hierarchy, and the synced-workspace restore boundary.

### C-04: Metadata scope of E2EE

- The PRD says E2EE is a target but does not define whether metadata is encrypted.
- ADR 0013 proposes content-only E2EE first, with names, tags, sizes, and folder
  structure remaining plaintext.
- Required decision: approve metadata leakage disclosure or require metadata
  encryption before any E2EE claim.

### C-05: Sync schema expansion

- ADR 0003 keeps ports in core and adapters separate.
- ADR 0012 adds seven sidecar tables, per-field revision metadata, an immutable
  outbox, a workspace tombstone floor, and conflict records.
- This does not change the ports, but it changes storage schemas and adds
  write-time work.
- Required decision: approve additive migrations and the expanded schema before D2
  implementation.

### C-06: Extension deployment boundary

- ADR 0010 requires an opaque-origin sandbox, not a same-origin iframe.
- This may require a separate origin, CSP changes, or a worker deployment.
- Required decision: approve the deployment and CSP review before D4.

### C-07: Credential backup expectations

- ADR 0011 excludes credentials from backups by default.
- Some users may expect a backup to restore provider access.
- The D4B credential vault has no recovery. Workspace recovery and workspace
  backup restore must not unlock the vault.
- Decision: approved for D4B. Exclude credentials, keep no vault recovery, and
  document that credentials must be re-entered after restore.

### C-08: PBKDF2 versus Argon2

- ADR 0011 and ADR 0013 use PBKDF2 because WebCrypto provides it without a new
  dependency.
- Argon2 is deferred.
- This is a security trade-off, not a product change.
- Required decision: accept the trade-off or approve a dependency review for
  Argon2.

### C-09: Account and tenant model

- The PRD says there is no mandatory account.
- ADR 0012 leaves `ownerId` at the sync boundary, does not introduce auth, and
  treats `deviceId` as non-credential.
- Required decision: a separate authentication and tenant ADR is needed before
  cloud sync, trusted device identity, device revocation, a server roster, or
  canonical workspace revision authority.

### C-10: AI is optional, not absent

- The PRD says AI is optional and configurable.
- ADR 0011 keeps AI disabled by default and requires explicit consent.
- No conflict exists. The product promise is preserved.

### C-11: Key domain separation

- Workspace E2EE, the AI credential vault, and backup encryption are separate key
  domains.
- They may share approved cryptographic primitives and envelope conventions, not
  key material, recovery, or rotation.
- Workspace recovery must not open the credential vault. Credential-vault recovery
  must not open the workspace. Backup restore must not open the credential vault.
- The backup DEK is never a live workspace key. Credentials are excluded from
  backup v1 and v2.
- Required decision: approve independent key hierarchies, recovery, rotation, and
  the cross-domain reuse prohibition.

## 7. Risks and gated questions

| Risk or question                     | Impact                                                   | Recommendation                                                                                                  |
| ------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| E2EE versus local search             | Search must decrypt in memory; no server-side search     | Accept and document                                                                                             |
| Plaintext metadata                   | Names, tags, and folder structure leak                   | Content-only E2EE first with disclosure                                                                         |
| Lost passphrase                      | Data cannot be recovered                                 | Separate recovery policies: workspace and backup recovery keys; no recovery for the D4B vault; no server escrow |
| XSS while unlocked                   | Keys and plaintext can be stolen                         | CSP, sandbox, auto-lock, security review                                                                        |
| Key domain confusion                 | Workspace, vault, or backup keys may be reused           | Separate key hierarchies, key IDs, AAD domains, cross-domain tests                                              |
| Recovery coupling                    | Workspace recovery may open the vault or backup          | Independent recovery and fail-closed tests                                                                      |
| Backup credential leakage            | A backup may include credentials or vault keys           | Exclude credentials, separate backup DEK, test                                                                  |
| Browser credential storage           | Not equivalent to an OS keychain                         | Session-only default, optional vault with its own hierarchy                                                     |
| Extension sandbox                    | A misconfigured sandbox can leak data                    | Opaque origin, CSP, escape tests                                                                                |
| Sync metadata leakage                | Device activity can be inferred                          | Minimize, document, review                                                                                      |
| Derived data retention               | Derived summaries or indexes may outlive source deletion | Inherit source class; delete with source                                                                        |
| Revocation scope                     | Revocation cannot recall data already received           | Stop future flows and disclose the boundary                                                                     |
| Outbox and conflict payloads         | They may contain sensitive content                       | Encrypt under E2EE; never log                                                                                   |
| Outbox retention                     | The outbox may grow without bound                        | G-12-1 bounded policy before writes are enabled                                                                 |
| Tombstone compaction                 | Stale devices may be forced to full resync               | G-12-2 floor, acknowledgement, bounded retention                                                                |
| Field metadata write cost            | More rows and writes on large workspaces                 | Measure before D2 sign-off                                                                                      |
| Workspace revision authority         | A local counter is not a global order                    | G-12-7 server authority or per-device vector before sync                                                        |
| Device identity trust                | `deviceId` alone is not authentication                   | G-12-5 future auth ADR; fail closed                                                                             |
| Conflict UX                          | Users may be confused                                    | G-12-4 conflict copies, not silent overwrite                                                                    |
| Tombstone growth                     | Storage increases                                        | G-12-2 retention window and acknowledgements                                                                    |
| Backup restore into synced workspace | Deleted IDs may be resurrected                           | G-12-8 full-resync and tombstone reconciliation                                                                 |
| MCP and Local Bridge                 | PWA cannot run local CLI agents                          | Treat as external integrations                                                                                  |
| AGPL and extensions                  | Licensing boundary is unclear                            | Legal review before SDK                                                                                         |
| PBKDF2 strength                      | Weaker than memory-hard KDFs                             | High parameters, versioning, future review                                                                      |
| SQLite server runtime                | No self-hosted composition root yet                      | Separate deployment ADR                                                                                         |
| Permission prompt fatigue            | Poor usability                                           | Built-in local grants, prompt only for external                                                                 |
| Stage D naming                       | Planning and documentation drift                         | Resolve C-01 before D1                                                                                          |

## 8. Recommended D1 to D4 sequence

### D1: Trust and capability foundation

- Accept ADR 0008 and ADR 0009.
- Add the trust policy, data inventory, derived-data inventory, and cross-zone flow
  matrix.
- Add the capability catalog, grant registry, revocation, and broker.
- Add a local audit log without content.
- Add the Privacy Center shell for storage usage, data inventory, export, delete,
  consent history, and grants.
- Add revocation disclosure copy and deletion coverage for derived data.
- No AI, extension, sync, or E2EE implementation.
- Gate: Stage C features still work offline with built-in grants, no new network
  egress, and localization plus tests pass.

### D2: Sync-compatible data model

- Accept ADR 0012.
- Add device ID, device registry, sync metadata, per-field metadata, replayable
  outbox, workspace sync state, tombstones, and conflict records.
- Add Dexie and SQLite migrations with atomic backfill.
- Add a conflict simulation harness for merge-safe, content, clock-skew, replay,
  and stale-device cases.
- Keep backup v1 compatible.
- No network sync, authentication, server roster, device trust, or global
  workspace revision authority.
- Gate: both adapters pass conformance; migrations and rollback injection pass;
  field-level merge never claims unsupported LWW; content conflicts are preserved;
  no global workspace revision claim is made; no Stage B contract is broken.

### D3: E2EE key management

- Accept ADR 0013.
- Implement workspace key setup, unlock, DEK, fresh per-write CEK, workspace
  recovery key, and workspace rotation.
- Implement the separate backup key hierarchy for backup v2.
- Encrypt notes, blobs, drafts, and backup v2.
- Add plaintext-to-encrypted migration.
- Add the threat model and external security review.
- No credential vault in D3.
- Gate: every claimed path is encrypted, default backups and drafts have no
  plaintext path, workspace and backup keys are separate, backup v2 excludes
  credentials, the review passes, and no public claim is made before the gate.

### D4A: Extension platform

- Accept ADR 0010.
- Extension: manifest, sandbox host, sideload, capability grants, kill switch,
  and audit.
- Separate workstream and gate from D4B.
- Extension code never receives credential handles or raw secrets.

### D4B: AI provider and credential vault

- ADR 0011 is accepted for D4B as of 2026-11-17.
- AI: provider registry, session-only credentials, optional credential vault with
  its own key hierarchy, one-time payload-bound consent, local provider, and mock
  provider tests.
- No tools, MCP execution, document context, or AI chat history.
- No automatic retries. A manual retry needs new consent.
- Gate: AI is off by default; no network before consent; no secret in logs or
  backups; workspace recovery cannot open the vault and the vault passphrase
  cannot open the workspace; tools and MCP are rejected; exact-origin enforcement
  and CSP tests pass.

## 9. Stage D acceptance criteria

These criteria cover the Stage D0 proposal and all revision passes.

- Six ADRs `0008` to `0013` are accepted and linked.
- No Stage B contract is changed without a separate ADR or approval.
- Local-only mode works offline without an account, cloud, AI, or extension.
- The Privacy Center shows storage usage, data inventory, export, delete, consent
  history, and permission grants.
- Capability grants are enforceable, revocable, and not UI-only.
- Extensions run in a sandbox without direct storage, DOM, or credential access.
- AI is optional, off by default, and performs no network request before consent.
- D4B consent is one-time, payload-bound, and limited to 5 minutes. There are no
  automatic retries.
- The D4B vault auto-locks after 5 minutes and has no recovery.
- D4B rejects tools and MCP and makes no tool-call claim.
- Production CSP allows HTTPS and loopback HTTP; exact-origin enforcement is
  app-level.
- Credentials are session-only or encrypted and never plaintext in localStorage,
  logs, or backups.
- Workspace E2EE, the AI credential vault, and backup encryption have separate key
  hierarchies, recovery, rotation, and trust boundaries.
- Workspace recovery cannot open the credential vault. Credential-vault recovery
  cannot open the workspace. Backup restore cannot open the credential vault.
- Workspace, vault, and backup keys are not interchangeable. The backup DEK is
  never a live workspace DEK, and backups exclude credentials.
- Device registry, field metadata, outbox, tombstones, and conflict records exist
  without network sync.
- Outbox is replayable, locally ordered, and idempotent; content conflicts are
  preserved.
- ADR 0012 implementation gates G-12-1 to G-12-8 have a stage and exit criterion.
- No global cross-device revision or tombstone claim is made in D2.
- Derived data inherits source classification and deletion scope; revocation limits
  are disclosed.
- No trusted-device or server-roster claim is made without a future auth ADR.
- Backup v1 remains compatible. Encrypted backup v2 is available when E2EE is on.
- E2EE is not claimed before implementation, migration, and security review.
- No custom cryptographic algorithm is used.
- Typecheck, lint, unit, integration, conformance, build, and E2E tests pass.
- Documentation, ADRs, and UI localization are updated.
- No new dependency is added without approval.
- Mobile behavior is verified.
- Unresolved critical risks are reported, not hidden.

## 10. Approval gate

Approval is required for:

1. C-01 Stage D naming.
2. C-02 draft encryption amendment.
3. C-03 encrypted backup default and synced-workspace restore boundary.
4. C-04 metadata scope of E2EE.
5. C-05 additive sync migrations.
6. C-06 sandbox deployment boundary.
7. C-07 credential backup exclusion.
8. C-08 PBKDF2 trade-off.
9. C-09 future authentication and tenant ADR.
10. ADR 0008 derived-data inheritance and revocation boundary.
11. ADR 0012 expanded sidecar schema, per-field revisions, replayable outbox,
    tombstone floor, conflict records, the D2 local-only revision boundary, and
    gates G-12-1 to G-12-8.
12. C-11 key domain separation: workspace E2EE, credential vault, and backup
    hierarchies, independent recovery and rotation, and the cross-domain reuse
    prohibition.
13. ADR 0008 to ADR 0013 as a set.

ADR 0010 and ADRs 0008, 0009, 0012, and 0013 remain `Proposed`. ADR 0011 is
accepted for D4B only; D4A remains separate and unapproved.

## 11. Security refinement pass 1

Applied on 2026-11-14 to ADR 0009, ADR 0010, ADR 0011, and ADR 0013. ADR 0008 and
ADR 0012 were reviewed and left unchanged in pass 1.

### What changed

- ADR 0009 adds trusted principal binding, exact scopes, capability handles, fail
  closed enforcement, revocation semantics, high-risk confirmation, grant TTL,
  audit hash chaining, prompt integrity, and abuse limits.
- ADR 0010 requires an opaque-origin sandbox, restrictive CSP, authenticated IPC,
  host-mediated network egress, scoped host APIs, full-package manifest integrity,
  permission revalidation, resource limits, storage isolation, and UI separation.
- ADR 0011 requires vaulted credentials, endpoint validation, payload-bound
  consent, no hidden context, untrusted model output, request hygiene, log
  redaction, a localhost warning, and a per-tool MCP trust boundary.
- ADR 0013 requires an unambiguous envelope, fresh per-write CEKs, AAD binding,
  KDF hardening, checksummed recovery keys, authenticated device enrollment,
  rollback protection, backup key separation, fail-closed migration, and crypto
  agility.

### Additional approvals

These are added to the approval gate above:

1. Capability handles, grant TTL, high-risk confirmation, and the audit hash chain
   in ADR 0009.
2. Host-mediated extension network egress and the separate-origin sandbox in ADR 0010.
3. Payload-bound AI consent and localhost warning are accepted for D4B; per-tool
   MCP grants are deferred.
4. Fresh per-write CEKs, the 600,000-iteration PBKDF2 floor, checksummed recovery
   keys, device pairing, rollback protection before any E2EE claim, and backup v2
   key separation in ADR 0013.

The D4B-applicable ADR 0011 refinements are accepted; per-tool MCP grants are
deferred. The ADR 0009, 0010, and 0013 refinements remain `Proposed` and do not
authorize implementation.

## 12. Targeted revision pass 2

Applied on 2026-11-14 to ADR 0008 and ADR 0012 only. ADR 0009, ADR 0010, ADR
0011, and ADR 0013 remain unchanged.

### ADR 0008

- Derived data inherits the source data class and retention.
- Deletion and export cover derived data, with an inventory.
- Audit logs are metadata-only and redacted.
- Revocation stops future operations and flows, not data already received.
- UI and documentation must disclose the revocation boundary.

### ADR 0012

- Per-field revision metadata replaces entity-level LWW for fields.
- The sidecar schema adds `sync_devices`, `sync_meta`, `sync_field_meta`,
  `sync_outbox`, `workspace_sync_state`, `sync_tombstone`, and `sync_conflict`.
- Entity, metadata, and outbox writes are one transaction across both adapters.
- The outbox stores immutable field patches with `opId`, payload hash, causal base
  revisions, local ordering, retry, and idempotency.
- Network retry retransmits the stored payload; a content rewrite is a new
  operation with a fresh CEK.
- Tombstones use a workspace revision floor and device acknowledgement. D2 is
  local-only; stale devices full resync and deleted IDs are never recreated.
  Cross-device revision authority is gate G-12-7.
- Content conflicts are preserved in `sync_conflict`; merge-safe fields use
  deterministic resolution.
- Outbox and conflict payloads are content, not plaintext metadata, and must be
  encrypted under E2EE.
- These questions are implementation gates G-12-1 to G-12-8, not settled
  behavior: retention, stale threshold, exact merge-safe fields, conflict UX,
  trusted device identity, clock skew, workspace revision authority, and backup
  v1 restore into a synced workspace.

### Additional approvals

1. ADR 0008 derived-data inheritance, export/delete inventory, and revocation
   boundary disclosure.
2. ADR 0012 sidecar schema, per-field revisions, atomic outbox, tombstone floor,
   conflict preservation, and the D2 local-only revision boundary.

These refinements remain `Proposed` and do not authorize implementation.

## 13. Final architecture consistency check

Applied on 2026-11-14 to ADR 0011, ADR 0013, and this pack. ADR 0012 received
implementation-gate labels only. ADR 0008, ADR 0009, and ADR 0010 were reviewed
and left unchanged. No application code, Stage B contract, or dependency changed.

### Key domain separation

Workspace E2EE, the AI credential vault, and backup encryption are separate key
domains. They may share approved primitives and envelope conventions, not keys.

| Domain              | Root key source                                | Wrapped keys                                 | Owner                           | Recovery                    | Rotation                                                    | Cannot open                 |
| ------------------- | ---------------------------------------------- | -------------------------------------------- | ------------------------------- | --------------------------- | ----------------------------------------------------------- | --------------------------- |
| Workspace E2EE      | Workspace passphrase or workspace recovery key | Workspace KEK, workspace DEK, workspace CEKs | Workspace E2EE subsystem        | Workspace recovery key only | Workspace passphrase change; workspace DEK and CEK rotation | Credential vault, backup    |
| AI credential vault | Vault passphrase                               | Vault KEK, vault DEK, entry CEKs             | AI credential subsystem         | No recovery in D4B          | Vault passphrase change; vault DEK and entry CEK rotation   | Workspace, backup           |
| Backup encryption   | Backup passphrase or backup recovery key       | Backup KEK, backup DEK                       | Backup subsystem under ADR 0013 | Backup recovery key only    | Fresh backup DEK per backup; re-export or rewrap            | Live workspace, credentials |

### Non-interchangeability rules

- No key domain is another domain's KEK, DEK, or CEK.
- Workspace recovery does not open the credential vault. Credential-vault
  recovery does not open the workspace.
- Backup recovery opens only that backup file. It does not open live workspace
  storage or the credential vault.
- The backup DEK is never installed as a live workspace key.
- Backup v1 and backup v2 exclude credentials by default.
- Shared primitives use separate salts, domain separation, key IDs, and AAD.
- The dependency map records shared primitives only. It does not create a
  workspace-to-vault or workspace-to-backup key dependency.

### ADR 0012 implementation gates

ADR 0012 now labels every previously unresolved question as G-12-1 to G-12-8 with
a stage and exit criterion. D2 may proceed with local preparation while G-12-5,
G-12-7, and G-12-8 remain open. The related remote-sync, distributed-ordering, and
restore-into-synced-workspace features remain disabled.

### Additional approvals

1. ADR 0011 credential vault hierarchy, no D4B vault recovery, rotation, and the
   prohibition on cross-domain key reuse.
2. ADR 0013 workspace versus backup key hierarchy, distinct backup recovery key,
   backup DEK exclusion from live keys, and credential exclusion.
3. C-11 and the key-domain matrix above.
4. ADR 0012 implementation gates G-12-1 to G-12-8.

ADR 0011 is accepted for D4B as recorded in section 14. The other refinements
remain `Proposed` and do not authorize implementation.

## 14. D4B approval record

Accepted on 2026-11-17 for the D4B AI track only. D4A extension remains separate
and unapproved.

Approved decisions:

- Session-only credentials are the default. The passphrase-encrypted vault is
  optional.
- D4B has no recovery for the vault. Losing the vault passphrase loses stored
  credentials.
- Provider configs, consents, session credentials, and vault records are excluded
  from backup v1 and backup v2.
- The credential vault uses a separate key domain.
- PBKDF2-SHA-256 uses a 600,000-iteration floor.
- Consent is one-time, payload-bound, and limited to 5 minutes. There are no
  automatic retries.
- The vault auto-locks after 5 minutes of inactivity.
- D4B has no tools, MCP execution, document context, or AI chat history.
- Production CSP uses
  `connect-src 'self' https: http://localhost:* http://127.0.0.1:* http://[::1]:*`.
  The transport and capability grants enforce the exact origin.
- D4B does not complete D4 and makes no tool-call claim.

The implementation gate and residual risks are in ADR 0011,
`docs/ai-provider-architecture.md`, `docs/credential-vault.md`,
`docs/ai-security-review.md`, and `SECURITY.md`.
