# OpenNest design system

The current direction is **Nest Rail**. It replaces the earlier cream and green
shell with a calm, local-first workspace: a warm paper canvas, crisp panels, a
compact icon rail, deep teal ink, and a muted sienna accent.

The design is not a generic dashboard. It should feel like a well-kept desk or
nest: quiet, tactile, and ready for real content. The rail is navigation, not
decoration. The storage ring and the Nest health panel are the only places where
the interface raises its voice.

## Principles

- **Content first.** Files, notes, folders, and the next useful action lead.
- **Quiet chrome.** Navigation and controls recede until needed.
- **One focal point per screen.** Do not compete with the storage moment.
- **Real material.** Use warm paper, crisp white panels, hairline borders, and
  restrained shadows. Avoid glass, glow, and decorative gradients.
- **Local-first by default.** Copy and status must be truthful about local
  storage, browser quotas, and backups.
- **Accessible at every size.** Keyboard focus, reduced motion, labels, and AA
  contrast are part of the component contract.
- **Mobile is not a smaller desktop.** The rail becomes a bottom bar, header
  controls compact, and the health aside moves out of the primary flow.

## Tokens

Tokens live in `apps/web/app/globals.css` and `apps/web/lib/tokens.ts`. Both
files must agree. Use the Tailwind theme classes instead of raw hex values in
components.

| Role                 | Light     | Dark      |
| -------------------- | --------- | --------- |
| `background`         | `#f5f4f0` | `#0d1412` |
| `surface`            | `#ffffff` | `#151f1c` |
| `surface-muted`      | `#eeece6` | `#1c2925` |
| `primary`            | `#0f6b6b` | `#6fd3c4` |
| `primary-foreground` | `#ffffff` | `#08201c` |
| `primary-soft`       | `#dcefea` | `#173b35` |
| `accent`             | `#8a4b24` | `#e7b58a` |
| `accent-soft`        | `#f6e7da` | `#3a2a1e` |
| `foreground`         | `#18211e` | `#eef3f0` |
| `muted`              | `#5e6a64` | `#a5b2ac` |
| `border`             | `#e1ded6` | `#2a3733` |

Radii:

- `rounded-control`: `0.875rem` for buttons, inputs, selects, and compact rows.
- `rounded-card`: `1.5rem` for cards and shelves.
- `rounded-panel`: `1.75rem` for the app frame and large feature panels.

Shadows:

- `shadow-card`: soft, low-contrast lift for panels.
- `shadow-float`: reserved for the app frame and floating navigation.

Typography uses the system sans stack. Page titles are `text-3xl` and
`sm:text-4xl`. Body copy is `text-sm leading-6`. Metadata is `text-xs` with the
muted color. Do not introduce a custom font without a performance review.

## Layout

- The outer canvas is `background`. The application frame is a `panel` with a
  border and `shadow-float`.
- Desktop uses a compact icon rail. It keeps the six primary destinations and
  the OpenNest mark.
- The header brand lockup uses the provided OpenNest wordmark as a mask over
  `currentColor`, so it follows the primary token in both themes. The source is
  `apps/web/public/brand/opennest-wordmark.png`; keep it as a decorative
  `aria-hidden` element and leave the accessible name on the home link.
- Mobile uses a fixed bottom navigation bar with safe-area padding. Main content
  reserves space below it.
- The dashboard uses a main column plus an `18rem` health aside at `xl` and
  above. The aside is hidden below `xl`; its information must not be the only
  path to a critical action.
- Page padding is `px-4 sm:px-6 lg:px-8`. Sections use `space-y-5`. Cards use
  `p-5 sm:p-6` unless they contain a shelf or table.
- Standard screens use `PageContainer` from `apps/web/components/page-container.tsx`.
  It owns the centered `max-w-6xl` column, responsive padding, and `space-y-6`.
  The note editor overrides it to `max-w-5xl`. Do not add a new
  `mx-auto max-w-*` wrapper to a screen.
- Use `rounded-card` for shelves, empty states, and content panels;
  `rounded-control` for inputs, nested panels, and compact controls; and
  `rounded-panel` for the app frame and full-screen task cards.

## Components

- **Button.** One primary action per view. Secondary actions use the bordered
  surface treatment. Minimum interactive height is 44px.
- **Card.** A surface panel with a hairline border and `shadow-card`. Do not
  nest cards inside cards without a clear hierarchy.
- **PageContainer.** The standard page column for every screen except the
  dashboard and full-screen encryption gates.
- **Input, Select, Textarea.** Use `rounded-control`, a visible label, and the
  shared focus ring. Errors belong next to the field.
- **Dialog.** Use the shared dialog primitive for confirmation and creation.
  Do not build ad hoc overlays.
- **Badge.** Use the primary tone for status, the accent tone for attention, and
  keep labels short.
- **EmptyState.** Explain the next action and provide it. Use an optional icon,
  not an illustration.
- **Skeleton.** Match the final layout. Do not show a spinner for a full page.
- **Icons.** Use the inline set from `@opennest/ui`. Do not mix icon families.

## Dashboard rules

- The storage headline uses `overview.bytes`, which counts file/blob storage
  only. Label it "File storage" or the localized equivalent.
- The ring uses the browser storage estimate when available. When the browser
  does not expose a quota, show the used bytes and say that the quota is not
  reported. Never invent a quota.
- The ring is the one strong data moment. Keep the rest of the dashboard quiet.
- Quick actions are New note, Upload, New folder, and Search. Keep labels short
  enough to fit at 360px.
- Recent files and notes are shelves, not full tables. Show the latest five and
  link to the full view.
- Nest health reports storage, backup, offline readiness, and privacy. It is
  informational, not a substitute for the Privacy Center.

## Accessibility

- Every foreground/background pair used for text is checked by the contrast
  test. Add new pairs when adding tokens.
- Keep the shared focus ring. Do not remove outlines without a replacement.
- Respect `prefers-reduced-motion`; the global stylesheet already reduces
  animation and transition durations.
- Give icon-only controls an accessible name. Use `aria-label` or visible text.
- Keep both navigation landmarks and the skip link.
- Test at 360, 768, and 1280 in light and dark.

## Adding a token

1. Add the CSS variable to `:root` and `.dark` in `globals.css`.
2. Add the value to `apps/web/lib/tokens.ts`.
3. Add text pairs to `contrastPairs` when the token is used for text.
4. Run the token parity and contrast tests.
5. Document the role here if it is part of the public visual language.
