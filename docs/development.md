# OpenNest development

## Requirements

- Node.js >= 24.0.0 (`.nvmrc` pins 24), because the SQLite adapter uses the
  built-in `node:sqlite` and refuses a native addon on this platform.
- npm >= 10

No global CLI tools are required. Everything runs through the repository's own
scripts.

## Install

```bash
npm install
```

On a regular Linux/macOS checkout this takes well under a minute. On the
reference Android device (Termux, f2fs under `/data`) it takes about one minute
for 410 packages; the npm cache makes later installs faster.

## Where the checkout must live (Android)

Do **not** develop this project from Android shared storage
(`/storage/emulated/0`, typically shown to apps as `~/storage/shared`). That
mount is `noexec`, refuses symlinks and hardlinks (`EACCES`), and blocks
`dlopen` of native modules such as `lightningcss`. Symptoms are
`npm install` failing on `node_modules/@opennest/*` and Tailwind builds dying
with `ERR_DLOPEN_FAILED`.

Keep the working tree on `/data` instead, for example
`/data/data/com.termux/files/home/opennest`. This is a filesystem limitation,
not something a flag or configuration can work around.

## Commands

| Command                       | What it does                                         |
| ----------------------------- | ---------------------------------------------------- |
| `npm run dev`                 | Next.js dev server with Webpack                      |
| `npm run build`               | Production build with Webpack                        |
| `npm run start`               | Serve the production build                           |
| `npm run lint`                | ESLint with the Next.js rules                        |
| `npm run typecheck`           | Generate Next route types, then `tsc --noEmit`       |
| `npm test`                    | Browser-graph check, then Vitest single run          |
| `npm run test:watch`          | Vitest, watch mode                                   |
| `npm run check:browser-graph` | Verify nothing Node-only reaches the browser adapter |
| `npm run format`              | Prettier write                                       |
| `npm run format:check`        | Prettier check                                       |

## Android/Termux notes

These are verified constraints, not guesses.

### No shebangs

`node_modules/.bin/*` files start with `#!/usr/bin/env node`. On some Termux
installs `/usr/bin` does not exist, and `termux-exec` preloading does not make
that shebang resolve. Running `npm run build` then fails with:

```
sh: 1: next: not found
```

or

```
/usr/bin/env: No such file or directory
```

For this reason every npm script invokes Node directly through a small resolver
in `scripts/` (`next.mjs`, `tsc.mjs`, `vitest.mjs`, `eslint.mjs`,
`prettier.mjs`). Each resolver uses `require.resolve` to locate the real entry
point, so it also survives npm workspace hoisting.

If you add a new tool, follow the same pattern. Do not rely on an executable
being on `PATH`.

### Webpack only

Turbopack requires native SWC bindings and there is no Android build of them.
Next.js falls back to WebAssembly SWC, which cannot run Turbopack. The scripts
pass `--webpack` explicitly so a future Next.js default cannot silently break
this platform. This is recorded in `docs/adr/0001-webpack-on-android.md`.

The Wasm SWC package is downloaded on first use into `~/.cache/next-swc`. A
clean device therefore needs network access for the first build. If the download
fails, install it manually:

```bash
npm install --no-save @next/swc-wasm-nodejs@16.4.6
```

### Disk and build time

A production build takes roughly 1m45 on the reference device, so run quality
gates deliberately rather than in a tight loop. `node_modules` is about 300 MB
and `.next` about 100 MB; both are gitignored.

## Not available here

- Turbopack.
- `next/font/google`. Fonts are not downloaded at build time; the UI uses a
  system font stack that prefers Inter when installed.

Browser automation **is** available: Playwright 1.65 is installed system-wide and
drives the system Chromium 156 in headless mode. It is not a project dependency
in Stage A. To use it without adding a dependency:

```js
import { createRequire } from "node:module";

const require = createRequire("/data/data/com.termux/files/usr/lib/node_modules/");
const { chromium } = require("playwright");

const browser = await chromium.launch({
  executablePath: "/data/data/com.termux/files/usr/lib/chromium/chromium-launcher.sh",
  args: ["--no-sandbox", "--disable-gpu"],
});
```

This is how the A2 screenshot check (mobile and desktop, dark mode, Indonesian
locale, console errors) was done.

## Repository layout

```
apps/web             Next.js application
  app/               App Router: layout, page, tokens, icon
  components/        app shell, language switcher, theme toggle
  lib/               design token values and contrast helpers
packages/ui          React primitives: Button, Card, Input, cn
packages/localization  en/id catalogs, provider, Intl formatting
scripts/             Node-based command resolvers
docs/                Development notes and ADRs
```

Stage B adds, with real consumers and tests (see ADR 0003):

```
packages/core                 entities, ids, ports, rules, services, errors, fixtures
packages/validation           Zod schemas for external input
packages/storage-dexie        IndexedDB adapter (browser)
packages/storage-sqlite       SQLite adapter, Drizzle schema, migrations, blob store
packages/storage-conformance  the shared suite both adapters run
```

## Package boundaries

- `apps/web` may import `@opennest/ui` and `@opennest/localization`. It imports
  the storage packages only in Stage C, when it needs data.
- Packages must not import Next.js or app code.
- Import through the barrel, never a deep path. ESLint enforces this with
  `no-restricted-imports`.
- `validation` may import core types, `limits`, and pure `rules`/`checks`, so a
  limit is never spelled twice. It never imports a port or an adapter.
- `core` names no adapter. Domain logic talks to the ports, so swapping IndexedDB
  for SQLite is a change at the composition root, not inside the domain.
- The browser graph stays clean: nothing reachable from `storage-dexie` may
  import `storage-sqlite`, `node:sqlite`, `node:fs`, or `node:crypto`.
  `npm run check:browser-graph` walks the real import graph from
  `packages/storage-dexie/src/index.ts` and runs first in `npm test`.

## Storage adapters

Both adapters implement the ports in `packages/core` and pass the same suite in
`packages/storage-conformance`.

- **Dexie (browser).** `packages/storage-dexie`. Schema v1 had only primary keys;
  v2 adds the sort indexes. A v1 database is upgraded in place on first open, so
  never add an index to an existing version: bump the version and add an upgrade
  test.
- **SQLite (local).** `packages/storage-sqlite`. `node:sqlite` behind
  `drizzle-orm/sqlite-proxy`; migrations are generated by `drizzle-kit` and
  applied by `drizzle-orm/sqlite-proxy/migrator`. `PRAGMA user_version` mirrors
  the applied migration count. Search uses FTS5 and re-checks candidates with the
  core token rules. Blobs are files with a MIME sidecar. The adapter is
  server-only: `node:sqlite` never enters the browser graph.

Search parity is tested across adapters: the shared `searchCorpusSnapshot()` is
restored into Dexie and SQLite and the ordered `{kind, id}` lists must match.
`score` is excluded. SQLite's `reindexAll(workspaceId)` rebuilds the whole FTS
index because FTS5 has no per-workspace rebuild, so its cost is database-wide;
Dexie's `reindexAll` is a no-op.

Search is token-prefix only, never substring. Both adapters rank in four tiers,
break ties on `(foldedTitle, id)`, and may return different `score`; `score` is
not part of the contract. Dexie scans the workspace candidates but never asks for
more than the query `limit` permits; SQLite uses FTS5 candidates and re-checks
them with the core token rules.

### Adding a SQLite migration

Change `packages/storage-sqlite/src/schema.ts`, then generate from that package:

```bash
cd packages/storage-sqlite
node ../../node_modules/drizzle-kit/bin.cjs generate
```

For SQL that Drizzle cannot model, create an empty custom migration and fill it
in:

```bash
node ../../node_modules/drizzle-kit/bin.cjs generate --custom --name=fts5
```

Commit the SQL file and `migrations/meta/`. Never edit an applied migration or
the journal. The runtime applies the ledger with
`drizzle-orm/sqlite-proxy/migrator`; `drizzle-kit push` is not used. A fresh
database ends at `PRAGMA user_version = 2` today.

### Conformance suite

```bash
node scripts/vitest.mjs run packages/storage-dexie
node scripts/vitest.mjs run packages/storage-sqlite
```

The Dexie suite imports `fake-indexeddb/auto` and runs in the default `happy-dom`
environment. SQLite test files start with `// @vitest-environment node`; most use
`:memory:`, and the shared-database case uses a temporary file. A storage
behaviour belongs in the conformance suite first; an adapter test is only for
what the port cannot express (schema upgrade, `PRAGMA`, file corruption).

### Dexie transactions are a zone

`storage.transaction(work)` opens all tables and passes a repository bundle.
Anything inside `work` must be awaited inside the zone. Do not await `fetch`,
`setTimeout`, or a promise from another Dexie instance inside it: the transaction
commits early and later writes escape it, silently breaking atomicity. Nested
transactions throw `nested_transaction`. The adapter README has the details.

## Design tokens

Tokens live in two places that must agree:

- `apps/web/app/globals.css` holds the CSS custom properties for light and dark.
- `apps/web/lib/tokens.ts` holds the same values for tests.

A unit test fails if they drift. A second test computes WCAG contrast for every
foreground/background pair and fails below AA.

When adding a token: add the CSS variable, add the value to `tokens.ts`, and add
the pair to `contrastPairs` if it is used for text.
