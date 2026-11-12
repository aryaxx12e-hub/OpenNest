# Security Policy

## Supported versions

OpenNest is in pre-development. There are no supported releases yet. Security
fixes are applied to `main` only.

## Reporting a vulnerability

Do not open a public issue for a security problem.

Report it privately to the maintainers through the repository's private
vulnerability reporting channel (GitHub Security Advisories on the project
repository). Include:

- A description of the issue and its impact.
- Steps to reproduce, or a minimal proof of concept.
- The commit or version you tested.
- Any suggested mitigation.

You can expect an acknowledgement within a few days. Please give the maintainers
time to ship a fix before disclosing details publicly.

## Scope

OpenNest is local-first. The highest-risk areas are:

- Anything that reads or writes user files.
- Export and import paths, which handle user data directly.
- Anything that could send user data to an external service without explicit
  consent.

## Our commitments

- No telemetry and no analytics by default.
- No data leaves the device without an explicit user action.
- Dependencies are pinned, and new dependencies are reviewed for necessity.
