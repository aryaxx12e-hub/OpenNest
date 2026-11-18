# Foundation Stage A — Design

- Date: 2026-11-12
- Status: Implemented for Stage A. This document was originally a proposal; no
  separate approval record is stored here. Live status is in `ROADMAP.md`.
- Scope: Stage A of `AGENTS.md` only. Stage B and later are out of scope.
- Source documents: `PRD.md`, `AGENTS.md`, `ROADMAP.md`, `README.md`

## 1. Intent and why

OpenNest needs a foundation before any product feature: a Next.js App Router
application that builds reliably, a calm UI with real design tokens, complete
English and Indonesian localization, and quality gates that can be executed on
the development device (Android/Termux) rather than only in someone's
imagination.

The "why" behind this stage is trust. Every later stage (storage adapters,
backup, PWA) inherits these decisions. A foundation that is only assumed to work
makes every later milestone a gamble. So Stage A ends with commands that were
actually executed, and their real output recorded.

## 2. Goals

1. A reproducible npm-workspace monorepo with clear package boundaries.
2. Next.js App Router + React + TypeScript (strict), building on this device.
3. Tailwind CSS v4 with PRD-aligned design tokens and light/dark themes.
4. A small, idiomatic UI foundation (no generic dashboard aesthetic).
5. English + Indonesian localization with no hardcoded user-facing strings.
6. Lint, typecheck, unit test, and production build all passing, executed.
7. Documented development workflow for Termux and for non-Android machines.

## 3. Non-goals

- No domain models, storage interfaces, repositories, Dexie adapter, or
  persistence tests. Those are Stage B, and the PRD forbids empty abstractions.
- No file upload, notes, search, export/import, PWA, or AI.
- No self-hosted/SQLite path.
- No shadcn CLI interactive init, no component library install beyond what the
  foundation uses.
- No CI workflow file in Stage A. The PRD lists CI under Phase 0, but this
  environment cannot run GitHub Actions locally; CI will be proposed in Stage F
  and recorded as a limitation now. Browser E2E is possible locally (see 5), so
  it is a scope decision for a later stage rather than a platform limit.

## 4. Anti-goals

- Shipping a UI-only shell with non-functional controls that look real.
- Installing "everything" from the PRD stack up front so the repo looks complete.
- Claiming a check passed without pasting its output.
- Optimizing for dependency count or code volume over a working, maintainable base.
- Silently changing a PRD product decision.

## 5. Constraints (verified, not assumed)

All figures below come from executed commands. The initial spike ran in
`$PREFIX/tmp/opennest-spike`; A1 figures (install count, `node_modules` size)
come from the real workspace at `/data/data/com.termux/files/home/opennest`.

| Fact                 | Value                                                                   |
| -------------------- | ----------------------------------------------------------------------- |
| Node                 | v24.22.2, `process.platform === "android"`, aarch64                     |
| npm                  | 11.21.1 (pnpm absent; bun 1.4.4 present but not used)                   |
| Filesystem           | `/data` (f2fs) for the working tree; `npm install` ~1m for 410 packages |
| Next.js              | 16.4.6, requires Node >= 20.9                                           |
| Next SWC             | No native Android binding; falls back to `@next/swc-wasm-nodejs`        |
| Turbopack            | Unavailable (wasm bindings cannot run Turbopack) → must use `--webpack` |
| Tailwind             | 4.3.5 with a real `@tailwindcss/oxide-android-arm64` binary             |
| Vitest               | 3.2.7 + happy-dom 21.0.4, rollup android-arm64 present, works           |
| Playwright           | 1.65 present; drives system Chromium 156 headless (verified)            |
| `node_modules`       | 426 MB with Next + Tailwind + Vitest (410 packages)                     |
| `.next` (prod build) | 102 MB                                                                  |
| SWC wasm cache       | `~/.cache/next-swc/swc-wasm-nodejs-16.4.6.tgz`, 6.9 MB                  |
| Disk                 | ~5.4 GB free during A1 (95% used), watch it every milestone             |

Spike evidence, all executed:

```
npm install --no-audit --no-fund     → spike: 46 packages in 6m (FUSE)
                                       A1 workspace: 410 packages in 1m (/data)
npm run build (next build --webpack) → Compiled successfully in 27.1s,
                                       3/3 static pages, real duration 1m44
npm run typecheck                    → Types generated successfully, 14s
npm run dev (next dev --webpack)     → Ready in 2.4s, GET / 200
npm run start                        → Ready in 1.3s, GET / 200
npm test (vitest run)                → 1 passed, 4.6s
CSS output                           → 9,342 bytes, contains
                                       --color-primary:#1f4d3a,
                                       .bg-surface{background-color:var(--color-surface)}
```

### 5.1 Blocker one: no shebangs

`node_modules/.bin/next` is a symlink to a file beginning `#!/usr/bin/env node`.
On this Termux install `/usr/bin` does not exist and `termux-exec` preloading did
not make the shebang resolve (`/usr/bin/env: No such file or directory`, also
with `libtermux-exec*.so` preloaded). Therefore **every npm script invokes Node
directly**:

```json
"dev":       "node scripts/next.mjs dev --webpack",
"build":     "node scripts/next.mjs build --webpack",
"typecheck": "node scripts/next.mjs typegen && node scripts/tsc.mjs --noEmit",
"test":      "node scripts/vitest.mjs run"
```

Each shim resolves its CLI with `require.resolve` and spawns it with the current
Node binary, so hoisting inside `node_modules` never has to be guessed. `eslint`
is resolved through its `package.json` `bin` field because ESLint 9 does not
export `./bin/eslint.js`.

This is portable: it works on Linux/macOS too, and it is the only change needed
to make the toolchain usable here. No wrapper script or PATH hack.

Note for future contributors: `npx`-style invocations and any third-party bin
that is only reachable through a shebang will fail on this device for the same
reason. Adding a `bin/` shim is not planned; direct `node <path>` is enough.

### 5.2 Other verified behaviour to design around

- `next build` rewrites `tsconfig.json` (sets `jsx: "react-jsx"`, adds
  `.next/dev/types/**/*.ts` to `include`). The committed tsconfig must already
  carry these values so the build never dirties tracked files.
- Next 16 dev writes to `.next/dev`; `.gitignore` already covers `.next/`.
- `next typegen` is required before `tsc --noEmit` for route types, hence its
  place in the typecheck script.
- TypeScript 7.0.2 is native (Go) with no Android binary; **pin 5.9.3**, which is
  pure JS. (Spike confirmed 5.9.3 works.)
- SWC wasm is downloaded on first command into `~/.cache/next-swc`. That is
  outside the repo, so a fresh clone on a clean device needs network on first
  build. Document it; do not vendor the tarball into the repo.

### 5.3 The working tree lives on `/data`, not on shared storage

The repo was first created at `/storage/emulated/0/opennest-project`. That mount
is Android shared storage and it cannot host this toolchain. Evidence, all
executed in the repo directory:

| Probe                                     | Result                                                  |
| ----------------------------------------- | ------------------------------------------------------- |
| `ln -s` / `ln` anywhere on the mount      | `EACCES`, no symlinks or hardlinks                      |
| `npm install`                             | `EACCES` on `node_modules/@opennest/web`                |
| loading `lightningcss.android-arm64.node` | `ERR_DLOPEN_FAILED`, "not accessible for the namespace" |
| `cp /bin/true .execprobe && ./.execprobe` | `Permission denied` (exit 126)                          |

The mount is `fuse rw,lazytime,nosuid,nodev,noexec,noatime`. `noexec` blocks
executable mappings, and the dynamic linker's namespace forbids `dlopen` of
libraries under `/storage`. A symlink from `$HOME` into `/storage` does not help,
because Node resolves the real path first. None of this is fixable without root
or a system permission change, and neither is acceptable.

Therefore **the working tree is `/data/data/com.termux/files/home/opennest`**
(f2fs), which supports symlinks, hardlinks, `exec`, and `dlopen`. On this device
`npm install` there took ~1m and `require("lightningcss").transform()`
succeeds. Contributors on a desktop are unaffected; the rule is only "do not
develop this project on Android shared storage".

`docs/development.md` carries the short version for contributors.

## 6. Approaches considered

### 6.1 Workspace manager

| Option                      | Trade-off                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **npm workspaces (chosen)** | Already installed; lockfile v3; slower installs on FUSE but zero new tooling.                                             |
| pnpm                        | Symlinked store is the fastest option on most systems, but hardlink-dependent and FUSE-hostile; needs a separate install. |
| bun                         | Fast installs, but a second runtime and lockfile for a project that must stay reproducible on contributors' machines.     |

Chosen: **npm workspaces**, because reproducibility and the smallest number of
moving parts matter more here than install speed.

### 6.2 Bundler

| Option                             | Trade-off                                                       |
| ---------------------------------- | --------------------------------------------------------------- |
| **Webpack (`--webpack`) (chosen)** | Works today via the wasm SWC fallback; slower, but correct.     |
| Turbopack                          | Needs native SWC bindings; no Android build exists. Would fail. |

Chosen: **Webpack**, with `--webpack` explicit in the scripts so a future
Turbopack default in Next cannot silently break Android contributors. Revisit in
CI or on desktop hardware, recorded as an ADR.

### 6.3 Localization

| Option                                                    | Trade-off                                                                                                                                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Own typed catalog in `packages/localization` (chosen)** | Catalog ships in the bundle, works fully offline, no server round-trip per navigation, typed keys, parity test is trivial. Slightly less ecosystem tooling for plurals/dates. |
| `next-intl`                                               | Mature, handles plurals and formatting, but adds a routing/server-render dependency and config surface the MVP does not need yet.                                             |
| `react-i18next`                                           | Very capable and runtime-flexible; heavier and untyped by default.                                                                                                            |

Chosen: **own catalog**, because the PRD's requirement is "translation files
separated from components", two locales, offline-first. Locale is a client
preference (`localStorage`), not a URL segment: no route duplication, and the
app shell stays static. Dates and numbers use the built-in `Intl` APIs with the
active locale, so no library is needed for formatting.

### 6.4 UI foundation

| Option                                                               | Trade-off                                                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Hand-written primitives following shadcn/ui conventions (chosen)** | Full control over tokens and a11y, no network step, no CLI writes into the repo. Costs writing ~4 small components. |
| `shadcn init` + generator                                            | Fast, but interactive, network-dependent, and stamps a default look we would restyle anyway.                        |
| A component library (Radix theme, MUI, Chakra)                       | Fast start, but heavy, opinionated visuals, and fights the PRD's minimal direction.                                 |

Chosen: **hand-written primitives**, with `components.json` and `cn()` (clsx +
tailwind-merge) in place so `shadcn add <component>` remains a valid later path.

## 7. Decisions already made with the product owner

- Run a spike before touching the repo (chosen over scaffolding in place).
- npm only. Not pnpm, not Bun.
- The spike used a temp directory; the repo stayed unmodified (verified:
  `git status` clean, one commit).
- Foundation is planned and approved as a document before code (this document).

## 8. Design

### 8.1 Repository layout

```
package.json                  npm workspaces: apps/*, packages/*
package-lock.json             committed
scripts/next.mjs              require.resolve shim for next (see 8.4c)
scripts/tsc.mjs               require.resolve shim for tsc
scripts/vitest.mjs            require.resolve shim for vitest
scripts/eslint.mjs            require.resolve shim for eslint
scripts/prettier.mjs          require.resolve shim for prettier
tsconfig.base.json            strict base, shared paths
eslint.config.mjs             flat config, ESLint 9
.prettierrc.json              formatting
.prettierignore
.editorconfig
.nvmrc
vitest.config.ts              happy-dom, workspace test globs
apps/web/
  package.json                name: @opennest/web
  next.config.ts              reactStrictMode, transpilePackages
  postcss.config.mjs
  tsconfig.json               extends ../../tsconfig.base.json
  app/layout.tsx              Server Component, inline theme script, providers
  app/page.tsx                Home (welcome + getting started, real content)
  app/globals.css             @import "tailwindcss" + @theme tokens + @source
  app/icon.svg                static icon (Next serves it at /icon.svg)
  components/                 app-shell, theme-toggle, language-switcher
  lib/tokens.ts               token values for the contrast test
  lib/contrast.ts             WCAG ratio helpers
packages/ui/
  package.json                name: @opennest/ui (source-only, no build)
  README.md                   conventions and public API
  src/cn.ts
  src/button.tsx, card.tsx, input.tsx
  src/index.ts
packages/localization/
  package.json                name: @opennest/localization (source-only)
  src/en.ts, src/id.ts        typed catalogs (one object each, nested)
  src/provider.tsx            LocaleProvider, useLocale, useTranslations
  src/format.ts               Intl date, number, relative time
  src/index.ts
  src/__tests__/parity.test.ts
docs/
  development.md              Termux + generic setup, the shebang caveat
  adr/0001-webpack-on-android.md
  adr/0002-monorepo-boundaries.md
  superpowers/specs/2026-11-12-foundation-stage-a-design.md
CONTRIBUTING.md, SECURITY.md
```

`components.json` is deliberately **not** committed yet. `cn()` and the token
conventions are in place, so `shadcn add` remains a valid later path, but the
file would be inert with no components pulled. It arrives with the first shadcn
component, in a stage that actually needs one.

No directory exists without a consumer. `packages/core`, `database`, `storage`,
`search`, `validation`, `shared` are **not** created in Stage A; the first three
arrive in Stage B when their interfaces and tests exist.

### 8.2 Design tokens

`@theme` in `apps/web/app/globals.css`, named to match the PRD palette, defined
twice (light on `:root`, dark under a `.dark` class):

- `--color-background` warm off-white / deep charcoal
- `--color-surface` white / lighter charcoal
- `--color-primary` deep forest green / accessible green
- `--color-foreground` charcoal / warm white
- `--color-muted` muted gray
- `--color-border` soft neutral
- radius, spacing, and font families as Tailwind `@theme` values, not ad-hoc CSS

Dark mode is class-based (`<html class="dark">`) driven by the inline pre-hydration
script (section 8.4a) that reads `localStorage` then `prefers-color-scheme`, so it
cannot flash the wrong theme. All text/background pairs are checked by the
contrast unit test described in section 8.4g before the milestone is called done.

### 8.3 Layout and content

Desktop: collapsible sidebar with Home, My Library, Knowledge Hub, Search,
Settings. Mobile: compact bottom navigation, touch targets >= 44px, no
horizontal overflow. Home shows a welcome header, quick actions, and a
"Getting started" block that explains local storage and backups (PRD US-003,
US-004). Every action on Home in Stage A either works or is visibly marked as
coming later; **no fake buttons**.

### 8.4 Localization contract

```ts
// packages/localization/src/en.ts
export const en = {
  app: { name: "OpenNest", tagline: "Your digital life. Your rules." },
  nav: { home: "Home", library: "My Library" /* ... */ },
  home: { welcome: "...", gettingStarted: "..." },
} as const;
```

- `id.ts` is typed as `typeof en` with the same keys, so a missing key is a type
  error; the parity test also compares key paths at runtime for CI-free safety.
- `useTranslations()` returns a `t(path)` function; unknown keys return the path
  in development and throw in tests.
- No string literals in `apps/web/components/*` except non-user-facing code
  (`className`, ids, `aria-hidden` values are fine).
- After hydration the provider sets `document.documentElement.lang` to the active
  locale. Server-rendered HTML is English (section 8.4a);
  `Intl.DateTimeFormat`/`NumberFormat` are used for dates and counts.

### 8.4a Static shell vs. locale and theme on first paint

The two requirements collide: a static shell cannot read `localStorage` before
the HTML is sent, but `html lang`, page metadata, and the theme class must be
correct from the first frame.

Resolution (builder call):

- **Theme**: a small inline script in `<head>` reads `localStorage` and
  `prefers-color-scheme` and sets `class="dark"` before any paint. A
  `suppressHydrationWarning` on `<html>` keeps hydration quiet. No flash, no
  cookie.
- **Locale**: the shell is rendered in English (the PRD's default fallback).
  After hydration the provider reads the stored locale, updates
  `document.documentElement.lang` and `document.title`, and re-renders. No
  cookie, no dynamic rendering, no duplicated routes.
- **Metadata**: server-rendered `metadata` is English. The localized title is
  applied client-side. This is a **known limitation** of a static shell, listed
  in section 11, not hidden.

If the product owner later wants correct localized metadata on first byte, the
change is a locale cookie read in `app/layout.tsx`, which makes the shell
dynamic. That is a deliberate trade-off for a later stage, not a Stage A
decision.

### 8.4b How workspace packages are consumed

`@opennest/ui` and `@opennest/localization` are consumed as **TypeScript source**,
not built output. Consequences:

- `apps/web/next.config.ts` sets `transpilePackages: ["@opennest/ui",
"@opennest/localization"]`.
- `apps/web/app/globals.css` adds
  `@source "../../packages/ui/src";` so Tailwind v4 scans the primitive
  components for class names. Without it, package styles silently disappear.
- No build step, no `dist/`, no extra bundler. This is why `packages/ui` has no
  `tsup`/`tsc` build script.

### 8.4c Where the scripts live (workspace hoisting)

The spike proved `node node_modules/next/dist/bin/next ...` works in a single
package. In a workspace npm may hoist `next` to the root, so a hardcoded relative
path inside `apps/web/package.json` (whose CWD is `apps/web`) can break.

Resolution (builder call): one tiny resolver, `scripts/next.mjs` at the repo
root, which does `require.resolve("next/dist/bin/next")` and forwards argv. Root
`package.json` scripts use it:

```json
"dev":       "node scripts/next.mjs dev --webpack",
"build":     "node scripts/next.mjs build --webpack",
"start":     "node scripts/next.mjs start",
"typecheck": "node scripts/next.mjs typegen && node scripts/tsc.mjs --noEmit"
```

Same idea for `tsc` and `vitest` (`scripts/tsc.mjs`, `scripts/vitest.mjs`), each
using `require.resolve` from the root. This is portable to non-Android machines,
survives hoisting changes, and avoids a `node_modules/...` path in any package.
**A5 verifies every script actually runs, because this is the one place a wrong
guess would break the whole deliverable.**

### 8.4d Routes that exist in Stage A

Only `/` (Home) is a real route. The primary navigation shows all five PRD
destinations, but My Library, Knowledge Hub, Search, and Settings are rendered
as **disabled items with a visible, localized "Coming soon" label**, marked
`aria-disabled="true"`, not links and not buttons that do nothing. Home is the
only enabled destination. This satisfies the "no fake buttons" anti-goal while
keeping the PRD's information architecture visible.

### 8.4e Typography without a network dependency

`next/font/google` downloads fonts at build time, which would make the first
build on a clean device depend on network access and would break the "build
reliably" goal in a way the spike did not test.

Resolution (builder call): no external font download. `--font-sans` is a system
stack that prefers Inter when installed, then the platform UI font (Roboto on
Android, SF on Apple, Segoe on Windows). The PRD allows "Inter or an equivalent
readable sans-serif". Self-hosting Inter is a later, optional improvement and is
recorded as such in `docs/development.md`.

### 8.4f Onboarding scope

US-003/US-004 live in Epic A. Stage A ships a **static, informational**
"Getting started" block on Home (what local storage means, where backups go).
It is not a skippable multi-step flow with persisted dismissal; that belongs to
the onboarding milestone in a later stage. The copy is fully localized now.

### 8.4g Accessibility evidence for A5

Playwright is not a Stage A dependency, so "checked for AA contrast" must be
executable without one. A5 includes a pure unit test that computes WCAG contrast
ratios from the token values for every foreground/background pair used in the UI
(text on background, text on surface, primary on surface, muted on surface) and
fails below 4.5:1 for body text and 3:1 for large text. Keyboard reachability and
focus visibility are checked manually and reported with the actual steps taken.

### 8.5 Milestones and verification

Each milestone ends with commands that are executed, and the output pasted into
the report.

**A1 — Workspace skeleton**
Root `package.json` (workspaces, engines `>=20.9`, scripts using the `scripts/`
shims), `tsconfig.base.json`, ESLint 9 flat config, Prettier, `.editorconfig`,
`.nvmrc`, `scripts/*.mjs`, `docs/development.md` first draft.
Verify: `npm install` completes; `npm run lint` passes; every shim runs
(`node scripts/next.mjs --version` prints the pinned version).

**A2 — Next 16 App Router + Tailwind 4**
`apps/web` scaffold, tokens, providers, Home page, app shell. Scripts use the
`scripts/` shims with `--webpack` and `transpilePackages` configured.
Verify: `npm run build` succeeds; built HTML is 200 via `npm run start`; built CSS
contains the token values and `@source` class names from `@opennest/ui`; visual
check in a mobile-width viewport.

**A3 — UI foundation**
`packages/ui`: `cn`, `Button` (variants: primary/secondary/ghost, sizes, focus
ring, disabled), `Card`, `Input`. Conventions documented in
`packages/ui/README.md`.

**A4 — Localization en/id**
Catalogs, provider, `t()`, locale switcher, `html lang`, `Intl` formatting,
parity test, and a test that walks the component tree for hardcoded literals is
**not** built (too brittle); instead review + the parity test are the gate.

**A5 — Quality gates and docs**
Vitest configured at the root (`environment: happy-dom`, `include:
packages/**/*.test.ts(x)` and `apps/web/**/*.test.ts(x)`), unit tests for `t()`,
the parity check, `cn()`, Button variant mapping, and the token contrast check.
Run `lint`, `typecheck`, `test`, `build` in that order, all executed. Update
`README.md` Development section, add `CONTRIBUTING.md`, `SECURITY.md`,
`docs/development.md`, two ADRs, and tick only the ROADMAP Phase 0 items that are
genuinely complete.

### 8.6 Package boundaries

- `apps/web` may import `@opennest/ui` and `@opennest/localization`.
- `packages/ui` and `packages/localization` must not import app code, and must
  not depend on Next.js (they stay framework-agnostic React).
- No package imports another package's internals; the barrel `src/index.ts` is
  the only public surface.
- ESLint rules to enforce this are added in A1 (a `no-restricted-imports`
  pattern for cross-package deep paths).

## 9. Risks

| Risk                                                                   | Likelihood | Mitigation                                                                                                                                                               |
| ---------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Disk exhaustion (6.3 GB free, 95% used)                                | Medium     | Check `df` before every install; no duplicate caches; keep `.next` out of git; clean spike dirs.                                                                         |
| First-run SWC wasm download fails on a clean device                    | Low        | Document `~/.cache/next-swc`; document the exact error and the manual `npm i @next/swc-wasm-nodejs@16.4.6` fallback.                                                     |
| A future Next release drops the wasm fallback                          | Low        | Pin Next exactly; ADR records the constraint; CI on a desktop runner is the escape hatch.                                                                                |
| Shebang-only tooling creeps in (e.g. a new CLI)                        | Medium     | Rule in `docs/development.md`: invoke CLIs as `node <path>` in scripts; mention it in the PR template later.                                                             |
| E2E possible but outside Stage A scope                                 | Certain    | Not added as a Stage A dependency. Verified available for a later stage: Playwright 1.65 with `executablePath` pointing at system Chromium. No false "E2E green" claims. |
| Localization drift                                                     | Medium     | Typed `id: typeof en` plus runtime parity test.                                                                                                                          |
| Package styles silently dropped (`@source` missing from `globals.css`) | Medium     | A2 verifies the built CSS contains a class that only exists in `packages/ui`; ADR records the rule.                                                                      |
| Scope creep into Stage B                                               | Medium     | This document's non-goals are explicit; anything beyond them is a separate proposal.                                                                                     |

## 10. Left to the builder

- Exact component API details for Button/Card/Input, as long as variants and
  a11y meet the PRD.
- Wording of the Home page copy, in both languages, within the PRD's tone.
- Whether the sidebar starts collapsed on tablet widths.
- Test file placement inside each package, as long as the root Vitest config
  picks it up.
- Whether to add `prettier-plugin-tailwindcss` (allowed; it does not change
  behaviour).

## 10a. Decisions taken during the builder check

Settled here rather than asked, because a competent builder could choose either
way without changing what gets built:

- Theme/locale first paint: inline theme script plus English-first static shell
  (8.4a). Localized metadata on first byte is deferred and reported.
- Workspace package consumption: source + `transpilePackages` (8.4b).
- Script resolution: root `scripts/*.mjs` using `require.resolve` (8.4c).
- Navigation: one real route, four visibly disabled destinations (8.4d).
- Typography: system stack, no build-time font download (8.4e).
- Onboarding: static informational block, not a persisted flow (8.4f).
- Accessibility evidence: computed contrast unit test plus a manual keyboard
  pass (8.4g).

Open question for the product owner is recorded in the report, not here.

### 10b. Verified results (executed, not planned)

A1, taken from the real workspace:

```
npm install --no-audit --no-fund   → added 410 packages in 1m
npm run lint                       → exit 0
npm run format:check               → all files formatted
node scripts/next.mjs --version    → Next.js v16.4.6
node scripts/tsc.mjs --version     → Version 5.9.3
node scripts/vitest.mjs --version  → vitest/3.2.7 android-arm64
node scripts/eslint.mjs --version  → v9.39.5
node scripts/prettier.mjs --version→ 3.10.0
```

A2 and A5:

```
npm run typecheck  → route types generated, tsc exit 0 (8 package files included)
npm run build      → compiled 30.9s, 4/4 static routes (/, /_not-found, /icon.svg)
npm run start -p N → GET / 200, CSS 200; HTML contains the English shell and
                       the pre-paint theme script
npm test           → 6 files, 47 tests passed (5.3-9.5s)
```

Browser checks with Playwright 1.65 + system Chromium 156 (headless,
390x844 and 1280x800):

- Theme toggle sets `.dark`; body background `rgb(23, 26, 25)`; persists across
  reload; no flash on first paint.
- Locale switch to `id` updates `document.documentElement.lang` and re-renders
  copy; persists across reload.
- No console errors and no page errors.
- No horizontal overflow at 320, 390, 768, or 1280 px.
- Skip link is the first tab stop, 153x40 px when focused, and moves focus to
  `#main-content`.
- Focus ring computes to `solid 2px`.
- "Show more" expands two cards to three and sets `aria-expanded="true"`.
- Built CSS (16,687 bytes) contains `#1f4d3a`, `#faf8f3`, `bg-surface`,
  `rounded-2xl`, `border-border`, `min-h-11`, and
  `focus-visible:outline-primary`; the last one only exists in
  `packages/ui/src`, proving `@source` works.

Review pass (after the first green build) found and fixed:

- Three catalog keys were defined but never used (`nav.menu`, `common.theme`,
  `home.quickActions`); removed.
- `Button` existed but the app used a raw `<button>`; Home now uses `Button`.
- `meta[name="theme-color"]` stayed light in dark mode; the pre-paint script and
  `setTheme` now update it.
- `localStorage` access in the locale provider and theme helpers could throw in
  private modes; reads and writes are now guarded.
- `packages/ui` was missing its `react` peer dependency.
- The mobile nav truncated labels ("Knowledge..."); short labels are now a
  separate catalog key.
- `--radius-card` was defined but never used; removed.
- The tokens-sync test used `__dirname`, which Vitest does not provide in ESM;
  it now resolves from `process.cwd()`.
- An unused `applyStoredTheme` helper and a duplicate storage-key module were
  written and then removed before finalising.

After the fixes, the same gates were re-run: lint, typecheck, test (41),
build, and format all exit 0, and the browser checks were repeated with the
same results plus `theme-color` switching to `#171a19` in dark mode and no
light flash on reload.

A second, independent review pass (fresh reader, no access to the earlier
conclusions) was run on the navigation shell. It found that every navigation
item, including the current page, was a `<span>`, so the nav contained no
focusable target and `aria-disabled` sat on role `generic`, which assistive
technology ignores. It also found both landmarks sharing one accessible name.
Fixed in this stage:

- The current page renders as `<Link href="/" aria-current="page">` in both the
  desktop sidebar and the mobile bottom bar.
- Unavailable destinations render as plain text: no link, no button, no
  `aria-disabled`, no `aria-current`, and no `tabindex`.
- The two landmarks are now `Primary navigation` and `Quick navigation`
  (`nav.labelDesktop`, `nav.labelMobile`), distinct in both locales.
- New `apps/web/components/__tests__/app-shell.test.tsx` (6 tests) pins all of
  the above, including that no `aria-disabled` exists anywhere in the shell and
  that the only focusable elements inside the nav landmarks are the two Home
  links.

Verified in Chromium at 390x844 and 1280x800 after the change: tab order is
skip link, language select, theme toggle, "Show more", then the Home link;
Enter on the skip link focuses `MAIN#main-content`; the desktop toggle flips
`aria-expanded` from `true` to `false` and hides the sidebar; the desktop
landmark is hidden below `md` and the mobile one above it; no horizontal
overflow at 320, 360, 390, 768, or 1280 px. Gates after the change: lint,
typecheck, 47 tests, build, and format all exit 0.

Review findings deliberately deferred to the next stage (recorded as
evaluation input, deliberately not fixed here):

1. Cross-tab theme sync is ineffective: `subscribeToTheme` listens for `storage`
   but `isDarkTheme` reads the DOM class, which another tab never changed.
2. `viewport.themeColor` ships a single light value; the pre-paint script
   corrects it, so a user with JavaScript disabled and a dark OS preference
   keeps a light browser chrome.
3. Bottom-nav secondary labels are `text-[9px]` and primary labels
   `text-[11px]`, below a comfortable minimum for navigation text.
4. OS theme changes after load are ignored until reload; there is no
   `matchMedia` listener.
5. `translate()` swallows a missing key in production and `t` is typed
   `(path: string) => string`, so a typo renders the raw key with no type or
   runtime signal outside tests.
6. `apps/web/lib/tokens.ts` and `apps/web/app/globals.css` duplicate the colour
   values; a test catches drift only for values already present in the
   stylesheet, not for values that were edited to something invalid.
7. The theme toggle applies `aria-label="Toggle theme"` over its visible
   "Light"/"Dark" text and does not announce the destination state.

Two lint-time corrections were needed and are reflected in the code:

- ESLint 9 does not export `./bin/eslint.js`; `scripts/eslint.mjs` resolves it
  through the package's `bin` field.
- `react-hooks/set-state-in-effect` rejects syncing storage into state from an
  effect. Both the locale provider and the theme toggle use
  `useSyncExternalStore` instead.

A `favicon.ico` request still returns 404; Next serves `/icon.svg` (200) and
browsers use it. No error appears in the console.

## 11. Explicit limitations to report at the end of Stage A

1. Turbopack is disabled for this project on Android. It will be revisited in CI.
2. E2E is not part of Stage A. Playwright 1.65 and system Chromium 156 are
   available on this device and were used for the A2 manual verification, so a
   later stage can add real E2E without a desktop runner.
3. On Termux the working tree must live on `/data`, not on Android shared
   storage (5.3). `npm install` takes about a minute there rather than the
   several minutes measured on shared storage.
4. `next build` takes ~1m45s here, so quality gates are run deliberately, not in
   a tight loop.
5. Page metadata (title/description) is English on first byte; the localized
   title is applied after hydration. A cookie-based locale would make the shell
   dynamic and is deferred.
6. The system font stack is used instead of a downloaded Inter; self-hosting is a
   later optional improvement.
