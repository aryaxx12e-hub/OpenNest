# @opennest/storage-sqlite

The local/server storage adapter. `node:sqlite` as the driver, Drizzle ORM over
`drizzle-orm/sqlite-proxy`, and committed migrations. It implements the ports in
`@opennest/core` and passes the shared suite in `@opennest/storage-conformance`.

## Rules

- Schema migrations are generated with `drizzle-kit generate`; the FTS5
  migration was created with `drizzle-kit generate --custom --name=fts5`. Both
  SQL files and `meta/` are committed under `migrations/`. Never edit an applied
  migration or the journal; add a new one. The runtime migrator is
  `drizzle-orm/sqlite-proxy/migrator`, never a hand-written runner.
- `PRAGMA user_version` mirrors the number of applied migrations. A fresh
  database reaches version 2: the generated schema and the custom FTS5 migration.
- The FTS triggers in `migrations/0001_fts5.sql` are part of the schema. Schema
  changes to `files.name` or `notes.title`/`notes.content` must keep them in
  sync; the migration test checks insert, update and delete.
- No clock reads. Callers pass `at`; ids come from `generateId` in core.
- Every raw SQLite error is mapped (`errors.ts`) before it reaches a caller.
- Blob keys are validated against path traversal before any filesystem call.
  Writes go to a temporary file and are renamed into place; the MIME type is a
  sidecar `<key>.meta.json`.
- `node:sqlite` is only reachable from this package, and `npm run
check:browser-graph` proves the Dexie graph does not import it.

## Transactions

`storage.transaction(work)` runs `BEGIN IMMEDIATE`. Nested transactions throw
`UnsupportedError("nested_transaction")`, same as Dexie. `restore()` defers
foreign-key checks inside its transaction so insertion order does not matter.

## Startup cleanup

`init()` removes blobs that no file row references and temporary files older
than 24 hours by default. Pass `staleTempAgeMs` to change the temporary-file
threshold; `reset()` removes every blob and temporary file immediately.

This cleanup assumes one writer process per database and blob root. Multi-process
self-hosting must define its own locking strategy before deployment.

## Search

SQLite has FTS5, so `search()` uses the `files_fts` and `notes_fts` indexes and
`bm25()` for candidate scoring. FTS tokenization is not identical to the core
`searchTokens` rules, so every candidate is re-checked in JavaScript with
`matchesTokens` before ranking. Hits still sort in the four core tiers with the
same `(foldedTitle, id)` tie-break as Dexie.

`reindexAll(workspaceId)` rebuilds both FTS tables in full. FTS5 has no
per-workspace rebuild, so the argument exists for port compatibility but does not
scope the work: cost grows with the whole database, not one workspace. The call
is safe and idempotent. Dexie's `reindexAll` is a no-op because it has no
separate index to rebuild.

`search-parity.test.ts` restores the shared `searchCorpusSnapshot()` into Dexie
and SQLite and compares the ordered `{kind, id}` results, including filters,
pagination, and hostile queries. `score` is intentionally excluded from the
parity contract.

## Testing

```bash
node scripts/vitest.mjs run packages/storage-sqlite
```

The tests use `// @vitest-environment node`: most adapters run on `:memory:`,
the shared-database scenario uses a real temporary file. File and blob roots are
created with `mkdtemp` and removed afterwards. The conformance suite is the
contract; adapter tests cover migrations, FTS sync, blob safety, error mapping,
and Dexie/SQLite search parity.
