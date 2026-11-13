# ADR 0003: Storage ports in core, adapters as separate packages

- Status: Accepted
- Date: 2026-11-12
- Context: Core Architecture Stage B (see
  `docs/superpowers/specs/2026-11-12-stage-b-core-architecture-design.md`)
- Supersedes: the forward-looking package list in ADR 0002. Everything else in
  ADR 0002 still stands.

## Context

ADR 0002 predicted `core`, `database`, `storage`, `search`, `validation`, and
`shared` as future packages. Design work for Stage B showed two problems with
that list:

1. `database`, `storage`, and `search` would each hold a single implementation at
   first. They were placeholders, not boundaries, and a package without a real
   second consumer is an empty abstraction.
2. PRD sections 8 and 9 require both a browser adapter (IndexedDB) and a
   self-hosted adapter (SQLite) with equivalent behaviour. If both live in one
   package, its manifest cannot express that the SQLite half is server-only, and
   one careless import pulls `node:sqlite` into the browser bundle.

## Decision

Five packages:

| Package                         | Responsibility                                                          | May import                            |
| ------------------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| `@opennest/core`                | entities, ids, ports, rules, checks, services, errors, limits, fixtures | nothing in the workspace              |
| `@opennest/validation`          | Zod schemas for external input                                          | `core` (types, limits, rules, checks) |
| `@opennest/storage-dexie`       | IndexedDB adapter                                                       | `core`, `validation`                  |
| `@opennest/storage-sqlite`      | SQLite adapter, Drizzle schema, migrations, blob store                  | `core`, `validation`, `node:*`        |
| `@opennest/storage-conformance` | the shared suite both adapters run                                      | `core`, `vitest` (test-only)          |

`packages/{database,storage,search,shared}` are not created. `core` exposes the
search port and each adapter implements it; a dedicated search package can appear
later if a second consumer justifies one.

Three rules carry the decision:

1. **Ports live in `core`.** `core` names no adapter, no Dexie, no SQLite, and no
   Drizzle. Domain logic depends on interfaces, so replacing a backend is a change
   at the composition root rather than a rewrite.
2. **Factories live in the adapters.** `createDexieStorage(config)` and
   `createSqliteStorage(config)` are exported by their own packages. There is no
   factory in `core`, because that would make `core` import both adapters.
3. **The browser graph stays clean.** Nothing reachable from `storage-dexie` may
   import `storage-sqlite`, `node:sqlite`, `node:fs`, or `node:crypto`.
   `scripts/check-browser-graph.mjs` fails the B3 and B6 gates if it does.

## Alternatives rejected

- **One `@opennest/storage` package with subpath exports.** Compact and closest to
  the PRD directory list, but the Stage A `no-restricted-imports` rule blocks
  `@opennest/*/*` deep imports, and one manifest cannot mark the SQLite half as
  server-only.
- **Adapters as folders inside `core`.** Simplest layout, but it puts Dexie and
  `node:sqlite` in one dependency graph, which is exactly the coupling this
  decision exists to prevent.
- **Wait for a second consumer before splitting.** That would mean shipping the
  search port with no implementation, which is an empty abstraction.

## Consequences

- `AGENTS.md` gains one line: the SQLite adapter is approved for Stage B, because
  PRD sections 8 and 9 require it. The stage list stops contradicting the PRD.
  Approval covers the adapter, not its migrations: B4 must first prove that
  `drizzle-orm/sqlite-proxy/migrator` applies a generated migration through the
  `node:sqlite` bridge. If that gate fails, B4 stops and reports instead of
  substituting a hand-written migration runner.
- The Node floor rises to `>= 24.0.0`, because the SQLite adapter uses the
  built-in `node:sqlite` and refuses a native addon on this platform.
- `apps/web` changes only in Stage C, when it first needs data. Stage B touches no
  file under `apps/web`.
- `transpilePackages` and `@source` in `apps/web` will list the new packages when
  Stage C imports them. Until then, nothing in the app depends on them.
- Adding a backend means adding a package that implements the same ports and runs
  the same conformance suite. It never means editing `core`.

## Implementation outcome

Stage B shipped this decision. `core`, `validation`, `storage-dexie`,
`storage-sqlite`, and `storage-conformance` exist; both adapters pass the same
conformance suite and the B5 search parity suite. The B4 gate passed on Node
24.22.2: `drizzle-orm/sqlite-proxy/migrator` applies the generated schema
migration and the custom FTS5 migration through the `node:sqlite` bridge. The
root `engines.node` floor is `>=24.0.0`, and `npm test` runs the browser-graph
check before Vitest.
