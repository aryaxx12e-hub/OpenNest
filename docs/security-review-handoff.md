# Security review handoff

Status: Packet prepared; reviewer not assigned.

This packet is the starting point for an independent reviewer. It is not a
report, does not imply that a review has started, and does not approve any
security claim. The final commit under review must be recorded before sign-off.

## Review streams

| Stream  | Scope                                                                                                        | Primary gate                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| D4A     | Local sideload extension sandbox, manifest, host API, grants, storage, lifecycle, audit, and PWA assets.     | [extension-security-review.md](./extension-security-review.md) |
| D4B     | AI providers, consent, transport, CSP, credential vault, backup exclusion, and delete-all.                   | [ai-security-review.md](./ai-security-review.md)               |
| D3      | Optional workspace encryption, key hierarchy, envelopes, drafts, backup v2, rotation, recovery, and lock.    | [e2ee-security-review.md](./e2ee-security-review.md)           |
| Stage D | Privacy controls, backup and restore, SQLite recovery, PWA, CSP, file serving, supply chain, and boundaries. | [stage-d-security-review.md](./stage-d-security-review.md)     |

A reviewer may take one stream or the unified Stage D review. A unified sign-off
does not replace the stream-specific checklists unless the reviewer states that
all in-scope items were covered.

## Required artifacts

The reviewer must receive:

- ADR 0008, ADR 0009, ADR 0010, ADR 0011, ADR 0012, ADR 0013, ADR 0014, and
  ADR 0015.
- [e2ee-threat-model.md](./e2ee-threat-model.md),
  [ai-provider-architecture.md](./ai-provider-architecture.md),
  [credential-vault.md](./credential-vault.md), and
  [extensions.md](./extensions.md).
- The domain review gates linked above.
- The approved implementation plans and the final changed-file list.
- Test evidence for every checklist item, including negative tests.
- A working production build and E2E instructions.
- Known limitations, accepted risks, and unresolved gates.
- The exact product claim language proposed for release.

The final changed-file list must come from the commit under review, not from this
preparation branch. Include `git diff --stat` and the full diff for that commit.

## Commands

Run from the repository root with Node.js 24 or newer:

```bash
npm ci
npm run build
npm test
npm run test:e2e:extensions
npm run test:e2e:ai
npm run test:e2e:encryption
```

Useful focused checks:

```bash
npm run lint
npm run format:check
npm run typecheck
npm run check:browser-graph
node scripts/vitest.mjs run apps/web/lib/extensions apps/web/lib/ai apps/web/lib/credentials apps/web/lib/crypto apps/web/lib/privacy packages/storage-sqlite
```

The E2E scripts start the production server and use the local Chromium and
Playwright paths defined in the repository scripts. A reviewer can set
`BASE_URL`, `PLAYWRIGHT_MODULE_PATH`, or `CHROMIUM_PATH` if their environment
differs. Do not run E2E against a deployment that contains real user data.

## Scope exclusions

- Sync and collaboration. R-13-7 remains open for any sync encryption claim.
- MCP execution and tool calling. D4B does not implement either.
- External storage adapters. ADR 0014 defers a third adapter.
- Self-hosted server code. Stage D adds none.
- A compromised device, browser, browser extension, or operating system.
- Metadata confidentiality. Titles, filenames, tags, folder names, sizes,
  timestamps, and sync metadata remain plaintext.
- Reliable JavaScript memory zeroization.
- Provider-side retention and model behavior.

## Logistics

- Use the repository's private vulnerability channel or another private channel
  agreed with the maintainers.
- Use synthetic test data only.
- Do not send real passphrases, recovery keys, credentials, notes, or files.
- Do not publish findings before the maintainers have had time to fix them.
- Report the commit, environment, commands, and observed result for every
  finding.
- If a finding depends on a browser or platform version, state it explicitly.

## Finding handling

- **Critical:** stop the claim, fix, add a regression test, and re-review.
- **High:** fix before release, or record an accepted risk with an owner and a
  release decision.
- **Medium:** fix before release, or record an accepted risk with an owner and a
  reason.
- **Low:** record and schedule.

A documentation change does not close a finding if the implementation still
violates the threat model. A deferred control stays an explicit open gate.

## Claim language

The following claims are not approved before sign-off:

- That workspace content is end-to-end encrypted in all deployments.
- That AI traffic or credentials are confidential against every browser threat.
- That the extension sandbox is secure or escape-proof.
- That metadata is encrypted or hidden from the storage provider.
- That a self-hosted server or sync service exists.

The correct pre-review language is recorded in the domain review documents and
the Stage D dossier. Do not upgrade it without a signed review and matching
implementation evidence.

## Sign-off

| Stream  | Reviewer     | Organization | Date        | Commit      | Result      |
| ------- | ------------ | ------------ | ----------- | ----------- | ----------- |
| D4A     | Not assigned | Not assigned | Not started | Not started | Not started |
| D4B     | Not assigned | Not assigned | Not started | Not started | Not started |
| D3      | Not assigned | Not assigned | Not started | Not started | Not started |
| Stage D | Not assigned | Not assigned | Not started | Not started | Not started |

No row may be pre-filled with a passing result. The reviewer and organization
must be recorded by the maintainers, not invented in this document.
