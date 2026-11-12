# @opennest/ui

Framework-agnostic React primitives for OpenNest. Source-only package: no build
step, consumed through `transpilePackages` in `apps/web/next.config.ts`.

## Rules

- No Next.js imports. These components must stay usable in any React renderer.
- No app code imports. This package never knows about `apps/web`.
- Import through the barrel (`src/index.ts`), never a deep path. ESLint enforces
  this with `no-restricted-imports`.
- Tailwind classes only. Tokens come from `apps/web/app/globals.css`, which also
  carries `@source "../../../packages/ui/src"` so these classes are generated.
  Adding a class here without that `@source` line makes it silently disappear
  from the production CSS.

## Public API

| Export          | Notes                                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cn(...inputs)` | `clsx` + `tailwind-merge`, the standard class joiner                                                                                                |
| `Button`        | `variant`: `primary` \| `secondary` \| `ghost`; `size`: `sm` \| `md` \| `lg`; `disabled` styles; visible focus ring; `min-h-11` (44px) touch target |
| `Card`          | Bordered surface container, `rounded-2xl`, no behaviour                                                                                             |
| `Input`         | Text input with the same border, focus, and disabled treatment                                                                                      |

Every interactive primitive keeps a minimum height of 44px so mobile touch
targets stay compliant with the PRD.

## Testing

Tests live beside the source as `*.test.tsx` and are picked up by the root
Vitest config (`environment: happy-dom`). Run them with `npm test` from the repo
root.
