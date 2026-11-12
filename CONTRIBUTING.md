# Contributing to OpenNest

Thanks for taking the time to help. This document is short on purpose; the
details live in `AGENTS.md` (development rules) and `docs/development.md`
(environment setup).

## Before you start

1. Read `PRD.md` for product direction. Product decisions are not changed by a
   pull request.
2. Read `AGENTS.md` for scope and non-goals.
3. Run the project once (`npm install && npm run dev`) so you know the baseline
   works on your machine.

## Workflow

1. Fork and branch from `main`. Use a descriptive branch name, for example
   `feat/library-upload` or `fix/mobile-nav-overflow`.
2. Keep changes focused. One concern per pull request.
3. Run the quality gates in this order:

   ```bash
   npm run lint
   npm run typecheck
   npm test
   npm run build
   ```

4. Describe what changed and why. Include screenshots for UI changes, at mobile
   and desktop widths, light and dark.
5. If you changed a public interface, an architectural rule, or a platform
   constraint, update the relevant doc or ADR in the same pull request.

## Code conventions

- TypeScript strict mode. No `any` without a written reason.
- User-facing strings live in `packages/localization`, never inline in
  components. `en` and `id` must stay in sync; `npm test` checks parity.
- Styles come from design tokens in `apps/web/app/globals.css`. Do not hardcode
  colours.
- Import workspace packages through their barrel (`@opennest/ui`), not deep
  paths. ESLint enforces this.
- No components without a consumer. Do not add speculative abstractions.
- Interactive targets are at least 44px tall.
- Keyboard focus must be visible.

## Accessibility

Every interactive element needs a visible focus state, an accessible name, and
keyboard reachability. Colour pairs are checked by a contrast unit test; if you
add a pair, add it to `apps/web/lib/tokens.ts`.

## Commit messages

Short imperative subject line, optional body explaining the why. Example:

```text
feat(web): add language switcher to the app shell
```

## Reporting problems

- Bugs and feature requests: open an issue with steps to reproduce.
- Security issues: see `SECURITY.md`. Do not open a public issue.

## License

By contributing you agree that your contribution is licensed under
AGPL-3.0-only, the same licence as the project.
