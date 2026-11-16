# ADR 0010: Extension architecture

- Status: Proposed, pending Stage D0 approval
- Date: 2026-11-14
- Context: Stage D0 Privacy and Extensibility
- Related: ADR 0008, ADR 0009, ADR 0011, ADR 0013
- Product conflict: scope clarification, no direct contradiction
- Security refinement: pass 1 applied 2026-11-14

## Context and problem

The PRD names a future public plugin catalog and the roadmap schedules extension
architecture research after the Privacy Center. OpenNest currently has no
extension runtime, manifest, trust boundary, or distribution model.

Arbitrary npm plugins inside the main application would have full access to notes,
files, credentials, and the DOM. That is incompatible with the privacy model. A
browser PWA also cannot run local CLI agents.

## Goals

- Define what an extension may be.
- Define a trust and execution boundary for extension code.
- Define a manifest, lifecycle, host API, and distribution path.
- Keep extensions optional and locally installed.

## Non-goals

- Build a marketplace.
- Build a public SDK.
- Run local CLI agents from the PWA.
- Allow arbitrary in-process code.
- Implement extension billing, moderation, or governance.

## Constraints

- Extension code is untrusted.
- No direct storage, DOM, network, or credential access by default.
- Strict CSP and an opaque-origin sandbox are required.
- AGPL-3.0 compatibility must be reviewed before an SDK is published.
- No new dependency is required by this ADR.
- Local-first behavior cannot depend on an extension.

## Alternatives considered

1. In-process npm plugins. Rejected because they have full application access and
   a large supply-chain risk.
2. Sandboxed iframe or worker with a manifest and capability grants. Recommended.
3. Declarative-only packs. Recommended for low-risk content, but insufficient for
   all extensions.
4. External MCP integrations only. Rejected because MCP is an integration
   protocol, not a UI extension model.

## Decision

### Extension tiers

| Tier | Form                                                                    | Allowed access                                                 |
| ---- | ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| 0    | Declarative pack: templates, themes, import or export presets           | No executable code, no network, explicit import or export only |
| 1    | Sandboxed code extension in an opaque-origin iframe or dedicated worker | Mediated host API only, through ADR 0009 capabilities          |

Tier 0 packs are checksum-verified and cannot execute code. Tier 1 extensions run
outside the application origin and cannot access the DOM, IndexedDB,
localStorage, or credentials directly. A dedicated worker is allowed only when it
is served from a separate origin; a same-origin worker is not a sandbox.

### Manifest

Required fields:

- ID.
- Name.
- Version.
- Publisher.
- Entry point.
- Requested capabilities.
- Allowed network origins.
- Data scopes.
- Integrity hash covering every shipped file.
- Minimum host version.
- Signature, optional for local sideload and mandatory before a shared registry.

### Host API and IPC

- RPC uses a versioned `postMessage` protocol with origin checks.
- The host validates every request against the extension manifest and active
  grants.
- The host returns only the requested data, not whole repositories.
- Extension code never receives raw storage handles or credentials.
- Network egress is host-mediated and denied unless an origin capability was
  granted. Extensions do not call the network directly.
- A kill switch disables an extension immediately.

### Lifecycle

1. Sideload a package.
2. Verify manifest and integrity hash.
3. Show requested capabilities in plain language.
4. Install and enable.
5. Re-consent when an update expands capabilities.
6. Disable or uninstall, with a choice to remove extension-owned data.

Local sideload is the first distribution model. There is no auto-update and no
marketplace in this phase.

### Relationship to MCP and Local Bridge

MCP servers and a future Local Bridge are external integrations, not extensions.
They use ADR 0011 provider or tool adapters and separate capability grants. The
browser extension model must not be used to pretend a local CLI is available in
the PWA.

## Security refinement pass 1

This pass tightens the extension boundary. It does not add a marketplace or
change the local-sideload distribution decision.

### Threat model additions

- Malicious extension code and compromised extension updates.
- Supply-chain compromise of a package or publisher key.
- IPC spoofing, message injection, and prototype pollution.
- Data exfiltration through direct network access or image and URL side channels.
- UI redressing, clickjacking, and fake permission prompts.
- Resource exhaustion, infinite loops, and oversized messages.
- Cross-extension data access and persistence after uninstall.

### Required controls

1. **R-10-1, strict sandbox.** Tier 1 code runs in an opaque-origin iframe with
   only `allow-scripts`. It must not receive `allow-same-origin`,
   `allow-top-navigation`, `allow-popups`, `allow-forms`, `allow-modals`, or
   `allow-downloads`. A dedicated worker inherits its origin, so untrusted code
   may use a worker only when the worker is served from a separate origin. If
   that is not possible, a worker is not an acceptable sandbox.
2. **R-10-2, restrictive CSP.** The extension document uses
   `default-src 'none'`, packaged code only, no inline script, no `eval`, no
   remote imports, and `connect-src 'none'`. Images, fonts, and frames are denied
   unless the host explicitly mediates them.
3. **R-10-3, authenticated IPC.** The host validates `event.origin`,
   `event.source`, message schema, correlation ID, size, and rate. Unknown
   messages are dropped. Because an opaque origin serializes as `null`, the host
   binds each channel to the specific `event.source`; the origin string alone is
   not authentication. Transferable buffers and structured-clone payloads have
   hard size limits. The host never trusts extension-supplied principal, grant,
   or scope fields.
4. **R-10-4, host-mediated network.** Extensions do not call the network
   directly. All egress goes through the host network broker, which applies ADR
   0009 origin grants, strips credentials, rejects cross-origin redirects, and
   limits response size. This changes the original direct-network option and
   requires approval.
5. **R-10-5, scoped host API.** The host returns only the requested data and a
   scoped handle. It never exposes raw storage, credential material, capability
   tokens, or another extension's data. Extension logging is mediated and
   redacted.
6. **R-10-6, manifest integrity.** The integrity hash covers every shipped file,
   not only the entry point. The manifest is canonicalized before hashing.
   Publisher key changes, version downgrades, and capability expansion require
   explicit confirmation. Signatures are mandatory before any shared registry or
   catalog is introduced. Local sideload may remain unsigned with a warning.
7. **R-10-7, permission revalidation.** Every host call revalidates the manifest,
   current grant, resource scope, and expiry. An update cannot silently add a
   capability, and a disabled extension cannot keep an in-flight privileged
   handle.
8. **R-10-8, resource limits.** The host enforces wall-clock time, message rate,
   output size, and storage quota. A violation terminates the extension and is
   audited. A global kill switch and safe mode are required.
9. **R-10-9, storage isolation.** Extension-owned data is host-mediated and
   scoped by extension ID. Uninstall removes it. Extensions cannot read each
   other's data or use host storage as a covert channel beyond their quota.
10. **R-10-10, UI separation.** Extension surfaces are visually and structurally
    separate from host chrome. They cannot cover permission prompts, settings, or
    navigation. Host prompts are rendered outside the sandbox.

### Residual risks

- Browser sandbox and CSP bugs remain a platform risk.
- A user can still install a malicious extension. Local sideload is inherently a
  trust decision.
- A compromised host origin can bypass all extension controls.
- Side channels such as timing, size, and error messages cannot be fully removed.
- Signature infrastructure is deferred, so local sideload integrity is only as
  strong as the user's source.

### Refinements requiring approval

- R-10-1 removes same-origin dedicated workers from the safe path.
- R-10-4 changes direct network access to host-mediated network access. This may
  reduce compatibility and performance.
- R-10-6 makes signatures mandatory before a shared registry.
- R-10-9 introduces host-mediated extension storage instead of direct storage.

## Trade-offs

- The sandbox limits functionality and performance.
- RPC adds protocol and compatibility work.
- The host API must stay small and stable.
- Signing and update trust are deferred.

## Security and privacy implications

- Malicious extension code remains a supply-chain risk.
- Data exfiltration must be blocked by capabilities and network grants.
- UI redressing, resource exhaustion, and persistence must be tested.
- Updates that expand permissions require re-consent.
- A compromised extension cannot be allowed to read another extension's data.

## Compatibility with Stages A to C

- No current code changes are required.
- A future consumer package can be added when implementation starts.
- Core domain and ports remain unchanged.
- The model builds on ADR 0009 and does not alter ADR 0004.

## Dependencies

- ADR 0008.
- ADR 0009.
- ADR 0011 optional for AI-powered extensions.
- ADR 0013 optional for encrypted extension secrets.

## Migration implications

- No existing user data migration.
- A future extension registry is additive.
- Extension-owned data must be separately identifiable for uninstall.

## Conflicts and decisions requiring approval

- The PRD includes "public plugin catalog" and "community extensions" as post-MVP
  goals. This ADR keeps them out of scope and starts with local sideload. That is
  a scope clarification, not a removal of the long-term goal.
- The sandbox needs a deployment and CSP review because a same-origin iframe is
  not sufficient. No deployment change is made by this ADR.
- Extension licensing and AGPL boundaries require a separate decision before an
  SDK or marketplace is published.

## Acceptance criteria

- Manifest specification exists.
- Sandbox proof exists.
- Extensions cannot access storage, DOM, or credentials directly.
- Capability enforcement and kill switch are tested.
- Install, update, and uninstall are localized and auditable.
- No extension is required for core functionality.
- The sandbox has no same-origin, top-navigation, popup, form, modal, or download
  capability.
- Direct network access is blocked and all egress goes through the host broker.
- IPC validates origin, source, schema, size, rate, and timeout.
- Manifest integrity covers the full package and downgrade is rejected.
- Resource limits terminate abusive extensions.
- Extension storage is host-mediated and removed on uninstall.

## Testing strategy

- Sandbox escape tests, including attribute and CSP regression tests.
- RPC fuzzing, origin spoofing, source spoofing, and oversized-message tests.
- Malicious extension fixtures.
- Capability grant and revoke tests.
- Direct-network and image-side-channel egress tests.
- Host-broker redirect and credential-stripping tests.
- Update re-consent, publisher-change, and downgrade tests.
- CPU, memory, message-rate, and storage-quota exhaustion tests.
- Uninstall data-removal tests.
