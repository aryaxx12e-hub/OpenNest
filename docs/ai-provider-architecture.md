# AI provider architecture

Status: D4B design accepted on 2026-11-17. Implementation has not started. This
document describes the target architecture for the AI half of Stage D4. D4A
extension work remains separate, and this document does not claim that D4 is
complete.

Binding decisions are in ADR 0011. Credential storage is described in
[credential-vault.md](./credential-vault.md). The release gate is
[ai-security-review.md](./ai-security-review.md).

## Scope

D4B covers:

- An off-by-default AI runtime.
- A provider registry for OpenAI-compatible endpoints.
- Local and remote providers, with session-only credentials by default.
- An optional passphrase-encrypted credential vault.
- One-time, payload-bound consent before every external request.
- Chat completions, streaming responses, embeddings, and health checks.
- Safe local errors, abort, timeout, and response-size limits.
- Plain-text rendering of untrusted model output.
- Privacy Center inventory, consent history, and delete-all cleanup.

D4B does not cover:

- Tools, function calling, MCP execution, or an MCP client.
- Workspace documents, notes, folders, files, or chat history in a request.
- Background indexing or automatic context injection.
- Automatic retries.
- A hosted proxy, account, billing, or usage metering.
- Extension access to credentials or AI handles.
- Vault recovery.
- A security or privacy claim before implementation and review.

## Components and boundaries

| Component                    | Responsibility                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| `@opennest/ai`               | Provider contracts, endpoint validation, registry, presets, payload hashing, and adapters. |
| `@opennest/privacy`          | Consent registry, capability policy, broker, grant revocation, and audit metadata.         |
| `@opennest/credential-vault` | Vault key hierarchy, record parsing, entry encryption, rotation, and secret access.        |
| `apps/web/lib/ai`            | Browser transport, AI runtime, provider store, error mapping, and app lifecycle.           |
| `apps/web/lib/credentials`   | Vault store, session credential store, and provider-bound credential resolution.           |

The AI package does not import workspace storage. The privacy package does not
store prompts or responses. The vault package does not know about workspace
keys, backup keys, or workspace content.

## Provider model

A provider config contains:

- `id` and `label`.
- `kind`: `local`, `remote`, `custom`, or `mcp`.
- `adapter`: `openai-compatible` in D4B.
- `endpoint`.
- A non-empty, duplicate-free model list.
- Capabilities: `chat`, `embedding`, `vision`, and `tools`.
- Auth: `none`, `bearer`, or `x-api-key`.
- An optional data policy URL.
- Optional context and output token limits.
- Created and updated timestamps.

D4B rejects `kind: "mcp"` and any capability list containing `"tools"`. The
provider is configured only for what the adapter can actually do. A provider
config never contains a key.

Presets are configuration templates, not bundled credentials:

- OpenAI-compatible.
- Ollama on loopback.
- LM Studio on loopback.
- Custom OpenAI-compatible endpoint.

The registry validates IDs, labels, models, capabilities, auth, token limits, and
data policy URLs. Unknown fields and unsupported values fail closed.

## Endpoint policy

Remote providers require HTTPS. Loopback HTTP is allowed only for an explicitly
configured local provider.

The validator rejects:

- `http:` for remote or custom providers.
- Non-HTTP protocols.
- Userinfo in the URL.
- Query strings and fragments.
- Wildcard, empty, or malformed hosts.
- Mixed content.
- Paths that escape the configured provider base.

The normalized origin is scheme, host, and port. It is the origin shown in the
consent dialog and the origin bound to the network capability. `joinEndpoint`
appends only known OpenAI-compatible paths such as `/chat/completions`,
`/embeddings`, and `/models`.

The browser transport re-validates the URL, origin, protocol, userinfo, query,
fragment, and provider kind immediately before `fetch`. The provider cannot
supply arbitrary headers. The transport injects only the configured auth header.

Every request uses:

- `credentials: "omit"`.
- `referrerPolicy: "no-referrer"`.
- `redirect: "error"`.
- `cache: "no-store"`.
- `mode: "cors"`.

The request limit is 256 KiB, the response limit is 2 MiB, the normal timeout is
60 seconds, and the streaming timeout is 120 seconds.

## CSP and the exact-origin boundary

Production CSP uses:

```text
connect-src 'self' https: http://localhost:* http://127.0.0.1:*
```

Custom provider origins cannot be known when the static policy is built, so the
policy cannot enumerate them. The transport and capability broker therefore
enforce the exact origin. A broader CSP is not permission to contact an
unapproved provider.

The CSP keeps development `ws:` and `wss:` support. It never includes a broad
`http:` source for non-loopback hosts.

## Consent model

AI is off by default. A missing enabled flag means disabled. No request reaches
the transport until the user approves the exact prepared payload.

A consent record binds:

- The session and principal.
- The provider and model.
- The normalized endpoint origin.
- The SHA-256 hash of the exact request body bytes.
- The body size in bytes.
- The data classes.
- The purpose.
- Creation and expiry timestamps.
- Used and revoked state.

D4B rules:

- Consent is one-time.
- The maximum lifetime is 5 minutes.
- The payload hash covers exactly the bytes sent.
- The provider is re-read and the payload is re-prepared before sending. A change
  in provider config, model, origin, body, data classes, or credential choice
  invalidates the preview.
- Grants are session-only, one-use, and bound to the consent ID.
- Revoking the consent revokes its grants and aborts an active handle.
- A retry is a new request and requires new consent.
- Consent records never contain the prompt, response, or secret.

AI requests may use only data classes `D1` and `D2`. D4B attaches no workspace
content. The console prompt is `D2`. The provider config is `D1`.

## Request flow

1. The UI asks the AI runtime to prepare a request.
2. The runtime loads the provider config and validates the endpoint, model, auth,
   data classes, and size.
3. The adapter builds the exact JSON body and returns the endpoint, origin, hash,
   and byte size.
4. The UI shows the consent dialog with provider, origin, model, data classes,
   byte size, credential label, and prompt preview.
5. The user approves.
6. The runtime re-reads the provider and re-prepares the request. Hash or origin
   changes fail with `payload_changed`.
7. The runtime creates a one-time consent and session-only grants for
   `ai.invoke:<provider>`, `network.connect:<origin>`, and optionally
   `credential.use:<provider>`.
8. The runtime appends `ai.requested`, consumes the consent with the exact
   expectation, and invokes the transport through the broker.
9. The transport resolves the credential handle, injects the auth header, sends
   the exact bytes, and limits the response.
10. The adapter parses the response. The UI renders text only.
11. The runtime appends `ai.completed`, `ai.failed`, or `ai.aborted` with safe
    reason codes.

Any failure before consumption revokes the created grants and consent. A failed
audit write blocks the request.

## Transport and response handling

The browser transport is the only network edge for AI. It accepts an allowed
origin, request bytes, credential handle, abort signal, timeout, and response
limit. It rejects a credential whose provider ID does not match and a credential
provided for `auth: "none"`.

The response reader enforces the byte limit while streaming. Crossing the limit
aborts the request and returns `response_too_large`. Timers and readers are
cleared on success, error, timeout, and abort.

Errors are mapped to safe local codes:

- `ai_disabled`
- `provider_not_found`
- `model_not_allowed`
- `invalid_endpoint`
- `credential_missing`
- `credential_provider_mismatch`
- `payload_too_large`
- `payload_changed`
- `consent_expired`
- `consent_used`
- `consent_revoked`
- `consent_mismatch`
- `network_error`
- `unauthorized`
- `forbidden`
- `rate_limited`
- `provider_error`
- `malformed_response`
- `response_too_large`
- `timeout`
- `aborted`

Errors never include request bodies, response bodies, headers containing secrets,
or raw provider messages. There are no automatic retries.

## Data classes and storage

| Data                     | Class | Location                | Backup v1 | Backup v2 |
| ------------------------ | ----- | ----------------------- | --------- | --------- |
| AI enabled flag          | D1    | `opennest-ai` IndexedDB | No        | No        |
| Provider config          | D1    | `opennest-ai` IndexedDB | No        | No        |
| Session credential       | D3    | Memory                  | No        | No        |
| Vault record and entries | D3    | `opennest-credentials`  | No        | No        |
| Consent record           | D4    | `opennest-privacy`      | No        | No        |
| Prompt and response      | D2    | Memory only             | No        | No        |
| AI audit metadata        | D4    | `opennest-privacy`      | No        | No        |

Consent records store metadata and the payload hash only. Audit entries store
provider, capability, scope digest, outcome, and safe reason codes. Neither store
receives prompt text or response text.

Prompts and responses are not persisted. There is no chat history in D4B.

## UI behavior

Settings contains:

- A single AI on/off control, off by default.
- Provider list, create, edit, and delete.
- A link to `/ai`, disabled while AI is off.
- Session credential create and remove.
- Vault setup, unlock, lock, passphrase change, rotation, and delete.
- Vault entry create, update, and remove.

The provider dialog shows presets, endpoint, models, auth, data policy URL, token
limits, and a warning for local or loopback providers. The warning must be
acknowledged before saving.

The `/ai` console contains provider and model selects, a prompt, a credential
select, a stream toggle, and a review action. It shows empty states for AI off, no
provider, no credential, and locked vault.

The consent dialog shows the exact preview and states that no workspace files,
notes, folders, or chat history are attached. On approval the send action is
disabled while the request is active. The response is rendered as text in a
`<pre>` or with `white-space: pre-wrap`. It is never rendered as HTML or Markdown.

Provider deletion removes session credentials for that provider. Vault entries
are kept and marked unlinked until the user removes them.

## Backup, restore, and deletion

Provider configs, AI settings, consents, session credentials, and vault records
are excluded from backup v1 and backup v2. Restoring a backup cannot restore
provider access. The user must re-enter credentials after a restore.

Delete-all clears the AI store, AI settings, consents, vault record, and session
credentials. AI is disposed before credentials, and credentials before privacy.
After deletion, AI is disabled and every provider is gone.

## Failure behavior

- AI off: no adapter, no credential lookup, no network.
- Provider missing or model unknown: local error before consent.
- Missing credential or wrong provider: local error before consent.
- Preview changed: `payload_changed`, no send, no consent consumed.
- Consent expired, used, or revoked: no send.
- Offline or CORS failure: `network_error`, no silent retry.
- Timeout or abort: local error, active handles aborted.
- Malformed or oversized response: local error, no partial render as successful.
- Locked vault: credential unavailable until unlock.
- Browser storage eviction: report missing config or vault; never invent data.

## Open gaps

- D4A extension and sandbox are not implemented.
- No external review of the AI provider, consent, or vault design has started.
- CORS still limits some remote providers.
- XSS while unlocked can read credentials or use handles.
- JavaScript memory zeroization is not guaranteed.
- Provider retention and model behavior cannot be controlled by OpenNest.
- PBKDF2 is weaker than a memory-hard KDF.
- The vault has no recovery in D4B.
- Tools, MCP, document context, and chat history are intentionally absent.
