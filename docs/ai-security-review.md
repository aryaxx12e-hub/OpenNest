# AI security review

Status: D4B design accepted on 2026-11-17 and implementation completed on
2026-11-18; independent review not started. This document is a release gate and
checklist, not a report. OpenNest makes no claim that AI traffic, credentials, or
provider handling are secure against XSS, provider retention, or all browser
threats.

The implementation includes CORS-dependent remote providers, no automatic
retries, no tools or MCP execution, no document context, no AI chat history, and
no vault recovery. Model output is rendered as text, but XSS while the vault is
unlocked remains a residual risk. These limitations do not satisfy the review
gate below.

Binding decisions are in ADR 0011. Architecture is in
[ai-provider-architecture.md](./ai-provider-architecture.md) and
[credential-vault.md](./credential-vault.md).

## Scope

In scope for D4B:

- AI provider registry, endpoint validation, presets, and the OpenAI-compatible
  adapter.
- Session-only credentials and the optional passphrase-encrypted vault.
- One-time, payload-bound consent and session-only capability grants.
- Browser transport, redirect handling, timeouts, response limits, and abort.
- Production CSP and exact-origin enforcement.
- Backup exclusion for provider configs, consents, session credentials, and vault
  records.
- Plain-text rendering of untrusted model output.
- Privacy Center inventory, consent history, audit metadata, and delete-all.
- Localization of security-relevant UI copy.
- Unit, integration, and E2E tests for the above.

Out of scope for D4B:

- D4A extension sandbox, extension permissions, and extension lifecycle.
- Tools, function calling, MCP execution, and tool-output handling.
- Workspace document, note, folder, file, or chat history context.
- Cloud sync, accounts, billing, and a hosted AI proxy.
- Vault recovery and multi-device credential sync.
- Reliable JavaScript memory zeroization.
- A compromised device or malicious browser extension.

## Threat model

- XSS while the AI runtime or vault is unlocked reads a secret or uses a handle.
- A secret leaks through logs, errors, URLs, redirects, DOM state, or a backup.
- A remote endpoint is downgraded to HTTP or tricked with userinfo, query
  credentials, a fragment, or a cross-origin redirect.
- Consent is confused, replayed, reused, or applied to a substituted payload.
- A provider config changes between preview and send.
- CORS failure or offline state leaves a request in an unclear state.
- A provider retains prompt content after the request.
- A large or malformed response exhausts memory or bypasses rendering limits.
- A broad CSP lets the page contact an origin that the app did not approve.
- A local provider reaches an unintended localhost service.
- A tool or MCP path is accidentally enabled before its trust boundary exists.

## Required controls

1. **Off by default.** AI is disabled when the setting is missing. No provider
   lookup, credential lookup, or network request occurs while it is off.
2. **Consent before egress.** Every external request needs a one-time,
   payload-bound consent with a maximum 5-minute lifetime. No consent means no
   network call.
3. **Session-only default.** Credentials live in memory unless the user explicitly
   sets up the vault. A credential handle is provider-bound.
4. **Separate vault domain.** The vault uses
   `opennest:credential-vault-kek:v1`, a 600,000-iteration PBKDF2 floor, and a
   separate DEK and entry CEKs. Workspace and backup keys never open the vault.
5. **No recovery.** D4B has no vault recovery. The UI warns that a lost passphrase
   loses stored credentials.
6. **Backup exclusion.** Backup v1 and backup v2 exclude provider configs,
   consents, session credentials, and vault records. Restore cannot recover
   provider access.
7. **Exact request binding.** The consent hash covers the exact bytes sent. The
   runtime re-reads the provider and re-prepares before sending. Any change fails
   with `payload_changed`.
8. **Endpoint validation.** Remote providers require HTTPS. Loopback HTTP is
   allowed only for explicit local providers. Userinfo, query strings, fragments,
   wildcards, mixed content, and non-HTTP protocols are rejected.
9. **Safe transport.** Requests use `credentials: "omit"`,
   `referrerPolicy: "no-referrer"`, `redirect: "error"`, `cache: "no-store"`, and
   `mode: "cors"`. Only known auth headers are injected.
10. **CSP with app-level exact origin.** Production `connect-src` allows HTTPS and
    loopback HTTP. The transport and broker enforce the exact origin before every
    request.
11. **No automatic retries.** A retry is a new user action with a new payload hash
    and new consent.
12. **No tools or hidden context.** D4B rejects MCP and tools, sends no workspace
    content, persists no chat history, and does not index in the background.
13. **Safe errors and logs.** Error codes are local and safe. Request bodies,
    response bodies, auth headers, and secrets never enter logs, audit entries,
    consent records, or error text.
14. **Response limits.** Request, response, timeout, and streaming limits are
    enforced. Oversized or malformed responses fail closed.
15. **Plain-text output.** Model output is untrusted text. It is never rendered as
    HTML or Markdown and never executed.
16. **Metadata-only audit.** Audit entries contain provider, capability, scope
    digest, outcome, and reason code only.
17. **Local warning.** Configuring a local or loopback provider requires an
    explicit warning acknowledgement. There is no automatic discovery.
18. **Delete-all coverage.** Delete-all clears AI settings, provider configs,
    consents, vault records, and session credentials, then leaves AI disabled.

## Residual risks

1. The broad CSP `connect-src` allows any HTTPS or loopback origin at the policy
   layer. A bug in the transport or broker could widen egress beyond the approved
   provider.
2. CORS failures are common for remote providers. OpenNest cannot make a provider
   allow browser origins.
3. XSS while unlocked can read credentials, prompts, or handles. Browser
   JavaScript cannot provide a perfect secret boundary.
4. A provider can retain anything the user sends. Provider-side retention and
   model behavior are outside OpenNest's control.
5. JavaScript memory zeroization is not guaranteed. Locking reduces exposure but
   cannot prove that old buffers are erased.
6. PBKDF2 is weaker than a memory-hard KDF.
7. Browser storage can be evicted.
8. Prompt injection remains an input risk. D4B has no tools or document context,
   but model output is still untrusted text.
9. No independent review has started, so no security or privacy claim is allowed.

## Required artifacts

The reviewer must receive:

- ADR 0011 with the D4B approval record and open risks.
- `docs/ai-provider-architecture.md`.
- `docs/credential-vault.md`.
- `SECURITY.md` and `docs/privacy-center.md`.
- The D4B implementation plan and changed-file list.
- Test evidence for consent, endpoint, transport, vault, backup exclusion, and
  delete-all.
- A working production build and E2E instructions.
- Evidence that the production CSP and the actual transport match.
- Known limitations and unresolved risks.

## Review checklist

### Design

- [ ] AI is off by default and the disabled path has no network or credential
      lookup.
- [ ] Consent is one-time, payload-bound, session-bound, and limited to 5 minutes.
- [ ] The payload hash covers exactly the bytes sent.
- [ ] Provider config changes between preview and send fail closed.
- [ ] Session-only credentials are the default and the vault is optional.
- [ ] The vault uses a separate key domain and no recovery.
- [ ] Workspace recovery cannot open the vault and the vault passphrase cannot
      open workspace content.
- [ ] Backup v1 and backup v2 exclude provider configs, consents, credentials, and
      vault records.
- [ ] No tools, MCP, document context, or chat history are reachable.
- [ ] There are no automatic retries.

### Implementation

- [ ] No production code path sends a request before consent is consumed.
- [ ] The transport re-validates scheme, origin, userinfo, query, fragment, and
      provider kind before `fetch`.
- [ ] Redirects, mixed content, and non-HTTPS remote endpoints fail closed.
- [ ] Only known auth headers are injected.
- [ ] Secrets never enter URLs, logs, audit entries, consent records, React state
      after save, or backups.
- [ ] Vault records contain no plaintext secret.
- [ ] Session credentials are cleared on lock, delete-all, and disposal.
- [ ] Lock and expiry reject every vault operation.
- [ ] Failed vault unlocks are rate limited.
- [ ] Request, response, timeout, and abort paths clear timers and readers.
- [ ] Response size limits are enforced while reading.
- [ ] Errors never include response bodies or provider prose.
- [ ] Model output is rendered as text only.
- [ ] Audit writes are metadata-only and failures block the request.
- [ ] Delete-all clears AI and credential state.

### Consent and grants

- [ ] Consent binds provider, model, origin, payload hash, data classes, session,
      and expiry.
- [ ] A second consume returns `consent_used`.
- [ ] Expired and revoked consents are rejected.
- [ ] Another session cannot consume the consent.
- [ ] Revoking a consent revokes its grants and aborts an active handle.
- [ ] A credential use needs a high-risk confirmation scoped to the provider.
- [ ] No audit or consent record contains prompt or response text.

### CSP and transport

- [ ] Production CSP includes HTTPS and loopback but not broad `http:`.
- [ ] The CSP test matches the shipped policy.
- [ ] The local provider works under the production policy.
- [ ] A wrong origin, provider, credential, or header fails before network.
- [ ] Abort, timeout, network failure, CORS failure, and oversized response map
      to safe local codes.
- [ ] Console methods are not called with secrets, bodies, or headers.

### Vault

- [ ] Setup, unlock, passphrase change, rotation, and delete are covered.
- [ ] AAD swaps across entry ID, provider ID, label, key ID, and purpose fail.
- [ ] Nonces are unique across wrapped keys and secret ciphertexts.
- [ ] Update leaves other entries unchanged.
- [ ] Workspace and backup keys cannot unwrap the vault DEK.
- [ ] Backup v1 and backup v2 contain no vault record or credential.
- [ ] The no-recovery warning is shown before setup.

### Product and operations

- [ ] The UI never claims AI is private by default after enablement.
- [ ] The consent dialog names the provider, origin, model, data classes, and byte
      size.
- [ ] The consent dialog states that no workspace files, notes, or chat history are
      attached.
- [ ] Local provider configuration shows the warning and requires acknowledgement.
- [ ] Provider deletion removes session credentials and marks vault entries
      unlinked.
- [ ] Delete-all copy is accurate about provider access and vault loss.
- [ ] English and Indonesian strings are complete and consistent.
- [ ] Mobile layout is verified at 412 x 915.

### Evidence

- [ ] Consent unit and integration tests pass.
- [ ] Endpoint policy tests pass.
- [ ] Transport and CSP tests pass.
- [ ] Vault unit tests and cross-domain tests pass.
- [ ] Backup exclusion tests pass for v1 and v2.
- [ ] Delete-all and app lifecycle tests pass.
- [ ] E2E covers off-by-default, consent, local provider, session credential,
      vault unlock after reload, HTML-as-text, abort, and delete-all.
- [ ] Typecheck, lint, format, build, browser graph, and full test suite pass.
- [ ] `npm audit --omit=dev` is reported honestly.
- [ ] No critical regression remains.

## Claim criteria

D4B may be described as implemented only when all in-scope checklist items pass
and the evidence is recorded.

OpenNest may not claim any of the following before the corresponding review:

- That AI requests are confidential from the provider.
- That credentials are safe against XSS while unlocked.
- That the vault is recoverable.
- That tools, MCP, or document context are supported.
- That D4 is complete while D4A extension is missing.
- That the vault or AI layer has been independently reviewed.

The correct product language before review is: "Optional AI providers are
implemented with off-by-default consent and session-only or encrypted
credentials. The AI and credential-vault security review is not complete."

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
