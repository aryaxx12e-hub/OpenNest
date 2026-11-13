# ADR 0002: npm workspaces with source-only packages

- Status: Accepted, partly superseded by ADR 0003
- Date: 2026-11-12
- Context: Foundation Stage A

> **Superseded in part by [ADR 0003](0003-storage-ports-and-adapters.md).**
> The decision to use npm workspaces with source-only packages still stands.
> Only the forward-looking package list at the end of "Consequences" is
> superseded: `database`, `storage`, `search`, and `shared` are not created, and
> Stage B ships `core`, `validation`, `storage-dexie`, `storage-sqlite`, and
> `storage-conformance` instead. This file is left as historical record.

## Context

OpenNest ships shared React primitives (`@opennest/ui`) and localization
(`@opennest/localization`) used by `apps/web`. Three options were on the table:

1. A single package with folders (`src/components`, `src/i18n`).
2. npm workspaces with packages consumed as built artifacts (`dist/`).
3. npm workspaces with packages consumed as TypeScript source.

## Decision

npm workspaces, with `@opennest/ui` and `@opennest/localization` consumed as
source:

- No `tsup`/`tsc` build step for either package.
- `apps/web/next.config.ts` sets
  `transpilePackages: ["@opennest/ui", "@opennest/localization"]`.
- `apps/web/app/globals.css` adds `@source "../../../packages/ui/src"` so
  Tailwind v4 scans the primitives for class names.
- Each package exposes only `src/index.ts`; ESLint's `no-restricted-imports`
  blocks deep imports.

## Consequences

- One less build step, one less failure mode, and edits to a package are picked
  up immediately in dev.
- Tailwind class discovery depends on the `@source` line. If it is removed, the
  build still succeeds and component styles silently vanish. A2 verifies the
  built CSS contains a class that exists only in `packages/ui`, and
  `docs/development.md` documents the rule.
- Packages stay framework-agnostic. They must not import Next.js or app code.
- A package without a consumer does not exist. Stage A creates only `ui` and
  `localization`; `core`, `database`, `storage`, `search`, `validation`, and
  `shared` arrive in Stage B with real interfaces and tests.
