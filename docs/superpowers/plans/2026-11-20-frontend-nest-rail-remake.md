# Frontend Nest Rail Remake

Status: complete

## Goal

Replace the utilitarian cream and green shell with a distinct local-first workspace built around the OpenNest mark: a quiet sage-paper canvas, a compact icon rail, one strong storage moment, and real product material. The first pass covers the foundation, shell, and dashboard. A follow-up pass applies the same system to the remaining screens.

## Direction

- Product: a local-first personal library for files, notes, and knowledge.
- Character: calm, tactile, quietly capable.
- World: a well-kept nest or desk, warm paper, woven fibers, soft daylight, deep teal ink.
- Moments: the storage ring, the recent content shelf, and the Nest health panel.
- Signature: a small woven lattice motif borrowed from the logo, used as a section marker and status detail, not as decoration everywhere.

## Scope

In scope:

- Design tokens, light and dark themes, logo mark, app icons.
- UI primitives and icon set.
- App shell: brand lockup, icon rail, header controls, mobile bottom nav.
- Dashboard: storage overview, quick actions, recent files and notes, Nest health, backup reminder, empty, loading, and error states.
- Follow-up pass: Library, Notes, note editor, Search, File preview, Settings, Privacy, Extensions, AI console, Offline, Extension runner, and encryption screens.
- English and Indonesian copy for all new text.
- Tests and documentation.

Out of scope:

- New dependencies, custom font files, or new data features.
- Fake storage quotas or invented usage numbers.

## Tasks

1. Add theme tokens and CSS variables. Extend the token parity and contrast tests first, watch them fail, then add `surfaceMuted`, `primarySoft`, `accent`, and `accentSoft` in both themes.
2. Recreate the OpenNest mark as an SVG. Generate favicon, Apple touch icon, and PWA icons from it. Add the icon set to `@opennest/ui`.
3. Restyle the UI primitives: Button, Card, Input, Select, Textarea, Dialog, Badge, Skeleton.
4. Rebuild the app shell with the Nest Rail. Keep both navigation landmarks, all six links, offline navigation, skip link, theme, language, and connection status.
5. Rebuild the dashboard with the storage ring, stat cards, quick actions, recent files and notes, Nest health, backup reminder, and complete states.
6. Update localization, tests, and docs. Run lint, format check, typecheck, unit tests, production build, and visual checks at 360, 768, and 1280 in light and dark.
7. Follow-up: extract `PageContainer`, apply the Nest Rail surfaces to every remaining screen, replace legacy radii, add the container test, and repeat the full verification pass.

## Verification

- `npm run lint`
- `npm run format:check`
- `npm run typecheck`
- `npm test`
- `npm run build`
- Playwright screenshots at 360, 768, and 1280 in light and dark.
- Keyboard focus, reduced motion, and contrast spot checks.

## Constraints

- Do not commit unless Rya explicitly asks.
- No new runtime dependencies.
- Use the existing localization system. Every new user-facing string needs English and Indonesian.
- Keep all existing data flows and privacy behavior.
- Use real storage data. If the browser does not expose a quota, say so instead of inventing one.

## Wordmark revision

- Replaced the text title in the header brand lockup with the supplied OpenNest
  wordmark at `apps/web/public/brand/opennest-wordmark.png`.
- The wordmark is applied as a CSS mask over `currentColor`, uses the primary
  token in both themes, keeps the link's accessible name, and is precached by the
  service worker.
- Verified at 360 px and 1050 px in light and dark, with the tagline hidden below
  `sm`.

## Follow-up verification

- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm test` passed: 187 files, 1680 tests.
- `npm run build` passed; service worker generated with 60 precached paths.
- Prettier passed for every changed source and documentation file. The repository-wide
  check still flags the untracked Stage E file `apps/web/components/conflict-dialog.tsx`,
  which was not touched by this pass.
- Visual checks completed at desktop and mobile for Library, Notes, note editor, Search,
  Settings, Privacy, AI, Extensions, Offline, and File preview, including dark mode.
- Wordmark revision: app-shell tests 11/11 passed, typecheck and lint passed, full suite
  187 files / 1680 tests passed, production build passed with 61 precached paths.
