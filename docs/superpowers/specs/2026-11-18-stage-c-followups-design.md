# Stage C Follow-ups: Knowledge Hub, Library Controls, and Recovery Design

- Status: Approved; delivered
- Date: 2026-11-18
- Scope: Close the Stage C follow-ups listed in `ROADMAP.md` by delivering the
  small, complete slices and recording explicit deferrals for the larger ones.
- Product source: `PRD.md` Module 01, Module 02, Epic C, US-010, US-014, US-015,
  and the Stage C exit criteria. `ROADMAP.md` Stage C and PRD Gap Register.
- Supersedes: nothing.

## 1. Intent

Stage C core is delivered, but the roadmap still leaves the Knowledge Hub,
library controls, and recovery follow-ups open. The PRD Gap Register also lists
items whose status is still `Pending owner decision`.

This design closes the stage without pretending every PRD idea is small. It
delivers three complete user-facing slices, records the remaining work as
explicit deferrals, and leaves the repo ready for the Stage D security and
storage work already in progress.

The slices are:

1. Note-to-note links and individual Markdown export.
2. Library sort and filter controls.
3. Backup reminders, storage diagnostics, and restore-failure guidance.

## 2. Goals

1. A user can connect a note to other notes, see those links, and export the
   current note as a portable Markdown file.
2. A user can sort the library by name, date added, or last updated, and filter
   files by document or image type.
3. A user can see when the last successful backup happened, receive a calm
   reminder when it is stale, inspect browser storage pressure and persistence,
   and get concrete guidance when a restore fails.
4. All new user-facing text exists in English and Indonesian.
5. Existing quality gates keep passing, including type checking, linting, unit
   tests, component tests, production build, and the relevant critical flow.

## 3. Non-goals and explicit deferrals

The following are deliberately not part of this change:

1. Basic revision history. Autosave and draft recovery remain the only history.
2. Per-collection export. The full-workspace backup remains the export unit.
3. Note-file links. This needs a new relation, migrations, backup format work,
   and sync changes, so it is not a Stage C small slice.
4. Backlinks. The repository exposes only outgoing note links; a backlink query
   would touch the ports and both storage adapters.
5. Interrupted-restore cleanup. This stays a Stage D storage item.
6. Automatic repair of damaged backups. The recovery slice is guidance plus the
   existing validated restore flow, not a repair tool.
7. Markdown import. Only export is in scope.
8. A new Knowledge Hub route. Links live in the existing note editor.

Each deferral must be written into `ROADMAP.md` with an owner decision and a
reason. A checked umbrella item does not close a gap.

## 4. Constraints

- Termux/Android workspace with no native dependency additions.
- UI uses the existing `@opennest/ui` primitives and design tokens.
- No new runtime dependency is required.
- Browser storage can be blocked, cleared, or evicted; a backup reminder is not
  a backup.
- `navigator.storage.estimate()` reports origin-wide usage, not only OpenNest.
- The note link picker must not hide its limits. The existing repository lists at
  most 500 notes per page.
- All new text must go through `@opennest/localization`; no hardcoded UI strings.

## 5. Approaches considered

### 5.1 Note links

Option A: add a new Knowledge Hub route and graph view. This is a larger feature
and needs navigation, layout, and graph rendering work. Rejected for this stage.

Option B: put an outgoing link editor and a linked-note list in the existing note
editor. This uses `NoteService.setLinks` and `NoteService.links` without changing
storage. Chosen.

Option C: add bidirectional backlinks now. This needs a new repository query,
service method, both adapter implementations, and brokered-service forwarding.
Deferred because it expands the cross-layer surface beyond a small slice.

### 5.2 Markdown export

Option A: export raw note content only. Simple, but loses the note title.

Option B: export a Markdown document with the title as an H1 followed by the
content, and use a sanitized title as the file name. Chosen. It is portable,
readable without OpenNest, and needs no frontmatter escaping.

Option C: export YAML frontmatter with title and tags. More metadata, but it
needs escaping rules and adds a format contract. Deferred.

### 5.3 Library filter

Option A: add a free-text filter. This duplicates Search and makes the library
feel like a second search page. Rejected.

Option B: add a type filter for documents and images, using the existing
`FileFilter.mimeTypes` support. Chosen. It is useful, bounded, and needs no
storage change.

Option C: add tag filtering. This is useful, but it needs loading tags and a
second filter surface. Deferred until the Knowledge Hub work if users ask.

### 5.4 Backup reminder

Option A: store the last backup timestamp inside the workspace data. This would
make the reminder portable, but it would change the data model and backup format
for a non-content preference. Rejected for this stage.

Option B: store a timestamp in `localStorage` under a namespaced key. Chosen. It
is device-local, non-sensitive, and matches the fact that a backup is a device
action. It can be cleared with site data, which is acceptable for a reminder.

Option C: use IndexedDB. More durable than `localStorage`, but it adds an async
store and a schema for one timestamp. Rejected.

### 5.5 Storage diagnostics

Option A: extend `privacy.data.overview()` with browser storage values. This
couples a data-control service to `navigator.storage` and makes existing tests
depend on browser APIs. Rejected.

Option B: add a web-only `lib/privacy/storage-status.ts` helper and a separate
diagnostics card. Chosen. It keeps `DataOverview` honest and testable.

### 5.6 Recovery guidance

Option A: a static help paragraph. Cheap, but not a guided workflow.

Option B: contextual guidance keyed by the restore error, plus storage-pressure
advice and a link to diagnostics. Chosen.

Option C: automatic cleanup and repair. This is Stage D work and is deferred.

## 6. Note links

### 6.1 Data flow

`packages/core/src/ports.ts` already defines:

- `NoteRepository.setLinks(id, targetIds)` to replace outgoing links.
- `NoteRepository.links(id)` to read outgoing links.

`NoteService.setLinks` already validates that the note exists, rejects self
links, deduplicates targets, rejects missing targets, and rejects targets from a
different workspace. No core or storage change is needed.

The note editor reads:

- the current note,
- all notes for the picker, limited to 500 and sorted by `updatedAt desc`,
- the current note's outgoing links,
- the linked note records resolved with `services.note.get` so a stale link does
  not render a broken item.

### 6.2 UI

Add a secondary `Links` action to the note editor action row. It opens
`NoteLinksDialog`.

The dialog contains:

- a search input that filters the loaded notes by title and content on the
  client,
- a checkbox list of notes, excluding the current note,
- an empty state when there are no other notes,
- a note when the workspace has more notes than the loaded page,
- a save action that calls `services.note.setLinks(note.id, selectedIds)`,
- a cancel action that discards the draft selection,
- busy, error, and success states.

The editor renders a `Linked notes` section below the tag list:

- each item is a link to `/notes/{id}`,
- each item shows the target note title,
- a disabled-style message appears when a target cannot be resolved,
- an edit action opens the dialog,
- an empty state offers the same action.

Saving links calls `invalidate()` so `useAsyncData` reloads the note data.

### 6.3 Limits

The picker loads at most `limits.maxPageSize` notes. If `Page.total` is larger
than the loaded items, the dialog shows a localized notice rather than implying
the list is complete. Backlinks are not shown and are recorded as deferred.

## 7. Markdown export

Add helpers to `apps/web/lib/notes.ts`:

- `noteMarkdownFileName(title: string): string`
- `noteMarkdownDocument(title: string, content: string): string`

The file name:

- trims the title,
- replaces path separators and Windows-reserved characters,
- collapses whitespace,
- limits the base to 80 characters,
- falls back to `note` when the title is empty,
- appends `.md`.

The document:

- uses `# {title}` as the heading,
- uses `Untitled note` when the title is empty,
- preserves the note content as-is,
- ends with a newline.

The note editor adds an `Export Markdown` action. It uses the current editor
title and content, so the export reflects what the user sees even if an autosave
is still in flight. It calls `downloadTextFile(fileName, document,
"text/markdown")`.

`downloadTextFile` gains an optional MIME type argument with the current
`application/json` default. Backup behavior stays unchanged.

## 8. Library sort and filter

### 8.1 State

`LibraryBrowser` gains three pieces of local state:

- `sort: SortField`, default `updatedAt`,
- `direction: "asc" | "desc"`, default `desc`,
- `type: "all" | "documents" | "images"`, default `all`.

The `useAsyncData` key includes all three values plus the current folder and
page limit, so changes reload the query.

### 8.2 Query

Add `apps/web/lib/library.ts` with:

- `LibraryFileType`,
- `libraryTypeMimeTypes(type)`, returning `undefined` for `all` and the allowed
  MIME list for documents and images.

The file query passes:

- `filter.mimeTypes` when a type filter is active,
- `options.sort` and `options.direction` from state.

The folder query stays unchanged. Folder cards keep their current behavior.

### 8.3 UI

Add a filter row above the file list with three labeled controls:

- `Sort by`: Name, Date added, Last updated.
- `Direction`: Ascending, Descending. Labels adapt to the sort field in text,
  but the accessible label stays stable.
- `Type`: All files, Documents, Images.

The file count reflects the filtered total. The `Show more` button keeps using
the filtered query.

When the filtered result is empty but the folder is not empty, show a distinct
empty state with a `Clear filters` action. When the folder truly has no files,
keep the current empty state.

Changing sort, direction, or type resets the limit to `PAGE_STEP` so a previous
`Show more` expansion does not silently apply to a new query.

## 9. Backup reminder

### 9.1 Storage contract

Add `apps/web/lib/data/backup-reminder.ts`:

```ts
export const BACKUP_REMINDER_DAYS = 14;

export interface BackupReminderStatus {
  lastBackupAt: string | null;
  daysSince: number | null;
  due: boolean;
  never: boolean;
}

export function readLastBackupAt(): string | null;
export function recordBackupExported(at?: Date): string | null;
export function clearBackupRecord(): void;
export function backupReminderStatus(
  lastBackupAt: string | null,
  now?: Date
): BackupReminderStatus;
```

Rules:

- Key: `opennest:backup:last-export`.
- Value: an ISO timestamp.
- Invalid values are treated as missing.
- `daysSince` is floored from the elapsed milliseconds and never negative.
- `due` is true when there is no timestamp or `daysSince >= 14`.
- Every `localStorage` access is guarded because storage can be blocked.
- A failed write does not fail the backup download; it only means the reminder
  cannot persist.

### 9.2 Recording a successful backup

`BackupPanel` and `PrivacyCenter` already receive an `onExported` callback from
`BackupExportDialog`. Both call `recordBackupExported()` there, set local state
for the status line, and keep their existing success message.

### 9.3 Surfacing

`BackupPanel` shows a `Last backup` line:

- `Never` when no valid timestamp exists,
- the formatted calendar date when one exists.

`Dashboard` reads the timestamp in its existing async loader and renders a
`BackupReminder` card when the workspace is not empty and the status is due:

- never backed up: explain that local storage is not a backup and link to
  `/settings#backup`,
- stale backup: show the last backup date and link to `/settings#backup`,
- recent backup: render nothing.

The reminder is a card, not a modal. It must not block any other action.

`BackupPanel` gets `id="backup"` and a scroll margin so the link lands on it.

## 10. Storage diagnostics

Add `apps/web/lib/privacy/storage-status.ts`:

```ts
export interface StorageStatus {
  supported: boolean;
  usage: number | null;
  quota: number | null;
  persisted: boolean | null;
}

export async function readStorageStatus(): Promise<StorageStatus>;
export async function requestPersistentStorage(): Promise<
  "granted" | "denied" | "unsupported"
>;
```

Rules:

- Return `supported: false` when `navigator.storage` is unavailable.
- Treat `estimate()` or `persisted()` failures as unknown values, not page
  errors.
- `requestPersistentStorage()` calls `navigator.storage.persist()` only when it
  exists and returns the boolean result.
- Diagnostics are origin-wide. The UI must say "this site", not "OpenNest only".

Add `StorageDiagnostics` to `PrivacyCenter` below `PrivacyOverview`. It shows:

- whether the browser reports storage diagnostics,
- usage and quota, formatted with `formatBytes`,
- usage percentage when quota is greater than zero,
- persistent storage status: granted, not granted, or unknown,
- a `Keep this data` action when persistence can be requested,
- eviction guidance: browsers can clear site data under pressure, and persistent
  storage is not a backup.

The request action calls `requestPersistentStorage()`, sets a success or error
message, and reloads the privacy data. A denied request is a normal result, not
an exception.

## 11. Recovery guidance

### 11.1 Error mapping

Add `apps/web/lib/data/recovery.ts`:

```ts
export type RecoveryTip =
  "wrongKey" | "damaged" | "format" | "drafts" | "storage" | "generic";

export function recoveryTip(errorKey: string | null): RecoveryTip | null;
```

Mapping:

- `backup.errors.wrongKey` -> `wrongKey`
- `backup.errors.invalidEncryption`, `invalidSummary`, `invalidBlob`,
  `checksumMismatch` -> `damaged`
- `backup.errors.invalidJson`, `invalidFormat`, `unsupportedVersion` ->
  `format`
- `backup.draftClearFailed` -> `drafts`
- `privacy.errors.*` storage-related codes -> `storage`
- any other backup or data-control error -> `generic`

### 11.2 UI

Add `RecoveryGuide` to `BackupPanel`. It renders when a restore error or draft
clear warning exists.

It shows:

- a specific tip for the current error,
- the invariant that nothing is replaced until the user confirms,
- the next actions: try another copy, check the key, free storage, or clear site
  data when drafts cannot be cleared,
- a link to `/privacy` for storage diagnostics.

The guide does not attempt automatic cleanup. That remains Stage D.

## 12. Localization

Add complete `en` and `id` catalogs for:

- note link actions, dialog, empty states, limits, and errors,
- Markdown export action and success state,
- library sort fields, directions, types, clear action, and filtered empty
  state,
- backup last-backup status, reminder copy, and settings link,
- storage diagnostics labels, persistence actions, and outcomes,
- recovery tips and next actions.

The `id` catalog is typed against `en`, so missing keys fail type checking.

## 13. Accessibility and responsive behavior

- All new selects have visible labels or `sr-only` labels.
- Checkbox rows in the link dialog are keyboard reachable and show focus.
- The link dialog traps focus through the existing `Dialog` primitive.
- Linked-note links use real anchors and keep a visible focus ring.
- The dashboard reminder is a normal card with heading and link, not a toast.
- The library filter row wraps on narrow screens and keeps 44px touch targets.
- The persistence action has a busy state and a status message.
- Error and success messages use `role="alert"` and `role="status"` as the
  existing components do.

## 14. Testing

### 14.1 Unit tests

- Note Markdown file name sanitization, fallback, length, and document shape.
- Backup reminder read, write, invalid value, recent, due, never, and clock
  behavior.
- Recovery error mapping.
- Library MIME mapping.

### 14.2 Component tests

- `NoteLinksDialog`: search filters notes, selecting and saving calls the
  service, and self is excluded.
- Note editor: linked notes render, edit action opens the dialog, and export
  downloads the current title and content.
- `LibraryBrowser`: sort and type changes produce the expected query result.
  At minimum, test the rendered order and the filtered empty state with seeded
  memory storage.
- `BackupPanel`: a successful export writes the timestamp and shows the last
  backup status.
- `PrivacyCenter` or `StorageDiagnostics`: supported, unsupported, persisted,
  and denied request states render truthfully.
- `RecoveryGuide`: known error keys show the right tip and generic errors show
  the fallback.

### 14.3 Existing gates

Run:

- `npm run lint`
- `npm run format:check`
- `npm run typecheck`
- `npm test`
- `npm run build`

Run the relevant Playwright journey when a browser is available. If the E2E
journey cannot run on this machine, report that explicitly instead of claiming
it passed.

## 15. Documentation updates

In the same change:

- Update `ROADMAP.md`:
  - mark note links, Markdown export, library sort/filter, backup reminders,
    diagnostics, and recovery guidance as delivered,
  - change the deferred items and the PRD Gap Register decision column,
  - keep Stage D interrupted-restore cleanup open.
- Update `PRD.md` status only if the Stage C acceptance statement changes.
- Update `CHANGELOG.md`.
- Update `README.md` only if the feature list changes.
- Record the deferrals with owner and reason.

## 16. Milestones

### M1: Knowledge Hub slice

- Note link dialog and linked-note list.
- Markdown export helper and action.
- Localization.
- Unit and component tests.

### M2: Library controls

- Sort and direction controls.
- Type filter and clear action.
- Filtered empty state.
- Tests.

### M3: Recovery slice

- Backup timestamp and panel status.
- Dashboard reminder.
- Storage diagnostics and persistence request.
- Recovery guide.
- Tests.

### M4: Closeout

- ROADMAP, gap register, changelog, and status updates.
- Full quality gates.
- Final report of limitations and deferrals.

## 17. Risks and limitations

- Note links are outgoing only. Users who want reciprocal links must add them on
  both notes until backlinks exist.
- The link picker loads at most 500 notes. The UI must disclose that limit.
- Markdown export has no frontmatter and no tag metadata.
- The backup timestamp is device-local. Clearing site data clears the reminder.
- `navigator.storage.estimate()` includes all origin data, not only OpenNest.
- Persistent storage reduces eviction risk but does not survive the user clearing
  site data.
- Recovery guidance does not repair a damaged backup or clean up an interrupted
  restore.

## 18. Definition of done

- A user can link notes, see linked notes, and export a note as Markdown.
- A user can sort and filter the library.
- A user can see the last backup, receive a reminder, inspect storage pressure,
  request persistent storage, and read contextual restore guidance.
- Deferred items are recorded with an owner and reason in `ROADMAP.md`.
- All user-facing text exists in English and Indonesian.
- Lint, format, typecheck, tests, and build pass.
- Any unrun E2E check is reported honestly.
