# ADR 0014: Optional storage adapter deferral

- Status: Accepted
- Date: 2026-11-18
- Context: Stage D Privacy, Security, and Extensibility
- Related: ADR 0003, ADR 0008, ADR 0013
- Product conflict: none; this records an explicit deferral for the Stage D item
- Implementation plan: `docs/superpowers/plans/2026-11-18-stage-d-remaining.md`

## Context and problem

The PRD lists optional storage adapters in Stage D. OpenNest already supports two
storage paths: Dexie over IndexedDB in the browser and SQLite with a filesystem
blob root on Node.js. Both adapters pass the shared storage conformance suite.

The roadmap did not name a third provider. A browser File System Access adapter
was the only concrete candidate, but it is not a portable web API. It is
Chromium-only, requires repeated permission handling, and does not define what
happens when the user revokes access, moves the directory, clears browser data,
or restores a backup on another device.

Adding an external storage adapter also crosses a trust boundary. It must preserve
the encryption, backup, export, restore, delete-all, and metadata rules defined in
ADR 0008 and ADR 0013. Shipping an adapter without those answers would create a
storage path that looks supported but cannot meet the product's privacy claims.

## Goals

- Record a clear Stage D decision instead of leaving the roadmap item ambiguous.
- Keep Dexie and SQLite as the supported storage implementations.
- Define the conditions that must be met before a third adapter is reconsidered.

## Non-goals

- Implement a third storage adapter.
- Add a File System Access integration.
- Change the storage ports or the shared conformance suite.
- Add a server, sync, or cloud storage path.
- Change backup format v1 or v2.

## Constraints

- Local-first remains the default.
- Dexie and SQLite remain interchangeable through the ports in `@opennest/core`.
- Any new adapter must pass the shared conformance suite.
- No external storage path may weaken the encryption or privacy boundaries.
- No new dependency is introduced by this ADR.

## Alternatives considered

1. Implement a Chromium-only File System Access adapter now. Rejected because the
   permission and revocation model is not portable, and the backup, encryption,
   and data-loss behavior is not defined.
2. Add an adapter for a named cloud provider. Rejected because no provider is
   approved, and cloud storage would cross a different trust boundary than the
   local-only Stage D scope.
3. Keep Dexie and SQLite and defer the item with explicit conditions. Recommended.
4. Remove the roadmap item entirely. Rejected because external storage may become
   useful later; a recorded deferral preserves the option without implying that
   it is supported.

## Decision

OpenNest will not add another storage adapter in Stage D. Dexie and SQLite remain
the supported storage implementations. The optional storage adapter item is
deferred, not implemented.

A future adapter is reconsidered only when all of these exist:

1. A concrete provider or browser API with a supported portability story.
2. An explicit permission, consent, and revocation model.
3. Encrypted blob semantics compatible with ADR 0013.
4. Backup, restore, export, and delete-all behavior for externally stored bytes.
5. Adapter conformance tests and a security review of the new trust boundary.

A Chromium-only File System Access adapter is not approved by this ADR. It may be
proposed later as a separate opt-in feature with an explicit compatibility
warning, but it must still satisfy every condition above.

## Consequences

- The Stage D roadmap item is closed as an explicit deferral.
- Users continue to use IndexedDB in the browser and SQLite for the local/server
  adapter. No UI claims that external storage is supported.
- Storage diagnostics remain origin-wide where the browser exposes them.
- A future adapter is a separate implementation plan, not an extension of this
  one.
- The deferral does not block the Stage D security review, because no new storage
  boundary is introduced.

## Revisit conditions

Reopen this decision only with a new ADR that identifies the provider, the
permission model, the encrypted blob format, the backup and restore behavior, the
revocation and data-loss behavior, the conformance tests, and the security review
owner. The new ADR must link back to this one and state whether it supersedes it.

## Implementation outcome

No code is added by this ADR. `ROADMAP.md` records the deferral, and the Stage D
security dossier records that no external storage path is in scope.
