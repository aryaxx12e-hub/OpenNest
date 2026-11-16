# ADR 0009: Permission and capability model

- Status: Accepted
- Date: 2026-11-14
- Context: Stage D0 Privacy and Extensibility
- Related: ADR 0008, ADR 0010, ADR 0011, ADR 0012, ADR 0013
- Product conflict: none
- Security refinement: pass 1 applied 2026-11-14

## Context and problem

Every current OpenNest feature runs in the same browser origin with full access to
local storage. That is acceptable while all code is first-party and no external
integration exists. It is not acceptable for extensions, AI providers, external
storage, or sync targets.

OpenNest needs a permission model that limits what an integration can read or do,
shows the user what is being requested, and supports immediate revocation.

## Goals

- Define principals, capabilities, scopes, grants, and revocation.
- Enforce permissions at a service boundary, not only in the UI.
- Keep core local features usable without permission prompts.
- Make every external and extension capability explicit.

## Non-goals

- Implement operating-system permissions.
- Implement an OAuth authorization server.
- Build the complete Privacy Center in this ADR.
- Treat browser-level isolation as optional.

## Constraints

- Browser same-origin JavaScript cannot be fully sandboxed by application checks.
- No custom cryptography for capability tokens.
- No new dependency is required by this ADR.
- Existing local features must continue to work offline.
- No cloud dependency.

## Alternatives considered

1. App-level toggles such as "allow network". Rejected because they are too coarse.
2. OAuth-style scopes only. Rejected because local resources are not OAuth
   resources and the app must work without an account.
3. Capability model with resource scopes, explicit grants, and a broker.
   Recommended.
4. Operating-system permission passthrough. Rejected because it is not portable
   and is not available to the PWA.

## Decision

### Principals

- Built-in feature.
- Extension.
- AI provider adapter.
- Sync target.
- External storage adapter.
- User.

### Capability families

| Capability                     | Scope                                           |
| ------------------------------ | ----------------------------------------------- |
| `workspace.read.metadata`      | Workspace, folder subtree, or selected entities |
| `workspace.read.content`       | Selected notes, files, or extracted text        |
| `workspace.write`              | Create, update, or move selected entities       |
| `workspace.export`             | Export selected entities or a backup            |
| `workspace.delete`             | Delete selected entities                        |
| `network.connect:<origin>`     | One explicitly allowed origin                   |
| `credential.use:<provider-id>` | One provider credential                         |
| `ai.invoke:<provider-id>`      | One AI provider                                 |
| `sync.push`                    | Upload changes for one workspace                |
| `sync.pull`                    | Download changes for one workspace              |

Resource scopes are workspace, folder subtree, specific note IDs, or specific file
IDs. A capability without a resource scope is invalid.

### Grant lifecycle

1. A principal requests a capability with a purpose.
2. The UI explains the request in plain language and shows the data involved.
3. The user grants or denies it.
4. The grant is used through the capability broker.
5. The user can revoke it at any time.

Grant attributes:

- Principal.
- Capability.
- Resource scope.
- Purpose.
- Creation time.
- Expiry.
- Maximum uses, when applicable.
- Session-only flag.
- Status.
- Audit reference.

### Enforcement

- Deny by default.
- Least privilege.
- Core local features receive built-in grants at install time.
- New external capabilities require explicit user consent.
- The capability broker sits at the application service boundary.
- Capability identifiers are opaque references, not bearer secrets.
- The UI is not an enforcement point.
- Every grant and denial is recorded in a local audit log without content.
- Revocation propagates to running operations.

## Security refinement pass 1

This pass tightens the proposed model. It does not change the product promise of
local-first operation or optional external integrations.

### Threat model additions

- Caller impersonation and confused-deputy requests.
- Grant theft, replay, or reuse outside its intended scope.
- Scope expansion through wildcards, path traversal, or origin confusion.
- Malicious extensions drawing trusted-looking permission prompts.
- Revocation races and stale cached data.
- Audit log tampering or accidental secret leakage.
- Prompt flooding and bulk-operation abuse.

### Required controls

1. **R-09-1, trusted principal binding.** The broker derives the caller principal
   from runtime context. It never accepts a principal, role, or trust flag from
   the request payload. A caller cannot self-assert that it is a built-in feature.
2. **R-09-2, exact scopes.** Normalize origins to scheme, host, and port. Reject
   wildcards, path traversal, empty scopes, and ambiguous resource selectors.
   HTTP is allowed only for loopback development endpoints. A network grant is
   valid only for the final origin after redirects.
3. **R-09-3, capability handles.** Capability identifiers are opaque handles
   bound to the principal, grant, resource scope, session, and expiry. They are
   not bearer secrets, are not placed in URLs or DOM attributes, and are never
   written to logs.
4. **R-09-4, fail closed.** Unknown, malformed, expired, revoked, or mismatched
   grants are denied. A broker error denies the request. There is no fallback to
   a broader built-in grant.
5. **R-09-5, revocation semantics.** Revocation cancels in-flight operations,
   invalidates cached results for the revoked scope, and records an audit entry.
   A principal cannot continue using a handle issued before revocation.
6. **R-09-6, high-risk confirmation.** `workspace.export`, `workspace.delete`,
   and `credential.use` require a recent explicit confirmation that shows the
   exact scope and affected item count. Bulk wildcard operations are denied.
7. **R-09-7, grant lifetime.** Persistent grants have a default TTL and a maximum
   TTL. Session grants are cleared on lock, reload, principal change, or explicit
   session end. Very broad scopes are not persistent by default.
8. **R-09-8, audit integrity.** The local audit log is append-only, contains no
   content or secrets, and uses a SHA-256 hash chain for tamper evidence. This is
   a diagnostic control, not a boundary against same-origin XSS.
9. **R-09-9, prompt integrity.** Only trusted host UI can render permission
   prompts. Extensions cannot draw, cover, or modify a prompt, and the prompt
   must show the extension identity and concrete resources.
10. **R-09-10, abuse limits.** The broker rate-limits permission requests,
    capability calls, and bulk operations. Exhausted quotas fail closed and are
    audited.

### Residual risks

- Same-origin XSS can modify the grant store and the audit chain. Application
  checks cannot fully defend against a compromised origin.
- A local attacker with browser-storage access can tamper with grants.
- A user can still approve an overly broad scope. The UI must show concrete data,
  not only capability names.
- Browser quota and storage eviction can interrupt revocation bookkeeping.

### Refinements requiring approval

- R-09-3, R-09-4, R-09-5, R-09-6, and R-09-7 change permission UX and grant
  persistence behavior. They strengthen the product promise but still require
  approval because users will see new confirmations and expiry behavior.
- R-09-8 introduces a local audit hash chain. It is not a new product feature but
  adds storage and maintenance.

## Trade-offs

- Broker and grant storage add complexity.
- Fine-grained scopes can create prompt fatigue.
- Grant migration and stale-grant cleanup need maintenance.
- User-facing explanations must be localized and understandable.

## Security and privacy implications

- A confused-deputy bug in the broker can grant more access than intended.
- Stale grants can silently retain access.
- Same-origin XSS can bypass JavaScript-level checks. Extension code must run in
  a sandbox and credentials must remain isolated.
- Grant identifiers must not be usable as authentication secrets.

## Compatibility with Stages A to C

- Additive application layer.
- Core ports remain permission-agnostic.
- Existing Stage C features continue with built-in local grants.
- No database contract is changed by this ADR.

## Dependencies

- ADR 0008.
- ADR 0010, ADR 0011, and ADR 0012 consume this model.
- ADR 0013 uses it for key and credential access.

## Migration implications

- New local permission store.
- Existing features receive built-in grants.
- New external capabilities default to denied.
- Grant records are local and excluded from default backups unless explicitly
  requested in a future backup format.

## Conflicts and decisions requiring approval

- No product conflict is introduced by this ADR.
- The exact default scopes for each built-in feature must be approved during D1.
- Grant export and backup behavior is left open because backup v1 has no
  permission section.

## Acceptance criteria

- Capability catalog and principal matrix exist.
- Grant, deny, expiry, and revoke lifecycle is defined.
- Enforcement tests prove a UI bypass is insufficient.
- Permission copy is localized in English and Indonesian.
- A local audit log exists without content or secrets.
- The broker derives principals from trusted context, not caller input.
- Wildcard, path-traversal, and ambiguous scopes are rejected.
- Capability handles are bound to principal, session, scope, and expiry.
- High-risk grants require recent confirmation with exact scope.
- Revocation cancels in-flight operations and invalidates cached results.
- The audit chain detects accidental tampering but is not presented as an XSS
  boundary.

## Testing strategy

- Unit tests for policy decisions.
- Integration tests for the broker.
- E2E tests for grant and revoke.
- Negative tests for principal spoofing, scope escalation, and stale grants.
- Negative tests for wildcard, path traversal, and origin confusion.
- Capability-handle replay and cross-principal reuse tests.
- Revocation during an in-flight operation.
- Audit hash-chain tamper detection.
- Permission prompt flooding and quota tests.
