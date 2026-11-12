# OpenNest development

## Requirements

- Node.js >= 20.9 (`.nvmrc` pins 24)
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

| Command                | What it does                                   |
| ---------------------- | ---------------------------------------------- |
| `npm run dev`          | Next.js dev server with Webpack                |
| `npm run build`        | Production build with Webpack                  |
| `npm run start`        | Serve the production build                     |
| `npm run lint`         | ESLint with the Next.js rules                  |
| `npm run typecheck`    | Generate Next route types, then `tsc --noEmit` |
| `npm test`             | Vitest, single run                             |
| `npm run test:watch`   | Vitest, watch mode                             |
| `npm run format`       | Prettier write                                 |
| `npm run format:check` | Prettier check                                 |

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

## Package boundaries

- `apps/web` may import `@opennest/ui` and `@opennest/localization`.
- Packages must not import Next.js or app code.
- Import through the barrel, never a deep path. ESLint enforces this with
  `no-restricted-imports`.

## Design tokens

Tokens live in two places that must agree:

- `apps/web/app/globals.css` holds the CSS custom properties for light and dark.
- `apps/web/lib/tokens.ts` holds the same values for tests.

A unit test fails if they drift. A second test computes WCAG contrast for every
foreground/background pair and fails below AA.

When adding a token: add the CSS variable, add the value to `tokens.ts`, and add
the pair to `contrastPairs` if it is used for text.
