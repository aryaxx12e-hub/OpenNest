# ADR 0015: Self-hosting boundary

- Status: Accepted
- Date: 2026-11-18
- Context: Stage D Privacy, Security, and Extensibility
- Related: ADR 0003, ADR 0004, ADR 0008, ADR 0012, ADR 0013, ADR 0014
- Product conflict: none
- Evaluation: `docs/self-hosting-evaluation.md`
- Implementation plan: `docs/superpowers/plans/2026-11-18-stage-d-remaining.md`

## Context

The PRD lists a self-hosting architecture evaluation in Stage D and a self-hosted
server only for Stage E if the evaluation approves it. OpenNest already has a
browser adapter and a SQLite adapter that pass the same conformance suite, but no
HTTP layer, authentication, tenant model, deployment pipeline, or server
operations contract.

Writing a server before those decisions exist would create an unsupported
deployment path and would weaken the privacy boundaries in ADR 0008.

## Decision

The Stage D self-hosting evaluation is complete. Stage E may design a
single-user, single-tenant Node server using the SQLite adapter and a filesystem
blob root.

This ADR does not approve multi-user access, collaboration, federation, public
exposure, or a hosted service. Those require a separate authentication and tenant
ADR, a multi-user threat model, and a collaboration security review.

Stage D adds no server code.

## Consequences

- No HTTP API, route handler, daemon, or server composition root is added in
  Stage D.
- No authentication or authorization implementation is added.
- No deployment pipeline, container image, or hosting support is added.
- No multi-process or clustered deployment claim is made. Startup reconciliation
  remains single-writer.
- No self-hosting support claim is made. Documentation must describe the server
  as a Stage E candidate, not a shipped feature.
- The browser PWA and its local data flow remain the supported product.
- Stage E must still close the Stage D security review, external cryptographic
  review, and E2EE claim gate before relying on encrypted server storage.
- A future server model must use the existing ports, validation, and backup
  formats. It must not fork the data model.

## Alternatives considered

1. Approve a single-user server now. Rejected because no authentication, TLS,
   file-serving, audit, backup, or operations contract exists.
2. Approve a public multi-user service. Rejected because there is no tenant
   isolation, multi-user threat model, or collaboration review.
3. Reject self-hosting entirely. Rejected because a single-user server is a
   reasonable Stage E candidate and the PRD requires an evaluation, not a
   permanent prohibition.
4. Record the evaluation and defer implementation. Recommended.
