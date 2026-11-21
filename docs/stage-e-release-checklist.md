# Stage E release checklist

Status: blocked for a Stage E release. Do not publish a Stage E release while any
external gate in `docs/stage-e-gate-register.md` is open. This checklist records
evidence; it does not replace an independent review.

The source-only `v0.1.0-beta.1` early access preview is not a Stage E release. It
may be published while this checklist remains blocked. It closes only E-GATE-06
and does not approve a hosted beta, a production release, or a Stage E claim.

Last updated: 2026-11-21
Owner: Rya
Gate register: `docs/stage-e-gate-register.md`
Self-hosting guide: `docs/self-hosting.md`

## 1. Code and scope

- [ ] Release candidate commit recorded.
- [ ] Scope matches the approved Stage E design and plan.
- [ ] No deferred feature is described as shipped.
- [ ] No public claim of E2EE, AI confidentiality, extension sandbox security, or
      MCP isolation.
- [ ] Local-only mode still works without a server or account.

## 2. Non-browser gates

| Gate                       | Command                       | Result                                                                      | Evidence   |
| -------------------------- | ----------------------------- | --------------------------------------------------------------------------- | ---------- |
| Lint                       | `npm run lint`                | Passed                                                                      | 2026-11-21 |
| Format check               | `npm run format:check`        | Passed                                                                      | 2026-11-21 |
| Type check                 | `npm run typecheck`           | Passed                                                                      | 2026-11-21 |
| Unit and integration tests | `npm test`                    | Passed: 187 files, 1680 tests                                               | 2026-11-21 |
| Production build           | `npm run build`               | Passed: 16 routes (14 static pages), service worker with 61 precached paths | 2026-11-21 |
| Browser graph              | `npm run check:browser-graph` | Passed: 113 reachable files                                                 | 2026-11-21 |

Record exact test file and test counts. Do not record a pass without the command
output. The test run prints a Vite `configLoader` warning about ESM syntax in
`vitest.config.ts`, a mixed esbuild/oxc options warning, and a happy-dom
environment-creation notice; none is a failure.

## 3. Protocol E2E gates

These scripts exercise the server and controller surfaces. They are not a
substitute for browser UI journeys.

| Journey                                                          | Command                              | Result | Evidence   |
| ---------------------------------------------------------------- | ------------------------------------ | ------ | ---------- |
| Sync, viewer denial, sync conflict, file conflict copy           | `node scripts/e2e-sync.mjs`          | Passed | 2026-11-19 |
| Collaboration presence, reconnect, offline update, viewer denial | `node scripts/e2e-collaboration.mjs` | Passed | 2026-11-19 |
| AI Q&A consent and citation validation                           | `node scripts/e2e-ai-qa.mjs`         | Passed | 2026-11-19 |
| MCP token scope and cross-workspace denial                       | `node scripts/e2e-mcp.mjs`           | Passed | 2026-11-19 |

## 4. Browser E2E gates

Environment note: the protocol scripts above are headless server and controller
tests. They do not exercise the Next.js UI.

Source-preview evidence: `npm run test:e2e` passed on 2026-11-21 for the Stage C
journeys, PWA offline and update flow, encryption, the AI console, and
extensions. This does not satisfy the Stage E browser gates below.

- [ ] Sync and collaboration journeys run in a browser against the production
      build.
- [ ] File conflict copy is visible in the library UI.
- [ ] AI Q&A consent and citation links are reachable from an approved host page.
- [ ] MCP token management is reachable from an owner settings surface.
- [ ] Mobile viewport and both themes are checked.

Current browser blockers:

- The app has no login or invitation UI, so browser sessions cannot be created
  through the product.
- The app data surface is browser-local and is not bound to the server
  workspace.
- Collaboration requires build-time
  `NEXT_PUBLIC_OPENNEST_SHARED_WORKSPACE` and
  `NEXT_PUBLIC_OPENNEST_COLLABORATION_URL`.
- The Q&A panel has no mounted source picker.
- MCP token management has no mounted settings surface.

Do not mark a browser journey passed based on the protocol E2E scripts.

## 5. Self-hosted deployment verification

Not executed on 2026-11-19. The reference Termux environment has no Docker
daemon or TLS reverse proxy. The runbook is documented in
`docs/self-hosting.md`; the checks below still need a real deployment.

- [ ] TLS termination and HTTPS secure cookies verified.
- [ ] Reverse proxy WebSocket upgrade verified at `/api/collaboration`.
- [ ] `OPENNEST_PUBLIC_URL` matches the browser origin.
- [ ] Data directory permissions restrict access to the service account.
- [ ] Backup created with the service stopped.
- [ ] Restore tested from that backup.
- [ ] Failed restore rolled back to the pre-restore copy.
- [ ] Upgrade migration tested from the previous schema.
- [ ] Rollback tested with the pre-upgrade backup.
- [ ] Delete-all verified to remove databases and blobs.
- [ ] Single-writer constraint documented and enforced.
- [ ] MCP disabled by default and token revocation verified.
- [ ] No encryption-at-rest claim appears in product or deployment copy.

## 6. Security and privacy review

- [ ] E-GATE-01 Stage D overall security review signed.
- [ ] E-GATE-02 Extension sandbox external review signed.
- [ ] E-GATE-03 AI and credential vault external review signed.
- [ ] E-GATE-04 External cryptographic review signed.
- [ ] E-GATE-05 E2EE claim gate closed, or sync explicitly excluded from the
      claim everywhere.
- [x] E-GATE-06 Hosted CI first run passed: run `44847771841` on `6447401`.
- [ ] E-GATE-07 Collaboration security review signed.
- [ ] E-GATE-08 AI egress review signed.
- [ ] E-GATE-09 MCP security review signed.
- [ ] E-GATE-10 Self-hosted release operations review signed.
- [ ] E-GATE-11 Stage E release evidence complete.
- [ ] E-GATE-12 remains deferred unless a separate cloud ADR is approved.

## 7. Claims and copy

- [ ] README, SECURITY.md, docs, and in-app copy agree on current guarantees.
- [ ] Shared workspace content is described as visible to the server operator.
- [ ] AI Q&A is described as provider egress after consent, not confidential.
- [ ] Extension sandbox review is described as pending.
- [ ] MCP is described as read-only, off by default, and awaiting review.
- [ ] Optional browser encryption is described as unreviewed, with plaintext
      metadata and no shared-workspace E2EE claim.

## 8. Release decision

- [ ] All blocking gates closed.
- [ ] Release notes list limitations and deferred work.
- [ ] Rollback owner and backup location recorded.
- [ ] Security owner signs the final claim review.
- [ ] Release approved.

Approval is invalid if any blocking gate is open, even when all automated gates
pass. A source-only preview does not satisfy this release decision.
