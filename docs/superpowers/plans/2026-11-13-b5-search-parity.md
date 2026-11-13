# B5 Search Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Prove Dexie and SQLite return identical search hit ids and ordering for the same fixture, and document the `reindexAll` limitation.

**Architecture:** No search contract or architecture change. Add one shared snapshot fixture in core, one cross-adapter parity test, and search edge cases in the conformance suite. Production adapter code changes only if a parity failure is a clear non-contract bug; any tokenizer, token semantics, or ranking change stops for approval.

**Tech Stack:** TypeScript, Vitest, Dexie with `fake-indexeddb`, `node:sqlite`, Drizzle, FTS5 `unicode61 remove_diacritics 2`.

**Spec:** `docs/superpowers/specs/2026-11-12-stage-b-core-architecture-design.md` sections 8.5, 9.3, 13.3, B5.

## Global Constraints

- Never touch `apps/web`.
- Never commit.
- Do not change the search contract, `SearchQuery`, `SearchHit`, `normalizeForSearch`, `searchTokens`, or `toMatchQuery` without approval.
- `score` is not part of the parity contract; only `{kind, id}` and order.
- Commands run through `node scripts/*.mjs`, never `npx`.
- `engines.node` stayed `>=20.9.0` during B5; B6 raises it to `>=24.0.0`.

## Review Focus

1. Internal punctuation such as `belanja,` and `a"b` can tokenize differently in FTS5.
2. Unicode case folding and diacritics such as `İstanbul`, `straße`, `ﬁle`.
3. FTS5 must not miss a candidate that Dexie's token-prefix matcher accepts.
4. Ties on folded title must break on id, not insertion order.
5. `reindexAll` is global, not workspace scoped.

---

### Task 1: Shared Search Fixture in Core

**Files:**

- Modify: `packages/core/src/testing/fixtures.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Produces: `searchCorpusSnapshot(): BackupSnapshot`
- Produces: `HOSTILE_SEARCH_QUERIES: readonly string[]`

- [x] Add a fresh `BackupSnapshot` factory with fixed UUIDs, 1 workspace, 3 folders, 6 files, 15 notes, 2 tags, tag links, note links, and matching blobs.
- [x] Include case, diacritics, punctuation, apostrophe, hyphen, and body-only matches.
- [x] Add hostile query corpus.
- [x] Export both from the core barrel.
- [x] Verify `npm run typecheck:packages`.

### Task 2: Basic Cross-Adapter Parity Test

**Files:**

- Create: `packages/storage-sqlite/src/__tests__/search-parity.test.ts`
- Modify: `packages/storage-sqlite/package.json`
- Modify: `package-lock.json`

- [x] Add dev dependencies `@opennest/storage-dexie` and `fake-indexeddb`.
- [x] Restore the same snapshot into Dexie and SQLite (`:memory:`, temp blob root).
- [x] Validate the snapshot with `backupSnapshotSchema`.
- [x] Close adapters and remove temp directories in `afterEach`.
- [x] Verify setup passes.

### Task 3: Query Matrix and Ordering

**Files:**

- Modify: `packages/storage-sqlite/src/__tests__/search-parity.test.ts`

- [x] Compare exact `{kind, id}[]` for ASCII, Indonesian, case, diacritics, punctuation, apostrophe, hyphen, body and prefix queries.
- [x] Assert the exact `belanja` order: `belanja` file, three exact folded notes by id, tier 1 titles by folded title, `Catatan belanja`, then body matches.
- [x] Assert the exact `belanja bulanan` order.
- [x] Assert known positives for `cafe`, `istanbul`, `don't`, `foo-bar`.
- [x] Assert `file` and `strasse` return no hits.
- [x] Assert `score` does not influence order.

### Task 4: Filters, Pagination, Hostile Queries

**Files:**

- Modify: `packages/storage-sqlite/src/__tests__/search-parity.test.ts`

- [x] Compare folder root subtree, child, null, single tag, tag AND, kinds, and combined filters.
- [x] Compare `limit`/`offset` against slices of the full ordered result, including offset past the end.
- [x] Run every hostile query; no throw, identical results.
- [x] Assert empty and punctuation-only input returns `[]`.

### Task 5: Conformance Search Edge Cases

**Files:**

- Modify: `packages/storage-conformance/src/scenarios/search.ts`

- [x] Multi-token prefix positive and negative cases.
- [x] Case and diacritic folding.
- [x] Attached punctuation.
- [x] Tie broken by id.
- [x] `reindexAll` leaves another workspace searchable.

### Task 6: Documentation

**Files:**

- Modify: `packages/storage-sqlite/README.md`
- Modify: `packages/storage-dexie/README.md`
- Modify: `docs/development.md`

- [x] Document that SQLite `reindexAll(workspaceId)` rebuilds the whole FTS index because FTS5 has no per-workspace rebuild.
- [x] Document the parity test and that `score` is excluded.
- [x] Note Dexie `reindexAll` is a no-op.

### Task 7: Gates and Report

- [x] `node scripts/prettier.mjs --check .`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm test`
- [x] `npm run build`
- [x] Report results and changed files. No commit.

## Acceptance

- Exact `{kind, id}[]` equality for the shared corpus, including ties and multi-token queries.
- Hostile queries never throw and agree.
- Folder subtree, tag AND, and kind filters agree.
- Pagination equals slices of the full result.
- `score` excluded from the contract.
- `reindexAll` limitation documented.
- All gates pass.
