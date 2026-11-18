# Extension security review

Status: implementation complete; internal Stage D audit pending; independent
review not started. This document is a release gate and checklist, not a report.
OpenNest makes no claim that the extension sandbox has been independently
reviewed.

D4A implements local sideload only. Packages are unsigned, no registry or
marketplace exists, and there is no network, workspace write, credential, or AI
access. These limits reduce the attack surface but do not satisfy the review gate
below.

Binding decisions are in ADR 0010. The product boundary is in
[extensions.md](./extensions.md).

## Scope

In scope for D4A:

- Strict manifest parsing, package limits, canonical JSON, and SHA-256 integrity.
- Initial install consent and capability-expansion consent on update.
- Opaque-origin iframe with `sandbox="allow-scripts"` and a restrictive CSP.
- Blob worker created by the trusted shell inside the opaque origin.
- Frozen `opennest` API, host-mediated RPC, and message validation.
- Capability grants and per-call manifest, grant, scope, and expiry checks.
- Read-only workspace metadata and note-content methods.
- Host-mediated extension storage, namespace isolation, quotas, and uninstall.
- Session lifecycle, timeouts, heartbeats, rate limits, safe mode, and kill
  switch behavior.
- Privacy audit events, privacy inventory, backup exclusion, and delete-all.
- PWA cache behavior for `/extensions` and `/extension-sandbox.js`.
- Unit, integration, and E2E evidence for the above.

Out of scope for D4A:

- Registry, marketplace, discovery, billing, and moderation.
- Publisher signatures, key rotation, and signed updates.
- Auto-update and background update.
- Network access, host-mediated network grants, and URL or image side channels.
- Workspace writes, file bytes, exports, deletes, credentials, and AI tools.
- Multiple simultaneous extension sessions.
- Multi-user extensions, sharing, and collaboration.
- A compromised device, malicious browser extension, or malicious operating
  system.

## Threat model

- A malicious package runs hostile code and attempts to reach the DOM, storage,
  credentials, or the network.
- A compromised update adds a capability, changes the publisher, downgrades the
  version, or replaces contents without consent.
- A browser sandbox or CSP bug allows an escape from the opaque-origin iframe.
- A message is spoofed, replayed, injected, oversized, malformed, or correlated
  with another session.
- A capability is confused, widened, retained after disable, or applied to the
  wrong resource.
- Prototype pollution or crafted JSON changes host behavior during parsing.
- Storage quota abuse or cross-extension access turns host storage into a covert
  channel.
- Timing, size, or error side channels reveal metadata beyond the granted scope.
- A compromised host origin bypasses every sandbox control.
- A user installs an unsigned package from an untrusted source.
- An extension covers host chrome, fakes a permission prompt, or redresses the UI.
- An extension exhausts CPU, memory, message rate, or storage.
- Extension data survives uninstall, backup, or delete-all when it should not.
- A PWA cache or sandbox asset policy widens the origin boundary.

## Required controls

These are review assertions, not new implementation work:

1. **Strict sandbox.** Extension code runs in a blob worker inside a `srcdoc`
   iframe with only `allow-scripts`. `allow-same-origin` is absent. The shell is
   trusted same-origin code; extension code never runs in the shell.
2. **Restrictive CSP.** The extension document uses `default-src 'none'`,
   `connect-src 'none'`, `worker-src blob:`, and no inline script. No `eval`,
   remote import, image, font, frame, or navigation path is available.
3. **Authenticated IPC.** The host binds the `MessageChannel` to
   `event.source`, validates message size, schema, correlation ID, method, and
   rate, and drops unknown messages. An opaque origin serializes as `null`, so
   the origin string is not the only authentication.
4. **Scoped host API.** The host returns only the requested data. It never
   exposes raw storage, credentials, capability tokens, file bytes, folder names,
   tag names, or another extension's data.
5. **Capability revalidation.** Every call rechecks the manifest, active grant,
   resource scope, session, and expiry. Disable, safe mode, or disposal
   invalidates in-flight privileged access.
6. **Manifest integrity.** The canonical SHA-256 covers format, version,
   manifest, and files. Unknown fields, unsafe paths, extra files, oversized
   packages, and non-empty `networkOrigins` fail closed.
7. **Install and update consent.** Initial install requires explicit
   confirmation. An update requires the same publisher, a higher version, and
   consent only for new capabilities. A downgrade or same-version content
   replacement is rejected.
8. **Storage isolation.** Extension storage is namespaced by extension ID,
   host-mediated, quota-limited, excluded from backups, removed on uninstall, and
   cleared by delete-all.
9. **Resource limits.** Shell-ready timeout, message size, response size, request
   timeout, request rate, UI update rate, heartbeat, session duration, storage
   quota, and UI tree limits are enforced.
10. **Lifecycle controls.** Only one session runs at a time. Disable stops the
    active session. Safe mode blocks every start until disabled. Uninstall stops
    the session and removes its record and storage.
11. **Audit and privacy.** Install, update, enable, disable, uninstall, start,
    terminate, integrity failure, and safe mode produce metadata-only audit
    events. Installed metadata appears in the privacy inventory.
12. **Safe presentation.** The UI tree is validated and rendered with host
    components. Raw HTML, links, images, CSS, iframes, and extension-controlled
    DOM are unavailable.
13. **PWA boundary.** `/extension-sandbox.js` is the only asset with a
    cross-origin resource policy override. App pages keep `same-origin`, and
    cached extension records stay local.

## Review checklist

### Design

- [ ] ADR 0010 and `docs/extensions.md` match the shipped behavior.
- [ ] The trust boundary is explicit: extension code is untrusted, the shell is
      trusted, and the host API is the only bridge.
- [ ] Local sideload is the only distribution model and packages are unsigned.
- [ ] The out-of-scope list does not hide a reachable capability.
- [ ] The capability model uses the two D4A capabilities only.
- [ ] The consent model is install-time and update-time, not a blank cheque.

### Implementation

- [ ] Manifest parsing is strict and rejects unknown fields.
- [ ] Canonical JSON and SHA-256 match the documented algorithm.
- [ ] File size is checked before reading the package or code.
- [ ] Entry names are single filenames with no traversal path.
- [ ] Package publisher, version, and host-version checks match the docs.
- [ ] Install and update dialogs show the correct capabilities and warnings.
- [ ] The host never trusts extension-supplied principal, grant, or scope fields.
- [ ] Host errors use safe codes and never include content or secrets.
- [ ] UI trees are validated before rendering, and invalid trees preserve the
      last valid surface.
- [ ] Console or error paths do not leak note content or metadata beyond scope.

### Isolation

- [ ] The iframe has exactly `sandbox="allow-scripts"`.
- [ ] `allow-same-origin` is absent from the shipped document and tests.
- [ ] The document CSP has `default-src 'none'` and `connect-src 'none'`.
- [ ] The worker prelude removes `fetch`, `XMLHttpRequest`, `WebSocket`,
      `indexedDB`, `localStorage`, `Worker`, `SharedWorker`, `BroadcastChannel`,
      and `importScripts`.
- [ ] The sandbox document can load only the trusted shell asset.
- [ ] The host binds messages to the iframe source, not only the origin string.
- [ ] A sandbox escape test or documented platform limitation exists.
- [ ] App pages keep `Cross-Origin-Resource-Policy: same-origin`.

### Capabilities and grants

- [ ] `workspace.read.metadata` cannot read note bodies or file bytes.
- [ ] `workspace.read.content` is required for `workspace.readNote`.
- [ ] A missing, expired, revoked, or disabled grant fails closed.
- [ ] An update cannot add a capability without a new consent.
- [ ] A disabled extension cannot keep an in-flight privileged handle.
- [ ] `dataScopes` is informational and is not used as an enforcement shortcut.
- [ ] Unknown methods, params, and page cursors fail safely.
- [ ] Pagination limits and response-size limits are enforced.

### Storage and lifecycle

- [ ] Extension storage keys and values match the documented limits.
- [ ] The 1 MiB quota, 256-key limit, and 64 KiB value limit are enforced.
- [ ] One extension cannot read another extension's namespace.
- [ ] Uninstall removes the namespace and reinstall starts empty.
- [ ] Backup v1 and backup v2 exclude extension records and storage.
- [ ] Delete-all clears extension records and extension storage.
- [ ] Disable, safe mode, heartbeat loss, timeout, and rate limit end sessions.
- [ ] Only one session runs at a time.
- [ ] Session grants are session-only and cleared on end.

### Product and operations

- [ ] The UI states that packages are unsigned and local only.
- [ ] The UI states that extensions cannot access the network.
- [ ] The install dialog names capabilities in plain language.
- [ ] The update dialog lists only new capabilities.
- [ ] Safe mode is visible and its effect is explained.
- [ ] Uninstall and disable copy are accurate about data removal.
- [ ] Privacy Center shows extension audit events and inventory.
- [ ] English and Indonesian strings are complete and consistent.
- [ ] Mobile layout is verified at 412 x 915.
- [ ] No product copy claims independent review or a secure sandbox.

### Evidence

- [ ] Manifest, package, integrity, and version tests pass.
- [ ] Registry and store tests pass.
- [ ] Host API, protocol, session, runtime, and frame-guard tests pass.
- [ ] Sandbox document and shell tests pass.
- [ ] Extension UI, install dialog, view, and runner tests pass.
- [ ] PWA extension asset tests pass.
- [ ] `scripts/e2e-extensions.mjs` passes the full install, update, disable,
      safe-mode, uninstall, audit, and iframe checks.
- [ ] Typecheck, lint, format, build, and the full test suite pass.
- [ ] `npm audit --omit=dev` is reported honestly.
- [ ] No critical regression remains.

## Residual risks

1. Browser sandbox and CSP bugs are platform risks. The opaque origin reduces
   impact but cannot prove that a browser escape is impossible.
2. A compromised host origin can bypass every extension control. The sandbox
   protects the app from the extension, not the extension from a compromised app.
3. Local sideload packages are unsigned. Integrity proves package consistency,
   not publisher identity, and a user can still install malicious code.
4. Timing, size, and error side channels cannot be fully removed. The host limits
   the data returned but cannot make all observations identical.
5. A user's trust decision is part of the security boundary. The warning reduces
   accidental installs but does not make an untrusted package safe.
6. A browser extension, compromised device, or compromised operating system is
   outside this review.
7. No independent review has started, so no extension security claim is allowed.

## Required artifacts

The reviewer must receive:

- ADR 0010 with the D4A implementation note and residual risks.
- `docs/extensions.md`.
- The D4A implementation plan and changed-file list.
- The relevant `packages/extensions` and `apps/web/lib/extensions` source.
- Test evidence for manifest, package, integrity, host API, protocol, session,
  runtime, frame guard, sandbox document, UI, and PWA assets.
- A working production build and the E2E command
  `node scripts/e2e-extensions.mjs`.
- Evidence that the iframe sandbox, CSP, worker prelude, and response-size limits
  match the docs.
- Known limitations and unresolved risks.

## Claim criteria

D4A may be described as implemented only when every in-scope checklist item
passes and the evidence is recorded.

OpenNest may not claim any of the following before the corresponding review:

- That the extension sandbox is secure or escape-proof.
- That installing an unsigned package is safe.
- That extensions cannot leak metadata through side channels.
- That the extension layer has been independently reviewed.
- That D4 is complete while an independent security review remains open.

The correct product language before review is: "Local sideload extensions are
implemented with an opaque-origin sandbox and a read-only host API. The extension
security review is not complete."

## Review record

| Field           | Value        |
| --------------- | ------------ |
| Reviewer        | Not assigned |
| Review date     | Not started  |
| Commit reviewed | Not started  |
| Result          | Not started  |
| Open findings   | Not started  |
| Claim approved  | No           |

This table must be updated with real evidence. It must not be pre-filled with a
passing result.

## Finding handling

- Critical: stop the claim, fix, add a regression test, and re-review.
- High: fix before release or record an accepted risk with an owner.
- Medium: fix before release or record an accepted risk with an owner.
- Low: record and schedule.

A finding cannot be closed by changing documentation only if the implementation
still violates the threat model. A deferred control remains an explicit open
gate.
