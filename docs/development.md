# OpenNest development

Stage names follow `ROADMAP.md`. Dated specs, plans, and ADRs may use historical
labels; see the Stage Naming History section in `ROADMAP.md`.

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

| Command                       | What it does                                           |
| ----------------------------- | ------------------------------------------------------ |
| `npm run dev`                 | Next.js dev server with Webpack                        |
| `npm run build`               | Production build with Webpack, then the service worker |
| `npm run build:pwa`           | Regenerate `public/sw.js` after an existing build      |
| `npm run start`               | Serve the production build                             |
| `npm run lint`                | ESLint with the Next.js rules                          |
| `npm run typecheck`           | Generate Next route types, then `tsc --noEmit`         |
| `npm test`                    | Browser-graph check, then Vitest single run            |
| `npm run test:watch`          | Vitest, watch mode                                     |
| `npm run test:e2e`            | All browser E2E journeys against the current build     |
| `npm run test:e2e:ai`         | AI consent, credentials, vault, and transport E2E      |
| `npm run test:e2e:encryption` | Encryption setup, backup, restore, and unlock E2E      |
| `npm run test:e2e:extensions` | Extension install, sandbox, storage, and privacy E2E   |
| `npm run test:e2e:pwa`        | PWA install, offline, and update browser E2E           |
| `npm run benchmark:library`   | Storage benchmark with 2,000 files and 2,000 notes     |
| `npm run check:browser-graph` | Verify nothing Node-only reaches the browser adapter   |
| `npm run format`              | Prettier write                                         |
| `npm run format:check`        | Prettier check                                         |

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

### Browser E2E

`npm run test:e2e` runs five scripts against a production build:

- `scripts/e2e-stage-c.mjs`: dashboard, notes, search, folders, file upload,
  backup, privacy delete-all, desktop layout, and console errors.
- `scripts/e2e-pwa.mjs`: manifest, service worker, offline reload, navigation,
  fallback, and user-confirmed updates.
- `scripts/e2e-encryption.mjs`: encryption setup, recovery, locked reload,
  encrypted backup and restore, and mobile overflow.
- `scripts/e2e-ai.mjs`: off-by-default AI, consent, session and vault
  credentials, HTML-as-text rendering, and delete-all.
- `scripts/e2e-extensions.mjs`: extension install, update consent, sandbox
  probes, read-only host API, worker storage, stop/reload, disable, safe mode,
  uninstall, reinstall, and privacy audit and inventory.

Each script starts the built server on a free local port and opens Chromium at a
412x915 viewport. Build first, because the scripts serve `.next`:

```bash
npm run build
npm run test:e2e
```

It uses the system Playwright module by default. Override the module directory
with `PLAYWRIGHT_MODULE_PATH` and the browser launcher with `CHROMIUM_PATH`. Set
`BASE_URL` to reuse a running server instead of starting one.

### Large-library benchmark

`npm run benchmark:library` runs `benchmarks/library.bench.ts` through a separate
Vitest config. It seeds 2,000 files and 2,000 notes into the Dexie adapter using
`fake-indexeddb`, then measures list, folder list, and search latency. It prints
the timings and fails if any single operation takes longer than 10 seconds.

Reference result on the Android/Termux device (2026-11-13):

| Operation                   | Time   |
| --------------------------- | ------ |
| First 50 files, all folders | 94 ms  |
| First 50 files in a folder  | 69 ms  |
| First 50 notes              | 79 ms  |
| All 21 folders              | 2 ms   |
| Search over 4,000 items     | 135 ms |

The Dexie list implementation reads the workspace rows and then filters and
paginates in memory. That is fine at this size, but it is the first place to
revisit when libraries reach tens of thousands of items. The UI caps file pages
at 500 rows and note and search results at 100, so the browser never renders the
whole library at once.

## Accessibility checks

`npm test` covers navigation landmarks, current-page state, the skip link target,
and focusability. `npm run test:e2e` adds a live audit of every page it visits:
exactly one `h1`, a `main#main-content` landmark, unique ids, image alt
attributes, accessible names on links and buttons, no horizontal overflow at
412px, dialog focus, Escape to close, and arrow-key tab switching in the note
editor.

## Repository layout

```
apps/web             Next.js application
  app/               App Router: dashboard, library, files, notes, search, extensions, privacy, offline
  components/        screens, dialogs, editor, shell, theme, locale, extension UI, PWA controls
  lib/data/          browser storage singleton, services, provider, async hook
  lib/extensions/    extension runtime, frame transport, session, host API, Dexie store
  lib/               formatting, file, folder, note, error, token, PWA helpers
  public/            icons, extension sandbox shell, and generated service worker
packages/ui          React primitives: Button, Card, Input, cn
packages/localization  en/id catalogs, provider, Intl formatting
packages/extensions  manifest, package, registry, store, protocol, UI, host API DTOs
scripts/pwa/         service worker template, generator, generator tests
scripts/             Node-based command resolvers and browser E2E
docs/                Development notes, extension spec, and ADRs
```

Stage B adds, with real consumers and tests (see ADR 0003):

```
packages/core                 entities, ids, ports, rules, services, errors, fixtures
packages/validation           Zod schemas for external input
packages/storage-dexie        IndexedDB adapter (browser)
packages/storage-sqlite       SQLite adapter, Drizzle schema, migrations, blob store
packages/storage-conformance  the shared suite both adapters run
```

## Stage C application runtime

The browser app composes the domain services once and shares them through
`AppDataProvider` (see ADR 0004):

- `apps/web/lib/data/browser-storage.ts` opens Dexie once.
- `apps/web/lib/data/services.ts` builds the domain services over the ports.
- `apps/web/lib/data/app-data-provider.tsx` ensures the workspace and exposes
  `{ storage, services, workspace }`, plus `invalidate()` and
  `refreshWorkspace()`.
- `apps/web/lib/data/hooks.ts` provides `useAsyncData`.
- `apps/web/lib/data/revision.ts` tracks invalidation revisions.

Mutations call `invalidate()` so every open screen reloads. Do not open a second
storage connection and do not import Dexie or repositories directly in a
component. Browser storage is the source of truth, so screens are client
components; there is no server API in Stage C.

Routes: `/`, `/library`, `/library/[folderId]`, `/files/[fileId]`, `/notes`,
`/notes/[noteId]`, `/search`, `/extensions`, `/extensions/[extensionId]`,
`/privacy`, `/settings`, and `/offline`. Search state lives in URL parameters.
File previews use local blob URLs and revoke them on unmount. Markdown preview
uses `react-markdown` with GFM, skips raw HTML, and blocks remote images.

Note autosave lives in `apps/web/lib/autosave`. It saves after a 500 ms idle
delay, on blur, and through lifecycle flushes on unmount, `pagehide`, hidden
visibility, and reconnection. Saves are serialized so the newest text wins. A
versioned localStorage draft (`opennest:draft:note:<workspaceId>:<noteId>`) is
written shortly after typing, restored on mount when it is newer than the stored
note, and cleared after a successful save, delete, or restore. Transient save
failures retry twice (1 s and 2 s); deterministic failures do not. A draft write
failure shows a localized warning without stopping the real save. ADR 0007
records the durability decision and its limits.

`useAsyncData` is key-aware: changing the key hides the previous record's data
and error and shows the loading state. Reloading the same key keeps the current
data visible until the replacement arrives.

### Extension runtime

D4A extensions are local sideload packages. The complete package, host API, and
limits specification lives in `docs/extensions.md`.

- `packages/extensions` owns manifest validation, canonical package integrity,
  the registry, extension and storage ports, protocol types, and safe UI nodes.
- `apps/web/lib/extensions` owns the registry-backed runtime, session lifecycle,
  frame transport, host API, request protocol, and Dexie store.
- `apps/web/public/extension-sandbox.js` is the trusted shell. It listens for
  `shell:ready`, receives a `MessageChannel`, starts the extension code in a blob
  worker inside the opaque-origin iframe, enforces message size, and forwards
  host responses to the worker.
- `apps/web/app/extensions` and the components in
  `apps/web/components/extension-*.tsx` implement install, update consent,
  enable, disable, uninstall, safe mode, and the runner.
- `AppDataProvider` exposes the runtime as `extensions` alongside storage,
  services, AI, and privacy.

The iframe uses `sandbox="allow-scripts"` and a restrictive `srcdoc` CSP.
`/extension-sandbox.js` overrides the global `Cross-Origin-Resource-Policy`
with `cross-origin` because the sandboxed iframe has an opaque origin; every
other response keeps `same-origin`. Do not add `allow-same-origin`, remote
scripts, direct network access, or a same-origin worker.

Extension sessions are single-active. Install, update, uninstall, safe mode,
session start and end, and integrity failures write privacy audit events.
Extension storage is isolated per extension and removed on uninstall. Extension
records and storage are excluded from backup v1 and backup v2.

### Backup format and restore

`apps/web/lib/data/backup.ts` builds and validates the local backup envelope; the
schema lives in `packages/validation/src/backup.ts`. A backup is one JSON file
with `format: "opennest-backup"`, `formatVersion: 1`, and a `BackupSnapshot`
whose blob bytes are base64. Export paginates every repository, rebuilds tag and
note links through the public `tags()`/`links()` methods, and fails rather than
produce a backup with a missing blob.

Import parses JSON, rejects unknown formats and versions, validates the snapshot
schema and its references, decodes base64, and verifies every file blob and
SHA-256 checksum before calling `storage.restore()`. Restore is transactional, so
a failure leaves active data unchanged. The UI asks for explicit confirmation,
then calls `refreshWorkspace()` so the provider points at the restored workspace.
The format and restore decision is recorded in ADR 0005.

### PWA, offline shell, and updates

`apps/web/app/manifest.ts` describes the installable app and points at the PNG
icons in `apps/web/public/icons`. The root layout links the manifest, declares
the Apple web app metadata, and keeps the existing theme-color sync.

`npm run build` also runs `scripts/pwa/build.mjs`, which renders
`scripts/pwa/service-worker.js` into `apps/web/public/sw.js`. The generated file
is gitignored: it is a build artifact, so deploy the output of `npm run build`,
not a stale checked-in worker. The generator versions the cache from the Next
build ID, the worker template, and the actual precache list, which includes the
seven shell routes (`/`, `/library`, `/notes`, `/search`, `/settings`,
`/extensions`, `/offline`), the manifest and icons, every file under
`.next/static`, and the public assets including `/extension-sandbox.js`.

Cache policy (ADR 0006):

- Install precaches the shell with `cache: "reload"` and fails the install if any
  required path is unavailable.
- Full navigations are network-first with a four-second timeout, then a cached
  response for the same path, then `/offline`.
- Immutable `/_next/static` assets, icons, and the favicon are cache-first.
  Next RSC requests are network-first so client navigation can use a cached
  response when offline.
- Non-GET, cross-origin, range, authorized, `/api/`, `/_next/image`, `sw.js`, and
  manifest requests are never cached. Responses marked `no-store` or `private`
  are not stored.
- Activate deletes only caches with the `opennest-` prefix. Browser data and
  IndexedDB are never cleared.

Update policy: a new worker installs but does not call `skipWaiting` on its own.
The app shows a localized prompt only when a waiting worker exists and an
existing page is controlled. `Refresh` first calls the shared save coordinator's
`flushAll()`, then reads and validates the draft journal. If a save rejects,
times out, leaves work dirty, a valid draft remains, or the journal cannot be
read, the prompt stays and reports the specific failure without reloading. On
success it posts `SKIP_WAITING`, and the page reloads only after
`controllerchange`. A first
install claims the page without a prompt, so opening the app offline later does
not loop or interrupt autosave.

`next.config.ts` serves `/sw.js` with `Cache-Control: no-cache, no-store,
must-revalidate` and `Service-Worker-Allowed: /`.

Limitations:

- A first visit cannot work offline: there is no worker or cache yet. The
  worker also requires HTTPS (or localhost), so a plain-HTTP LAN deployment
  cannot install it.
- Static shell routes and previously visited data work offline. A dynamic
  route such as `/files/[fileId]` is only available if it was visited or its
  HTML was cached while online. The IndexedDB content itself stays local.
- Offline prefetch requests may log expected `net::ERR_FAILED` console entries.
  The PWA E2E filters those and still fails on application errors.
- Browser storage remains evictable. The PWA does not make IndexedDB permanent;
  users still need backups.

## Package boundaries

- `apps/web` may import `@opennest/ui`, `@opennest/localization`, `core` types,
  and the browser storage adapter through the app data layer.
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
