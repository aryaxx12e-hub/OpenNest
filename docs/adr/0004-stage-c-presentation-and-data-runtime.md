# ADR 0004: Stage C presentation runtime and local data flow

- Status: Accepted
- Date: 2026-11-13
- Context: Stage C (MVP features), after ADR 0003

## Context

Stage C is the first point where `apps/web` reads and writes real data. The app
needs one browser storage connection, one workspace, domain services, and a way
for independent screens (dashboard, library, notes, search) to see each other's
writes. It also needs this without adding a server API or a data-fetching
framework that would duplicate the ports already defined in `core`.

## Decision

1. **One browser adapter instance.** `apps/web/lib/data/browser-storage.ts`
   opens Dexie once and shares the promise. Every caller gets the same adapter,
   so IndexedDB connections and transactions are not multiplied per component.
2. **One composition root.** `createAppServices` builds the domain services on
   top of the storage ports. `AppDataProvider` opens storage, ensures exactly one
   workspace, and exposes `{ storage, services, workspace }` through React
   context. UI code never imports Dexie, repositories, or domain services
   directly.
3. **Explicit invalidation, not a query cache.** A small revision store lives in
   the provider. Mutations call `invalidate()`; `useAsyncData` reloads when the
   revision changes or its key changes. The app does not use React Query, Redux,
   Zustand, or SWR. The data set is local, the writes are user-driven, and a
   cache with staleness policies would add more failure modes than it removes.
4. **Loading data is a hook, not a server component.** Browser storage is the
   source of truth, so screens are client components. `useAsyncData` owns
   loading, error, retry, and cancellation of superseded loads. It uses
   `useEffectEvent` so loaders always read current values without becoming
   effect dependencies.
5. **Shareable state belongs in the URL.** The active folder is a route
   (`/library/[folderId]`). Search text and filters are URL search parameters, so
   refresh, back/forward, and links preserve the view.
6. **Markdown is rendered with `react-markdown` and `remark-gfm`.** Raw HTML is
   skipped, remote images are replaced with a local notice, and external links
   open with `noopener noreferrer`. Notes autosave after a short idle delay and
   on blur; the editor keeps unsaved text in React state if a save fails.
7. **Files are previewed from local blob URLs.** Images, PDFs, and text previews
   use `URL.createObjectURL` and revoke the URL when the view changes. Files are
   never uploaded or executed.
8. **Destructive actions stay explicit.** Rename, move, delete, folder deletion,
   and note deletion use dialogs with localized descriptions. There is no
   optimistic deletion.

## Consequences

- Every screen depends on the provider being mounted in `apps/web/app/layout.tsx`.
  A screen rendered outside it fails fast instead of opening a second database.
- A mutation that does not call `invalidate()` will not refresh other views. This
  is deliberate and easy to audit, but it is a rule reviewers must check.
- Autosave writes through `note.update`; it does not invalidate the whole app on
  every keystroke. Navigating away after the debounce flushes on blur.
- The C5 backup work reuses the same provider and services, adding
  `refreshWorkspace()` for restores (see ADR 0005). Stage E PWA work can use the
  same runtime and is gated by its own milestone approval, not by this ADR.
- The SQLite adapter remains server-side and unused by the browser app. A future
  self-hosted deployment needs a different composition root, not a change to the
  UI contracts.
