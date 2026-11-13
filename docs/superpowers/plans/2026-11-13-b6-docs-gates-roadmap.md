# B6 Docs, Gates, and Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close Stage B by finalizing documentation and ADRs, raising the Node floor, correcting drifted prose, auditing dependencies and boundaries, and running every quality gate plus a browser smoke test.

**Architecture:** No production code or approved contract changes. B6 edits configuration, documentation, and the roadmap only. The one runtime-visible change is the root `engines.node` floor, already required by approved decision 1.

**Tech Stack:** npm workspaces, Node 24, TypeScript, Next.js, Vitest, Drizzle, SQLite FTS5.

**Spec:** `docs/superpowers/specs/2026-11-12-stage-b-core-architecture-design.md` sections 15 B6, 17, and 18.

## Global Constraints

- Do not change the search contract, storage ports, adapter architecture, or schema.
- Do not touch `apps/web` for feature implementation. A browser smoke run is allowed.
- Do not commit.
- Do not start Stage C or any UI work.
- If a finding needs an architectural decision, stop and report instead of changing it.
- Use `node scripts/*.mjs`, never `npx`.

## Review Focus

1. `engines.node` must be `>=24.0.0` in the root manifest and lockfile, and no doc may still instruct `>=20.9`.
2. Section 15 must stop claiming a single validation bridge module and stop placing Zod in the root manifest.
3. SQLite migration prose must distinguish the generated schema migration from the custom FTS5 migration created by `drizzle-kit generate --custom`.
4. The browser graph must remain clean after any manifest edit.
5. The working tree must contain no database, blob, secret, or stray build output beyond gitignored caches.

---

### Task 1: Node floor and stale references

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `docs/development.md`
- Modify: `packages/storage-sqlite/README.md`
- Modify: `docs/superpowers/plans/2026-11-13-b5-search-parity.md`

- [x] Set root `engines.node` to `>=24.0.0`.
- [x] Refresh the lockfile with `npm install --package-lock-only --ignore-scripts`.
- [x] Update README, development requirements, and the SQLite README to say `>=24.0.0`.
- [x] Change the completed B5 plan line to historical wording.

### Task 2: Correct spec section 15

**Files:**

- Modify: `docs/superpowers/specs/2026-11-12-stage-b-core-architecture-design.md`

- [x] Replace the "one bridge module" claim: `common.ts` is the only module importing `limits` and pure rules; per-entity modules import from `common.ts`, and snapshot uses `checks.ts`.
- [x] State that `zod@4.6.7` and `@opennest/core` are declared in `packages/validation/package.json`, not the root.
- [x] Remove the B6 doc-fix blockquote.

### Task 3: Migration and development documentation

**Files:**

- Modify: `packages/storage-sqlite/README.md`
- Modify: `docs/development.md`

- [x] Distinguish `drizzle-kit generate` from `drizzle-kit generate --custom --name=fts5`.
- [x] Document adding a migration, the runtime migrator, and `PRAGMA user_version`.
- [x] Document per-file Vitest environments and both conformance commands.
- [x] Add search limits: token-prefix only, score excluded, Dexie bounded by `limit`.

### Task 4: ADR and roadmap finalization

**Files:**

- Modify: `docs/adr/0003-storage-ports-and-adapters.md`
- Modify: `ROADMAP.md`
- Modify: `README.md`

- [x] Correct the ADR validation row to allow core types, limits, and pure rules/checks.
- [x] Add the Stage B implementation outcome, including the B4 migrator gate and Node floor.
- [x] Confirm ADR 0002 carries its "Superseded in part" note.
- [x] Tick ROADMAP "Define storage interfaces" and update the Phase 0 status paragraph.
- [x] Tick the README "Foundation and project architecture" roadmap item.

### Task 5: Dependency, boundary, and ignore audit

**Files:**

- Modify: `.gitignore`

- [x] Add the `data/` runtime directory.
- [x] Audit manifests, pinned versions, workspace imports, and browser-only dependencies.
- [x] Run the browser graph check.
- [x] Confirm no database, blob, or secret file is present.

### Task 6: Gates, smoke run, and tree audit

- [x] `node scripts/prettier.mjs --check .`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm test`
- [x] `npm run build`
- [x] Start the production build and run a headless browser smoke check.
- [x] Remove generated build caches and audit `git status --ignored`.
- [x] Report diff, audit, gates, and tree. No commit.

## Acceptance

- Node floor is 24 in manifest and lockfile, and no active doc says 20.9.
- Section 15 matches shipped validation and dependency placement.
- Migration wording distinguishes generated and custom FTS5 migrations.
- ADR 0003 is final, ADR 0002 is cross-referenced, and ROADMAP reflects Stage B completion.
- Dependency and browser-graph audits are clean.
- All gates and the browser smoke run pass.
- The working tree has no database, blob, secret, or stray build output.
