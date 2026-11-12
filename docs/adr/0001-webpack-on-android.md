# ADR 0001: Webpack instead of Turbopack on Android

- Status: Accepted
- Date: 2026-11-12
- Context: Foundation Stage A (see `docs/superpowers/specs/2026-11-12-foundation-stage-a-design.md`)

## Context

Next.js 16 prefers Turbopack. Turbopack needs native SWC bindings, and there is
no Android/AArch64 build published for them. Next falls back to
`@next/swc-wasm-nodejs`, which compiles fine but cannot run Turbopack.

## Decision

Every Next.js invocation passes `--webpack` explicitly:

- `npm run dev` → `node scripts/next.mjs dev --webpack`
- `npm run build` → `node scripts/next.mjs build --webpack`

The flag lives in the npm scripts, not in `next.config.ts`, because
`next.config.ts` cannot force the bundler.

## Consequences

- Builds work on the reference Android device and on desktop runners.
- Webpack compilation is slower than Turbopack on desktop. Desktop contributors
  may override locally, but the committed scripts stay on Webpack so the same
  command behaves the same on every platform.
- When a native Android SWC build ships, this ADR can be revisited and the flag
  removed.
- The Next version is pinned exactly. A major upgrade must re-check whether the
  wasm fallback still exists.
