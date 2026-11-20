# Stage E gate register

Status: open. No gate in this register is closed.

This register is the release gate for Stage E. It does not replace the Stage D
security review. A gate closes only when the evidence is recorded, reviewed, and
linked here. A design decision or an internal test run does not close an external
review gate.

Last updated: 2026-11-19
Owner: Rya
Design: `docs/superpowers/specs/2026-11-18-stage-e-ai-sync-collaboration-design.md`
Plan: `docs/superpowers/plans/2026-11-18-stage-e-ai-sync-collaboration.md`

## Gate summary

| ID        | Gate                                    | Status   | Blocks release | Evidence                                                                                                               | Close condition                                                                    |
| --------- | --------------------------------------- | -------- | -------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| E-GATE-01 | Stage D overall security review         | Open     | Yes            | `docs/stage-d-security-review.md`                                                                                      | Independent reviewer signs the extension, AI, E2EE, and overall records.           |
| E-GATE-02 | Extension sandbox external review       | Open     | Yes            | `docs/extension-security-review.md`                                                                                    | Independent extension review signs the record with a commit and date.              |
| E-GATE-03 | AI and credential vault external review | Open     | Yes            | `docs/ai-security-review.md`                                                                                           | Independent AI and vault review signs the record with a commit and date.           |
| E-GATE-04 | External cryptographic review           | Open     | Yes            | `docs/e2ee-security-review.md`                                                                                         | Independent cryptography review signs the E2EE implementation record.              |
| E-GATE-05 | E2EE claim gate, including R-13-7       | Open     | Yes            | `docs/adr/0013-e2ee-key-management-strategy.md`                                                                        | R-13-7 is closed or sync is explicitly excluded everywhere from the claim.         |
| E-GATE-06 | Hosted CI first run                     | Open     | Yes            | `.github/workflows/ci.yml`                                                                                             | The workflow runs on a hosted runner and the required checks pass.                 |
| E-GATE-07 | Collaboration security review           | Open     | Yes            | `docs/adr/0016-server-auth-and-tenant.md`, `docs/adr/0018-real-time-collaboration.md`, `scripts/e2e-collaboration.mjs` | Review covers auth, membership, WebSocket, room isolation, limits, snapshots.      |
| E-GATE-08 | AI egress review for document Q&A       | Open     | Yes            | `docs/adr/0019-ai-document-qa-and-egress.md`, `scripts/e2e-ai-qa.mjs`                                                  | Review covers consent, data classes, payload minimization, logging, retention.     |
| E-GATE-09 | MCP security review                     | Open     | Yes            | `docs/adr/0020-mcp-server.md`, `scripts/e2e-mcp.mjs`                                                                   | Review covers token scope, revocation, read-only tools, limits, audit.             |
| E-GATE-10 | Self-hosted release operations review   | Open     | Yes            | `docs/self-hosting-evaluation.md`, `docs/self-hosting.md`                                                              | TLS, backup, restore, migration, rollback, delete-all, single-writer are verified. |
| E-GATE-11 | Stage E release evidence                | Open     | Yes            | This register, `docs/stage-e-release-checklist.md`                                                                     | All blocking gates close and the full verification suite passes.                   |
| E-GATE-12 | Cloud synchronization                   | Deferred | No, deferred   | `docs/adr/0015-self-hosting-boundary.md`                                                                               | A separate cloud ADR, operations plan, and security review are approved.           |

## Stage D dependencies

Stage E does not close while any of these remain open:

- E-GATE-01: the Stage D overall security review has no assigned external reviewer.
- E-GATE-02: the extension sandbox review has no assigned external reviewer.
- E-GATE-03: the AI and credential-vault review has no assigned external reviewer.
- E-GATE-04: the cryptographic review has no assigned external reviewer.
- E-GATE-05: R-13-7 remains open, so no E2EE claim is allowed.
- E-GATE-06: the repository has no remote, so the hosted CI workflow has never run.

The internal Stage D audit is complete. It is not an external sign-off.

## Collaboration dependencies

- E-GATE-07 must cover HTTP authorization, sync push and pull, WebSocket
  handshake, room isolation, viewer denial, update limits, snapshot transactions,
  presence non-persistence, and member revocation.
- Shared workspace content is visible to the server operator. No shared workspace
  E2EE claim is allowed.
- The server remains single-process for the first release. Multi-process support
  needs a separate design and review.

## AI dependencies

- E-GATE-08 must cover per-request consent, payload binding, `D2` document
  classification, forbidden `D3` secrets, request and response limits, logging,
  and provider retention disclosure.
- AI document Q&A cannot claim confidentiality. It is not E2EE.
- PDF and OCR support are deferred and need a separate extraction design.

## MCP dependencies

- E-GATE-09 must cover workspace-scoped hashed bearer tokens, owner-only token
  management, read-only tools, cross-workspace denial, output limits, rate limits,
  audit redaction, and external client disclosure.
- MCP is disabled by default and is unavailable in local-only mode.
- OpenNest is not an MCP client and does not execute MCP tools.

## Release evidence required

Before Stage E release, record all of the following in this register or in a
linked release checklist:

1. The commit under review.
2. The external reviewer names and sign-off dates.
3. The full non-browser gate output: lint, format check, typecheck, tests, build.
4. The browser E2E output for sync, collaboration, AI Q&A, and MCP.
5. The dependency audit result and accepted risks.
6. The self-hosted deployment verification for TLS, backup, restore, migration,
   rollback, delete-all, and single-writer.
7. The final product copy review for E2EE, AI, extension, and MCP claims.
8. The Stage D gates status at the time of release.

## Internal evidence status

Recorded on 2026-11-19 on the Termux reference environment (Node 24.22.3). This is
internal automated evidence, not an external sign-off:

- `npm run lint`: passed.
- `npm run format:check`: passed.
- `npm run typecheck`: passed.
- `npm test`: 185 test files, 1666 tests passed; browser graph clean with 113
  reachable files.
- `npm run build`: passed with 16 routes (14 static pages) and a generated
  service worker with 60 precached paths.
- `node scripts/e2e-sync.mjs`: passed.
- `node scripts/e2e-collaboration.mjs`: passed.
- `node scripts/e2e-ai-qa.mjs`: passed.
- `node scripts/e2e-mcp.mjs`: passed.

The test run prints a Vite `configLoader` warning about ESM syntax in
`vitest.config.ts`, a mixed esbuild/oxc options warning, and a happy-dom
environment-creation notice. None is a failure.

Browser E2E was not run. The app has no login, invite, shared-workspace binding,
Q&A source picker, or MCP token management surface yet. The release checklist
records those blockers. No external gate is closed by this evidence.

## Claim status

OpenNest makes no E2EE claim for shared workspaces, no AI confidentiality claim,
no extension sandbox security claim, and no MCP isolation claim.

The correct product language remains:

- Shared workspace content is visible to the server operator.
- AI document Q&A sends selected content to the configured provider after
  per-request consent.
- Local sideload extensions run in a sandbox, but the independent extension
  review is not complete.
- MCP is read-only and disabled by default, but the independent MCP review is not
  complete.
- Optional personal workspace encryption is implemented and has not been
  independently reviewed. Metadata remains plaintext.
