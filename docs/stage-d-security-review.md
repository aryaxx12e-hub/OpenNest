# Stage D security review

Status: internal audit complete; independent review not started. This is not a
security report and it does not close the Stage D gate. Stage E internal
automated evidence is recorded below; external Stage E gates remain open.

## Scope

This dossier covers the Stage D security-sensitive surface:

- Privacy Center, data inventory, consent history, audit metadata, and delete-all.
- Backup and restore, including backup v1, backup v2, validation, and rollback.
- SQLite storage, startup reconciliation, interrupted restore, and blob cleanup.
- D4A local sideload extensions: manifest, integrity, sandbox, host API, grants,
  storage, lifecycle, safe mode, audit, and backup exclusion.
- D4B AI providers and credential vault: off-by-default behavior, consent,
  transport, endpoint validation, CSP, vault, audit, and backup exclusion.
- D3 optional workspace encryption: key hierarchy, envelopes, migration,
  encrypted drafts, encrypted backups, rotation, recovery, and lock behavior.
- PWA cache boundaries and the production content security policy.
- File handling and preview paths, including the no-execution rule.
- Dependency supply chain.
- Self-hosting boundary and the single-writer startup constraint.

## Out of scope

- Sync, collaboration, MCP execution, and a self-hosted server. Stage D adds no
  server code and no sync transport.
- External storage adapters. ADR 0014 defers a third adapter.
- A compromised device, browser, browser extension, or operating system.
- Metadata confidentiality. Titles, filenames, tags, folder names, sizes,
  timestamps, and sync metadata remain plaintext under content encryption.
- Reliable JavaScript memory zeroization.
- Provider-side retention and model behavior.
- Independent cryptographic review, which remains an external gate.

## Evidence

| Area                                 | Evidence                                             | Command                                                                                                                                                              | Result                                                                      | Date       |
| ------------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------- |
| Dependency audit                     | Final audit after the Vitest upgrade                 | `npm audit --audit-level=high`                                                                                                                                       | 0 high, 0 critical, 11 moderate dev-only advisories                         | 2026-11-18 |
| Unsafe rendering and execution sinks | Production sink search                               | `git grep -n -E "dangerouslySetInnerHTML\|innerHTML\|outerHTML\|document\\.write\|eval\\(\|new Function" -- apps packages`                                           | 1 production hit, classified safe; 0 test-only hits                         | 2026-11-18 |
| Targeted security suites             | Extensions, AI, credentials, crypto, privacy, SQLite | `node scripts/vitest.mjs run apps/web/lib/extensions apps/web/lib/ai apps/web/lib/credentials apps/web/lib/crypto apps/web/lib/privacy packages/storage-sqlite`      | 29 files, 338 tests passed                                                  | 2026-11-18 |
| PWA and CSP                          | Manifest, extension assets, and production headers   | `node scripts/vitest.mjs run apps/web/__tests__/next-config.test.ts apps/web/lib/__tests__/pwa-extension-assets.test.ts apps/web/lib/__tests__/pwa-manifest.test.ts` | 3 files, 8 tests passed                                                     | 2026-11-18 |
| Browser dependency graph             | Browser entry points cannot reach Node-only storage  | `npm run check:browser-graph`                                                                                                                                        | Clean; 111 files reachable                                                  | 2026-11-18 |
| SQLite startup recovery              | Orphan blobs, stale temp files, failed-open retry    | `node scripts/vitest.mjs run packages/storage-sqlite`                                                                                                                | 8 files, 222 tests passed                                                   | 2026-11-18 |
| Domain review: extensions            | Review gate and checklist                            | [extension-security-review.md](./extension-security-review.md)                                                                                                       | Implementation complete; independent review not started                     | 2026-11-18 |
| Domain review: AI and vault          | Review gate and checklist                            | [ai-security-review.md](./ai-security-review.md)                                                                                                                     | Implementation complete; independent review not started                     | 2026-11-18 |
| Domain review: E2EE                  | Review gate and checklist                            | [e2ee-security-review.md](./e2ee-security-review.md)                                                                                                                 | Implementation and internal follow-up complete; external review not started | 2026-11-18 |
| Full non-E2E gates                   | Final repository gates                               | `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`                                                                             | Passed: 142 files, 1,375 tests; production build and PWA generated          | 2026-11-18 |

Browser E2E was not rerun in this closeout because no UI or browser security flow
changed. The previously recorded five-journey suite remains the last browser
evidence and is listed in `docs/development.md`.

The unsafe-sink hit is `apps/web/app/layout.tsx:38`, which injects the static
`themeScript` from `apps/web/lib/theme.ts` to set the initial theme before
hydration. The script is a repository constant assembled with `JSON.stringify`
over fixed storage key and color values. It contains no user, note, file, or
provider data and does not render Markdown or extension output. It is required to
avoid a theme flash and is classified as safe by construction.

## Stage E internal implementation addendum

Date: 2026-11-19

The Stage E implementation adds a single-user server, sync authority, file
versions, real-time collaboration, document Q&A, extension AI capability, and a
read-only MCP server. This addendum records internal automated evidence only. It
is not a security review and it closes no gate.

| Area                       | Evidence                                                                                 | Result                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Full non-browser gates     | `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build` | Passed: 185 test files, 1666 tests; 16 routes (14 static pages); service worker with 60 precached paths                       |
| Sync protocol E2E          | `node scripts/e2e-sync.mjs`                                                              | Passed: viewer denial, sync conflict, file conflict copy                                                                      |
| Collaboration protocol E2E | `node scripts/e2e-collaboration.mjs`                                                     | Passed: presence, reconnect, offline update, viewer denial                                                                    |
| AI Q&A E2E                 | `node scripts/e2e-ai-qa.mjs`                                                             | Passed: consent before send, valid citation, unsupported citation                                                             |
| MCP E2E                    | `node scripts/e2e-mcp.mjs`                                                               | Passed: token creation, read-only tools, cross-workspace denial                                                               |
| Self-hosting operations    | `docs/self-hosting.md`                                                                   | Runbook documented; TLS, backup, restore, migration, rollback, delete-all, and single-writer not executed in this environment |
| Browser E2E                | Not run                                                                                  | Blocked by missing login, shared-workspace binding, Q&A source picker, and MCP token management surfaces                      |

The test run prints a Vite `configLoader` warning about ESM syntax in
`vitest.config.ts`, a mixed esbuild/oxc options warning, and a happy-dom
environment-creation notice. None is a failure.

External gates remain open. Shared workspace content is visible to the server
operator, AI Q&A is provider egress after consent, MCP is read-only and disabled
by default, and no E2EE or MCP isolation claim is made. See
`docs/stage-e-gate-register.md` and `docs/stage-e-release-checklist.md`.

## Findings

| ID    | Severity | Area       | Summary                                                                                                           | Owner      | Status   | Test or commit                                                                                                        |
| ----- | -------- | ---------- | ----------------------------------------------------------------------------------------------------------------- | ---------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| D6-01 | Critical | Dependency | Vitest 3.2.7 pulled `tinypool` advisories GHSA-5gmw-xhrv-c9v3 and GHSA-85c8-ppgw-ccpr.                            | Maintainer | Closed   | Upgraded root and conformance peer to Vitest 5.1.1; updated `scripts/vitest.mjs`; 338 targeted tests passed.          |
| D6-02 | Moderate | Dependency | Eleven moderate dev-only advisories remain in `drizzle-kit`, `esbuild`, `minimatch`, and their transitive chains. | Maintainer | Accepted | Dev-only; no high or critical advisory. Fixes are breaking major upgrades; tracked for a separate maintenance change. |
| D6-03 | Low      | Rendering  | `dangerouslySetInnerHTML` is used once in the root layout for the initial theme script.                           | Maintainer | Closed   | Classified safe: static constant, no user input. See evidence note above.                                             |

No open critical or high finding remains in this internal audit. The accepted
moderate advisories are not shipped application dependencies, but they still
require a maintenance decision before a public release.

## Domain review links

- [Extension security review](./extension-security-review.md)
- [AI security review](./ai-security-review.md)
- [E2EE security review](./e2ee-security-review.md)

Each domain review keeps its own scope, threat model, checklist, residual risks,
and review record. This dossier does not replace them.

## Reviewer handoff

The starting packet for an independent reviewer is
[security-review-handoff.md](./security-review-handoff.md). It lists the review
streams, artifacts, commands, exclusions, logistics, and sign-off table. The
packet is prepared; no reviewer is assigned.

## External sign-off

| Review                  | Reviewer     | Date        | Commit      | Result      |
| ----------------------- | ------------ | ----------- | ----------- | ----------- |
| Extension sandbox       | Not assigned | Not started | Not started | Not started |
| AI and credential vault | Not assigned | Not started | Not started | Not started |
| E2EE and cryptography   | Not assigned | Not started | Not started | Not started |
| Stage D overall         | Not assigned | Not started | Not started | Not started |

## Claim status

OpenNest makes no E2EE claim, no AI confidentiality claim, and no extension
sandbox security claim.

The correct product language remains:

- Optional content encryption is implemented and has not been independently
  reviewed. Metadata remains plaintext.
- Optional AI providers are implemented with off-by-default consent and
  session-only or encrypted credentials. The AI and credential-vault review is
  not complete.
- Local sideload extensions are implemented with an opaque-origin sandbox and a
  read-only host API. The extension security review is not complete.

The dependency audit result does not authorize any of those claims.

## Gate conditions

The Stage D security gate closes only when:

1. The external reviewers sign the extension, AI, E2EE, and overall records.
2. Critical and high findings are fixed and covered by regression tests.
3. Any accepted risk has an owner, a reason, and a release decision.
4. Documentation, UI copy, and product claims match the implementation.
5. The E2EE claim gate includes R-13-7 or explicitly excludes sync everywhere.
6. The full build, test, lint, format, typecheck, and browser E2E gates pass.

Until then, Stage D remains in progress.
