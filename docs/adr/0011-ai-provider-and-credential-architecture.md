# ADR 0011: AI provider and credential architecture

- Status: Accepted for D4B AI track, D4A extension remains separate
- Date: 2026-11-14
- Accepted: 2026-11-17
- Implementation: D4B design accepted; implementation not started
- Context: Stage D0 Privacy and Extensibility
- Related: ADR 0008, ADR 0009, ADR 0010, ADR 0013
- Product conflict: none, but security trade-offs require approval
- Security refinement: pass 1 applied 2026-11-14

## Context and problem

The PRD makes AI optional and configurable, with local model support and no
external requests by default. OpenNest currently has no provider adapter,
credential storage, consent flow, or network egress policy for AI.

API keys in localStorage or IndexedDB would be plaintext secrets in the browser.
A hosted OpenNest proxy would create a mandatory backend and contradict the
local-first promise. The architecture needs a provider model that can work with
local and remote providers without making either mandatory.

## Goals

- Define a provider adapter contract.
- Define credential storage and isolation.
- Require explicit consent for every external AI request.
- Support local and remote providers.
- Keep OpenNest Cloud optional.

## Non-goals

- Implement AI product features.
- Build a hosted AI proxy.
- Implement billing or usage metering.
- Build a vector database.
- Run local CLI agents from the PWA.

## Constraints

- The browser cannot fully protect long-lived secrets against XSS.
- Only WebCrypto is allowed. No custom cryptography.
- No new dependency is required by this ADR.
- No external AI request by default.
- No document upload without explicit consent.
- The core application must work without AI.

## Alternatives considered

1. Store API keys in localStorage or IndexedDB plaintext. Rejected because it
   exposes secrets to any script on the origin.
2. Ask for the key every session and keep it only in memory. Secure, but poor UX.
3. Session-only by default, with an optional passphrase-encrypted vault.
   Recommended.
4. Store keys only in an optional self-hosted server. Valid for some deployments,
   but not usable by the local-first PWA.
5. Use an OS password manager or WebAuthn. Deferred.

## Decision

### D4B approval record

Accepted on 2026-11-17 for the D4B AI track only. This record does not approve
D4A extension work, tools, MCP execution, or a claim that D4 is complete.

Approved decisions:

1. Session-only credentials are the default. The passphrase-encrypted vault is
   optional.
2. The D4B vault has no recovery path. Losing the vault passphrase loses stored
   credentials. Workspace recovery and backup restore do not open the vault.
3. Provider configuration, consent records, session credentials, and vault
   records are excluded from backup v1 and backup v2.
4. Vault keys are a separate domain. Workspace keys, backup keys, and vault keys
   are never interchangeable.
5. PBKDF2-SHA-256 uses a 600,000-iteration floor for the vault.
6. Consent is one-time, payload-bound, and expires after 5 minutes. A retry is a
   new request and needs new consent. There are no automatic retries.
7. D4B has no tools, MCP execution, document context, or AI chat history. The
   adapter supports chat, streaming, embeddings, and health only.
8. The vault auto-locks after 5 minutes of inactivity.
9. Production CSP uses
   `connect-src 'self' https: http://localhost:* http://127.0.0.1:*`.
   Chromium rejects IPv6 literals in CSP source lists, so loopback IPv6 is not
   in the policy. The browser transport and capability grants enforce the exact
   origin.

The residual risks below remain accepted for implementation. They do not imply
that the D4B implementation is complete or reviewed.

### Provider contract

A provider descriptor includes:

- ID.
- Kind: local, remote, custom, or MCP. D4B rejects MCP configurations.
- Endpoint.
- Models.
- Capabilities: chat, embedding, vision, and tools. D4B rejects tools.
- Authentication type.
- Data-handling policy reference.
- Context and output limits.

The provider interface includes `complete`, `embed`, `stream`, `abort`, and
`health`. D4B implements the `openai-compatible` adapter. Provider adapters live
in a separate package, not in `@opennest/core`. Tool calls are not implemented or
claimed.

Built-in providers are presets only. No API key is bundled.

### Credential storage and key hierarchy

The credential vault is a separate key domain. It may use the same approved
cryptographic primitives as workspace E2EE and backup encryption, but no key
material is shared.

- AI is disabled by default.
- Session-only credentials are the default.
- An optional persistent BYOK vault uses:
  - AES-256-GCM.
  - PBKDF2-SHA-256 with a vault-specific salt, domain separation, a 600,000
    iteration floor, and versioned parameters.
  - A non-extractable key held in memory only.
  - A 5-minute inactivity auto-lock.
- A vault passphrase derives a credential-vault KEK. A random 256-bit
  credential-vault DEK is wrapped by that KEK with AES-256-GCM, a unique nonce,
  and AAD binding vault version, key ID, and domain.
- Each credential entry uses a fresh entry CEK wrapped by the vault DEK. The entry
  CEK encrypts one credential payload with a unique nonce and AAD binding provider
  ID, account label, and entry version.
- Credential-vault keys, workspace E2EE keys, and backup keys are not
  interchangeable.
- D4B has no persistent vault recovery. Losing the vault passphrase loses stored
  credentials. A future vault-only recovery key, if approved, must wrap only the
  credential-vault DEK and remain separate from workspace and backup recovery.
- Workspace recovery, workspace DEK rotation, workspace backup restore, and backup
  recovery never unwrap the credential vault.
- A vault passphrase change rewraps the vault DEK. Suspected vault compromise
  rotates the vault DEK and entry CEKs. A provider credential change rewraps only
  that entry.
- The AI credential subsystem owns this hierarchy. The workspace E2EE subsystem
  does not import or manage vault keys.
- Provider adapters receive handles, not raw keys. Extensions never receive
  handles or raw keys.
- Plaintext keys are never written to localStorage or IndexedDB.
- Keys are never written to logs, backups, or exported data.
- Credentials are excluded from backup v1 and backup v2 by default.
- There is no server-side key escrow.

### Consent and data minimization

- Consent is per request in D4B, bound to the exact payload, one-time, and limited
  to a 5-minute lifetime.
- There are no automatic retries. A manual retry is a new request and requires a
  new consent.
- The user selects the content to send. D4B attaches no workspace document,
  folder, note, or chat history to a request.
- The UI shows provider, endpoint, data classes, estimated payload, and retention.
- No background indexing.
- No automatic tool execution from model output.
- Prompt injection is treated as untrusted content.
- Remote requests go directly from the browser when CORS allows, or through a
  user-configured self-hosted gateway.
- Local providers use a user-configured localhost endpoint.
- MCP servers and tools are out of scope for D4B. Any future tool support uses
  separate capability grants.

### Network egress and CSP

Production `connect-src` allows `'self'`, all HTTPS origins, and loopback HTTP:

```text
connect-src 'self' https: http://localhost:* http://127.0.0.1:*
```

Custom provider origins cannot be known when the static policy is built. The
browser transport therefore re-validates scheme, host, port, userinfo, query,
fragment, and provider kind before every request. Capability grants remain bound
to the exact origin. The broad policy is a documented residual risk, not a
replacement for exact-origin enforcement.

## Security refinement pass 1

This pass tightens credential handling and egress. It does not add a hosted
proxy, bundled key, or mandatory cloud service.

### Threat model additions

- XSS or malicious script reading an unlocked credential.
- Credential leakage through logs, errors, URLs, redirects, or backups.
- Endpoint downgrade, userinfo injection, or cross-origin redirect.
- Consent confusion, payload substitution, or replay of a previous approval.
- Prompt injection causing unintended tool calls or data disclosure.
- Localhost probing and unintended access to local services.
- Secret retention in memory after lock or failed requests.

### Required controls

1. **R-11-1, no raw credential exposure.** Raw credential material is never
   exposed to extension code, logs, or error reports. The entry field is
   write-only: after entry, the host UI never reads back or displays the value.
   The provider adapter receives an internal vault handle and uses it only for the
   approved request. The host UI displays only provider and account labels.
2. **R-11-2, vault hardening.** The vault uses AES-256-GCM with a 128-bit tag, a
   unique 96-bit nonce per encryption, and AAD that binds the vault version and
   provider ID.
   PBKDF2-SHA-256 uses a random 128-bit vault-specific salt, domain separation,
   the same approved initial floor of 600,000 iterations as ADR 0013, and versioned
   parameters. It does not reuse the workspace salt or workspace KDF output.
   Failed unlocks are rate-limited with backoff. Keys are non-extractable and
   never exported.
3. **R-11-3, endpoint validation.** Remote providers require HTTPS. Loopback HTTP
   is allowed only for explicitly configured local providers. Reject userinfo in
   URLs, credentials in query strings, mixed content, and redirects to a
   different origin. Requests use `credentials: "omit"`, a no-referrer policy, and
   an exact origin allowlist.
4. **R-11-4, consent binding.** A consent record is bound to the provider, model,
   endpoint origin, payload hash, data classes, expiry, and one-time use. If the
   payload, model, or destination changes, consent is invalid and must be
   requested again. The UI shows the exact data categories and a payload preview.
5. **R-11-5, no hidden context.** The adapter sends only the content shown in the
   consent preview. It does not add workspace metadata, other notes, or prior
   conversations unless the user selected them.
6. **R-11-6, untrusted responses and tools.** Model output is untrusted content.
   It is never rendered as raw HTML and never executed automatically. Tool calls
   require a per-tool grant, schema validation, an allowlist, and a visible
   preview of the arguments. Citations are validated against the selected
   sources.
7. **R-11-7, request hygiene.** Requests have a maximum payload size and timeout.
   D4B does not retry automatically. A manual retry is a new request with a new
   payload hash and a new consent, even when it targets the same endpoint. Rate and
   concurrency limits prevent runaway usage.
8. **R-11-8, log and error redaction.** Authorization headers, request bodies,
   response bodies, and provider tokens are never logged. Error messages are
   mapped to safe local messages. Telemetry remains absent.
9. **R-11-9, local provider warning.** Configuring a localhost provider is an
   explicit action. The UI warns that the browser will contact the configured
   local service and that other local services must not be exposed. There is no
   automatic discovery.
10. **R-11-10, MCP trust boundary.** MCP servers and tool descriptions are
    untrusted. Tools are installed and granted explicitly per server and per
    tool. Tool output is untrusted content, and no tool runs automatically from a
    model response. D4B does not implement this path.
11. **R-11-11, CSP and exact-origin enforcement.** Production CSP allows all HTTPS
    and loopback HTTP origins because custom providers cannot be enumerated. The
    transport re-validates the exact origin and request shape before every call,
    and capability grants remain origin-bound. The broader CSP is recorded as a
    residual risk.

### Residual risks

- XSS while unlocked can steal plaintext and credential handles. Browser
  JavaScript cannot provide a perfect secret boundary.
- JavaScript memory zeroization is not guaranteed. Locking reduces exposure but
  cannot prove that old buffers are erased.
- A broad CSP `connect-src` allows any HTTPS or loopback origin at the policy
  layer. Exact-origin enforcement depends on the transport and capability code.
- Browser CORS failures are common for remote providers. OpenNest cannot fix a
  provider that does not allow browser origins.
- A malicious provider can retain anything the user sends.
- Provider-side retention and model behavior are outside OpenNest's control.
- PBKDF2 remains weaker than a memory-hard KDF.

### D4B decisions on refinements

- R-11-3 is accepted for D4B: non-HTTPS remote endpoints are rejected.
- R-11-4 is accepted for D4B: consent is payload-bound, one-time, and limited to
  5 minutes.
- R-11-6 is deferred with tools and MCP. D4B rejects both.
- R-11-7 is accepted for D4B: automatic retries are disabled.

## Trade-offs

- Passphrase and unlock friction.
- Lost vault passphrase means lost credentials even when workspace recovery is
  available.
- Browser CORS limits some providers.
- Broad CSP `connect-src` is required for custom providers; exact-origin checks
  move to the transport and capability layer.
- XSS can steal an unlocked key.
- Provider retention and model behavior cannot be guaranteed by OpenNest.

## Security and privacy implications

- Secrets must never reach content storage or default backups.
- Credential vault keys are a separate domain. Cross-domain key reuse is
  forbidden.
- Workspace recovery must not unlock the credential vault.
- The vault has no recovery path in D4B. A future vault recovery must not unlock
  workspace content.
- Prompt and response content must not be logged.
- Data minimization is required.
- Tool execution must be separately authorized.
- Provider origin allowlisting reduces accidental leakage.
- Production CSP allows HTTPS and loopback HTTP; exact-origin enforcement is
  mandatory in the transport and broker.
- A compromised provider can retain anything the user sends.

## Compatibility with Stages A to C

- Core remains AI-agnostic.
- AI reads data through application services and capability checks.
- Backup v1 and backup v2 remain user content only and exclude credentials.
- Workspace E2EE and the credential vault are independent. Enabling one does not
  enable, unlock, or recover the other.
- ADR 0004's local data flow is unchanged.
- D4B completes only the AI half of D4. D4A extension and tool execution remain
  separate.

## Dependencies

- ADR 0008.
- ADR 0009.
- ADR 0013 for shared cryptographic primitives and envelope conventions only.
  ADR 0011 does not use the workspace DEK, workspace KEK, workspace recovery key,
  or backup DEK.
- ADR 0010 optional for AI extensions.

## Migration implications

- New credential vault with its own key hierarchy.
- No existing secrets to migrate.
- No workspace key or backup key is migrated into the vault.
- Credentials are excluded from backup v1 and from backup v2 by default.
- The vault format must be versioned from its first release.

## Approved decisions and remaining approval items

- The PRD says AI is optional, configurable, and never required. This ADR keeps
  that promise. It does not add a built-in free provider or bundled key.
- PBKDF2 is chosen because WebCrypto provides it without a new dependency. Argon2
  is deferred. This is a security trade-off, not a product change.
- Session-only credentials are approved as the D4B default. The vault is optional.
- Credential backup exclusion is approved. A restore cannot recover provider
  access, and the UI must say so.
- Credential-vault key-domain separation is approved. Workspace recovery,
  workspace key rotation, and backup restore never unlock the vault.
- D4B uses no vault recovery. A future optional vault-only recovery key would
  require a separate approval and must remain independent of workspace and backup
  recovery.
- D4A extension, tools, and MCP remain separate approval items.

## Acceptance criteria

- AI remains optional and off by default.
- No network request occurs before consent.
- Keys are session-only or encrypted.
- No secret appears in logs, backups, or exported data.
- Provider adapter tests cover complete, stream, abort, and failure.
- A local provider can be configured without OpenNest Cloud.
- Raw credentials are never exposed to extension code, read back by host UI after
  entry, or written to logs.
- Vault encryption uses unique nonces, AAD binding, versioned KDF parameters, and
  the 600,000-iteration floor.
- Credential-vault keys are separate from workspace and backup keys.
- Workspace recovery cannot open the vault. The vault passphrase cannot open
  workspace content.
- Backup v1 and v2 exclude credentials. Restoring either cannot recover provider
  access.
- The vault auto-locks after 5 minutes. D4B has no vault recovery.
- Vault rotation and key-loss tests prove domain separation.
- Remote endpoint validation rejects downgrade, userinfo, and cross-origin
  redirects.
- Consent is one-time, payload-bound, bound to provider, model, origin, payload
  hash, data classes, session, and expiry, and limited to 5 minutes.
- D4B rejects tool calls and MCP and makes no tool-call claim. Future tool support
  requires per-tool consent and schema validation.
- There are no automatic retries. A manual retry requires new consent.
- Production CSP allows HTTPS and loopback HTTP; the transport and broker enforce
  the exact origin.
- Request and response logging is redacted.
- Localhost provider configuration shows an explicit warning.
- D4B does not complete D4 while D4A extension is missing.

## Testing strategy

- Mock provider tests.
- Network interception tests.
- Credential vault tests with WebCrypto vectors.
- Nonce uniqueness and AAD-mismatch tests.
- Cross-domain key separation tests: a workspace key cannot decrypt vault data, a
  vault key cannot decrypt workspace data, and a backup key cannot decrypt vault
  data.
- Vault rotation and key-loss tests.
- Consent E2E tests, including payload substitution, replay, TTL, and no-retry.
- Auto-lock, lock, and key-loss tests.
- Secret scanning in logs and backups.
- Endpoint redirect, downgrade, userinfo, and mixed-content tests.
- CSP and exact-origin enforcement tests.
- Tool and MCP rejection tests.
- CORS, timeout, abort, and failure-path tests.
- Localhost warning and no-auto-discovery tests.
