# ADR 0019: AI document Q&A and egress

- Status: Accepted for implementation; AI egress review pending
- Date: 2026-11-18
- Accepted: 2026-11-18
- Context: Stage E AI, Sync, and Collaboration
- Related: ADR 0008, ADR 0009, ADR 0011, ADR 0013
- Product conflict: none; the feature is off by default and consent-gated
- Design: `docs/superpowers/specs/2026-11-18-stage-e-ai-sync-collaboration-design.md`
- Plan: `docs/superpowers/plans/2026-11-18-stage-e-ai-sync-collaboration.md`

## Context and problem

Stage D implemented optional AI providers and a credential vault under ADR 0011.
D4B supports chat, streaming, embeddings, and health, but deliberately excludes
document context, chat history, and tools.

Document Q&A adds a new egress boundary: selected workspace content leaves the
browser for a remote provider. It also adds a new correctness boundary: an answer
without a valid citation is not trustworthy enough to present as document-backed.
OpenNest must not build a persistent plaintext search index or silently upload a
library to make retrieval work.

## Goals

- Answer questions about selected Markdown notes and text-readable files.
- Produce citations that map to the content actually supplied.
- Keep retrieval local.
- Keep remote egress explicit, per request, and payload-bound.
- Keep AI off by default.
- Keep the core application fully functional without AI.

## Non-goals

- OCR or PDF text extraction.
- Image, audio, or video understanding.
- Whole-library upload or background indexing.
- Persistent embeddings or a vector database.
- Chat history, long-term memory, or automatic context carry-over.
- Tool use, MCP execution, or autonomous agents.
- Fine-tuning.
- AI confidentiality or E2EE claims.
- AI features in a shared workspace that bypass workspace authorization.

## Constraints

- ADR 0008 data classes are binding. `D3` means secrets and must never be used for
  document content.
- The existing AI runtime accepts only `D1` and `D2` request classes.
- Selected document text is `D2`.
- The prompt is derived `D4` data and inherits the source handling policy.
- No secret, credential, capability grant, or key material may enter the prompt.
- AI is off by default.
- Request limit: 256 KiB.
- Response limit: 2 MiB.
- Consent lifetime: 5 minutes, one-time, payload-bound.
- Stage D AI and credential-vault review remains open.
- Stage D E2EE claim gate remains open.

## Alternatives considered

1. Upload the whole workspace and let the provider retrieve. Rejected because it
   violates data minimization and makes consent meaningless.
2. Build a local vector index and send embeddings. Rejected for the first release
   because it adds a persistent derived index and a larger migration surface.
3. Use local full-text candidates and in-memory chunking, then send only selected
   passages after consent. Recommended.
4. Use only local models. Rejected as the only option because users may configure
   a remote provider, but local providers remain supported.
5. Let the model return free-form references without validation. Rejected because
   fabricated citations are worse than no answer.

## Decision

### Source scope

- Q&A covers Markdown notes and text-readable files only.
- Text-readable means a supported textual MIME type that the application can
  decode safely. The exact allowlist is defined in the implementation and shared
  with the file UI.
- PDFs, images, audio, video, archives, and binary files are excluded.
- A file that cannot be decoded as text is excluded with a clear user-facing
  message. It is not sent to a provider.
- The user selects the notes or files to search. Whole-library upload is never
  implicit.

### Local retrieval

- Retrieval starts from the existing local full-text search candidates.
- Candidates are chunked in memory for the request.
- Chunking is deterministic for the same content and range.
- Each passage receives a stable request-local ID such as `S1`, `S2`, and so on.
- A passage records its source type, source ID, display label, and character
  range.
- No persistent plaintext retrieval index, embedding, or vector store is created.
- Retrieval is bounded by passage count and total bytes. Content over the request
  limit is excluded or requires a smaller selection.
- Search snippets, passages, and prompts are derived data. They are not written to
  backups, logs, or audit records.

### Data classes and secrets

- Selected document text is sent as `D2`.
- `D3` is forbidden for document Q&A. `D3` is the secrets class defined by ADR
  0008 and must never be repurposed as document content.
- The provider prompt is derived `D4` data and inherits the handling policy of its
  `D2` source.
- Credentials, provider handles, session tokens, capability grants, MCP tokens, and
  key material never enter a prompt, citation, response, or audit record.
- The AI runtime's existing `D1`/`D2` restriction remains binding. This ADR does
  not widen it to `D3`.

### Consent and egress

- A remote request requires explicit per-request consent.
- Consent is bound to the provider, model, endpoint origin, payload hash, data
  classes, purpose, and expiry.
- Consent expires after 5 minutes and is one-time.
- If the payload, provider, model, endpoint, or data classes change, the user must
  consent again.
- The consent UI shows the selected sources, estimated payload, provider, model,
  endpoint, data classes, and retention warning.
- There are no automatic retries. A retry is a new request and needs new consent.
- Cancellation aborts the request.
- A local provider does not cross the network boundary, but the user still
  explicitly starts the request. The UI identifies local execution.
- Remote requests use the existing endpoint validation, exact-origin enforcement,
  and credential-vault boundary from ADR 0011.
- AI is disabled when no provider is configured or the feature flag is off.

### Request and response limits

- The request is rejected above 256 KiB.
- The response is rejected above 2 MiB.
- Content is not silently truncated to fit. The user must reduce the selection.
- The request has a bounded passage count and a bounded answer length.
- Errors return stable codes and do not include prompt text in logs or UI errors.

### Citation validation

- The prompt gives the model numbered passage IDs and requires citations in a
  defined format.
- The response parser accepts only supplied passage IDs.
- Unknown, malformed, or out-of-range citations are removed.
- Citation text is escaped before rendering.
- A citation links back to the source note or text file and the passage range.
- If no valid citation remains, the answer is marked unsupported. It is not
  presented as a document-backed answer.
- A valid citation proves the passage was supplied, not that the answer is
  correct. The UI keeps the source visible for user verification.

### Audit and privacy

- Audit records metadata only: actor, provider, model, data classes, source count,
  request size, citation count, result, and timestamp.
- Audit records never contain the question, prompt, passages, answer, or
  credentials.
- The Privacy Center shows that AI Q&A sent selected document content to the
  configured provider.
- The feature does not create background jobs or persist AI answers as derived
  content unless the user explicitly saves a note.

## Consequences

- Document Q&A depends on the existing full-text search and file preview
  boundaries.
- The feature remains unavailable for PDFs and images until a separate extraction
  design is approved.
- Remote answers require a provider that supports the configured model and
  citation format.
- The user may still send sensitive selected content to a remote provider. The
  consent UI and documentation must be explicit about that boundary.
- No E2EE or AI confidentiality claim is created by this ADR.

## Residual risks

- Prompt injection inside selected content can try to change model behavior.
- A provider may retain or log a request under its own policy.
- Citation validation does not prove factual correctness.
- A user can select sensitive content and consent to send it.
- A compromised browser session can read selected content while unlocked.
- Passage bounds and response limits do not prevent all denial-of-service or cost
  abuse.

## Gate conditions

This ADR approves implementation, not an AI confidentiality claim. Document Q&A
is ready for release only when:

1. The AI egress review covers consent binding, payload minimization, endpoint
   validation, logging, and provider retention disclosure.
2. Tests prove no request occurs without consent.
3. Tests prove `D3` is rejected and only `D1`/`D2` are accepted.
4. Tests prove unknown citations are removed and unsupported answers are marked.
5. Tests prove request and response limits are enforced.
6. Tests prove audit records contain no question, prompt, passage, answer, or
   credential.
7. The Stage E gate register records the evidence.
