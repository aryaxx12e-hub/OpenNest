# @opennest/storage-dexie

The browser storage adapter. Dexie 4 on IndexedDB, implementing the ports in
`@opennest/core` and passing the shared suite in `@opennest/storage-conformance`.

## Rules

- The browser graph stays clean. Nothing reachable from `src/index.ts` may import
  `@opennest/storage-sqlite`, `node:sqlite`, `node:fs`, or `node:crypto`.
  `npm run check:browser-graph` walks the real import graph and fails the build.
- No clock reads and no id generation inside the repositories. Callers pass `at`
  and the adapter generates ids with `generateId` from core.
- Every mutation goes through the adapter's error mapping. A raw Dexie error must
  never reach a caller.
- Schema changes bump the Dexie version and add an upgrade test. Adding an index
  to version 1 is not a migration; existing browsers would silently keep the old
  index. Version 2 is the first version with sort indexes; version 1 stays
  primary-key-only forever.
- Blobs are stored as `Uint8Array` plus the MIME type, never as a `Blob`. That
  keeps the row structured-cloneable in every host and avoids `Blob` instances
  that lose their prototype when read back through fake-indexeddb.

## Transactions are a zone

`storage.transaction(work)` opens `db.transaction("rw", [...allTables])`. Every
repository method inside `work` must be awaited _inside_ the zone:

```ts
await storage.transaction(async (repos) => {
  const folder = await repos.folders.create({ ... });
  await repos.notes.create({ folderId: folder.id, ... });
});
```

Nothing inside `work` may await anything outside the zone: `fetch`, `setTimeout`,
or a promise from another Dexie instance. Dexie keeps the transaction alive only
across the promises it tracks; an outside await lets the transaction commit
early and the later writes escape the transaction. This silently breaks
atomicity, so it is also in `docs/development.md`.

Nested transactions throw `UnsupportedError("nested_transaction")`. SQLite has
the same limitation, so the port documents one level.

## Search

IndexedDB has no full-text index. `search()` loads the workspace's candidate
files and notes, normalizes with `normalizeForSearch`, and applies the semantics
fixed in core: every token must be a word prefix, hits rank in four tiers, and
ties break on `(foldedTitle, id)`.

This is bounded by the query `limit`: the adapter never asks for a giant page
first and then trims it. See the adapter test for the hostile-query case.

`reindexAll(workspaceId)` is a no-op. There is no separate index to rebuild, so
the call only exists to satisfy the shared port.

## Testing

```bash
node scripts/vitest.mjs run packages/storage-dexie
```

The suite imports `fake-indexeddb/auto` as the global `indexedDB`, so it runs in
the default `happy-dom` environment without a browser. Each test gets its own
database name. The conformance suite is the contract; a new storage behaviour is
added there first, not in this package.
