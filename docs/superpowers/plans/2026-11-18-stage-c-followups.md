# Stage C Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the Stage C follow-ups by delivering note links, Markdown export, library sort/filter, backup reminders, storage diagnostics, and restore guidance, while recording explicit deferrals for the larger items.

**Architecture:** UI slices build on existing services and storage. Note links use `NoteService.setLinks` and `NoteService.links`; Markdown export is a pure helper plus the existing download utility; library controls pass existing `SortField` and `FileFilter.mimeTypes`; recovery features are web-only helpers and cards around the existing backup and privacy flows. No core storage schema changes.

**Tech Stack:** Next.js 16, React 19, TypeScript strict, Tailwind CSS, `@opennest/core`, `@opennest/localization`, `@opennest/ui`, Vitest, React DOM test harness.

**Spec:** `docs/superpowers/specs/2026-11-18-stage-c-followups-design.md`

## Global Constraints

- Termux/Android workspace. Do not add native dependencies or new runtime packages.
- Do not commit unless the user explicitly asks. Use checkpoints instead of commit steps.
- Every user-facing string must exist in both `packages/localization/src/en.ts` and `packages/localization/src/id.ts`.
- Note links are outgoing only. File-note links and backlinks are deferred.
- The note picker loads at most 500 notes. Disclose the limit when `total` exceeds the loaded rows.
- The backup reminder threshold is 14 days. The timestamp key is `opennest:backup:last-export`.
- `navigator.storage` diagnostics are origin-wide, not OpenNest-only.
- Automatic interrupted-restore cleanup is Stage D work and must not be implemented here.
- Follow the existing component and test patterns. Do not add code comments.
- Run targeted tests after every task. Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, and `npm run build` in the closeout task.

## Review Focus

- Exporting a note with an empty title or path-like characters must produce a safe `.md` file name and a readable `Untitled note` heading.
- A workspace with more than 500 notes must not silently imply the link picker is complete; the limit notice must appear.
- `localStorage` that throws, holds invalid data, or is cleared must not break backup export; the reminder degrades to `Never`.
- `navigator.storage` that is missing, rejects `estimate()`, or denies `persist()` must render unsupported or unknown states without breaking the Privacy Center.
- A restore failure for a wrong key, damaged file, or draft-clear warning must show the matching recovery tip and must not claim that data was replaced.
- A library filter with no matches must show a filter-specific empty state with a clear action, not the empty-folder state.

---

### Task 1: Markdown export helpers and download MIME

**Files:**

- Modify: `apps/web/lib/notes.ts`
- Modify: `apps/web/lib/data/backup.ts`
- Test: `apps/web/lib/__tests__/notes.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces:
  - `noteMarkdownFileName(title: string): string`
  - `noteMarkdownDocument(title: string, content: string): string`
  - `downloadTextFile(fileName: string, text: string, mimeType?: string): void`

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/lib/__tests__/notes.test.ts`:

```ts
import { noteMarkdownDocument, noteMarkdownFileName } from "../notes";

describe("noteMarkdownFileName", () => {
  it("sanitizes path characters and keeps a markdown extension", () => {
    expect(noteMarkdownFileName('../A:B? "C"|D*')).toBe("-A-B- -C--D-.md");
  });

  it("falls back to note.md for an empty title", () => {
    expect(noteMarkdownFileName("   ")).toBe("note.md");
  });

  it("limits the base name to 80 characters", () => {
    expect(noteMarkdownFileName("a".repeat(100))).toBe(`${"a".repeat(80)}.md`);
  });
});

describe("noteMarkdownDocument", () => {
  it("uses the title as a heading and preserves the content", () => {
    expect(noteMarkdownDocument("Shopping", "- milk\n- eggs")).toBe(
      "# Shopping\n\n- milk\n- eggs\n"
    );
  });

  it("uses a readable heading for an empty title", () => {
    expect(noteMarkdownDocument("", "body")).toBe("# Untitled note\n\nbody\n");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/vitest.mjs run apps/web/lib/__tests__/notes.test.ts`

Expected: FAIL because `noteMarkdownFileName` and `noteMarkdownDocument` are not exported.

- [ ] **Step 3: Implement the helpers**

In `apps/web/lib/notes.ts`, add:

```ts
const markdownFileNameLimit = 80;
const markdownReserved = /[<>:"/\\|?*\u0000-\u001f]/g;

export function noteMarkdownFileName(title: string): string {
  const base = title
    .trim()
    .replace(/^\.+/, "")
    .replace(markdownReserved, "-")
    .replace(/\s+/g, " ")
    .slice(0, markdownFileNameLimit)
    .trim();

  return `${base.length === 0 ? "note" : base}.md`;
}

export function noteMarkdownDocument(title: string, content: string): string {
  const heading = title.trim().length === 0 ? "Untitled note" : title.trim();

  return `# ${heading}\n\n${content}\n`;
}
```

In `apps/web/lib/data/backup.ts`, change the existing function signature to accept an optional MIME type and use it:

```ts
export function downloadTextFile(
  fileName: string,
  text: string,
  mimeType = "application/json"
): void {
  const blob = new Blob([text], { type: mimeType });
```

Keep the rest of the function unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node scripts/vitest.mjs run apps/web/lib/__tests__/notes.test.ts`

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run: `node scripts/prettier.mjs --check apps/web/lib/notes.ts apps/web/lib/data/backup.ts apps/web/lib/__tests__/notes.test.ts`

Expected: all files use Prettier style. Do not commit.

---

### Task 2: Note links dialog

**Files:**

- Create: `apps/web/components/note-links-dialog.tsx`
- Create: `apps/web/components/__tests__/note-links-dialog.test.tsx`
- Modify: `packages/localization/src/en.ts`
- Modify: `packages/localization/src/id.ts`

**Interfaces:**

- Consumes:
  - `Note`, `NoteId` from `@opennest/core`
  - `useTranslations` from `@opennest/localization`
  - `Button`, `Dialog`, `Input` from `@opennest/ui`
  - `errorKey` from `@/lib/errors`
- Produces:
  - `NoteLinksDialog` component
  - `NoteLinksDialogProps` with `notes`, `notesTotal`, `selected`, `currentNoteId`, `onSave`, `onClose`

- [ ] **Step 1: Add the translation keys**

Add to the `notes` object in `packages/localization/src/en.ts`:

```ts
linkedNotes: "Linked notes",
noLinkedNotes: "No linked notes yet.",
editLinks: "Edit links",
linkDialogTitle: "Link notes",
linkDialogDescription: "Choose notes to connect to this note.",
linkSearch: "Search notes",
linkEmpty: "No other notes yet.",
linkLimit: "Showing the 500 most recent notes. Type to narrow the list.",
linkUnavailable: "This linked note is unavailable.",
exportMarkdown: "Export Markdown",
exportSuccess: "Markdown file downloaded.",
exportError: "The note could not be exported. Try again.",
```

Add the same keys to `packages/localization/src/id.ts`:

```ts
linkedNotes: "Catatan tertaut",
noLinkedNotes: "Belum ada catatan tertaut.",
editLinks: "Ubah tautan",
linkDialogTitle: "Tautkan catatan",
linkDialogDescription: "Pilih catatan yang terhubung dengan catatan ini.",
linkSearch: "Cari catatan",
linkEmpty: "Belum ada catatan lain.",
linkLimit: "Menampilkan 500 catatan terbaru. Ketik untuk mempersempit daftar.",
linkUnavailable: "Catatan tertaut ini tidak tersedia.",
exportMarkdown: "Ekspor Markdown",
exportSuccess: "Berkas Markdown diunduh.",
exportError: "Catatan tidak bisa diekspor. Coba lagi.",
```

- [ ] **Step 2: Write the failing component test**

Create `apps/web/components/__tests__/note-links-dialog.test.tsx` with a `LocaleProvider` wrapper and three notes. The test must:

- render the dialog with `currentNoteId` set to the first note,
- assert the current note is not listed,
- type a query that matches only the third note and assert only that note remains,
- check the third note, click `Save`, and assert `onSave` receives only the third note id.

Use the same `act`, `createRoot`, and DOM query style as `apps/web/components/__tests__/tag-dialog.test.tsx` if present, otherwise the style in `apps/web/components/__tests__/note-editor.test.tsx`.

Run: `node scripts/vitest.mjs run apps/web/components/__tests__/note-links-dialog.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement `NoteLinksDialog`**

Create `apps/web/components/note-links-dialog.tsx` with:

```ts
"use client";

export interface NoteLinksDialogProps {
  notes: readonly Note[];
  notesTotal: number;
  selected: readonly NoteId[];
  currentNoteId: NoteId;
  onSave: (noteIds: NoteId[]) => Promise<void>;
  onClose: () => void;
}
```

Behavior:

- Keep `chosen` as `Set<string>` initialized from `selected`.
- Keep `query` state.
- Filter `notes` by title or content, case-insensitive, after excluding `currentNoteId`.
- Render a labeled search input with placeholder `t("notes.linkSearch")`.
- Render each note as a checkbox row with its title and updated date.
- Render `t("notes.linkEmpty")` when there are no other notes.
- Render `t("notes.linkLimit")` when `notesTotal > notes.length`.
- Save calls `onSave([...chosen] as NoteId[])` and closes on success.
- On failure, show `t(errorKey(caught))` with `role="alert"`.
- Disable controls while busy.
- Use `common.cancel`, `common.save`, and `common.loading` existing keys.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/vitest.mjs run apps/web/components/__tests__/note-links-dialog.test.tsx`

Expected: PASS.

- [ ] **Step 5: Add the limit test**

Add a test that passes 3 loaded notes but `notesTotal: 700` and asserts the text `Showing the 500 most recent notes. Type to narrow the list.` is present.

Run: `node scripts/vitest.mjs run apps/web/components/__tests__/note-links-dialog.test.tsx`

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Run: `node scripts/prettier.mjs --check apps/web/components/note-links-dialog.tsx apps/web/components/__tests__/note-links-dialog.test.tsx packages/localization/src/en.ts packages/localization/src/id.ts`

Expected: all files use Prettier style. Do not commit.

---

### Task 3: Note editor links and Markdown export

**Files:**

- Modify: `apps/web/components/note-editor.tsx`
- Modify: `apps/web/components/__tests__/note-editor.test.tsx`
- Modify: `packages/localization/src/en.ts`
- Modify: `packages/localization/src/id.ts`

**Interfaces:**

- Consumes:
  - `NoteLinksDialog` from Task 2
  - `noteMarkdownDocument`, `noteMarkdownFileName` from Task 1
  - `downloadTextFile` from `@/lib/data/backup`
  - `services.note.links(id)` and `services.note.setLinks(id, ids)`
- Produces:
  - `NoteEditorForm` accepts `linkedNotes`, `allNotes`, and `notesTotal`
  - Note editor renders a linked-notes section and an export action

- [ ] **Step 1: Extend the editor test seed**

In `apps/web/components/__tests__/note-editor.test.tsx`, add a second test that seeds two notes, mounts the editor for the first note, and waits for the editor text area. The test must:

- click the `Links` button,
- wait for the link dialog,
- check the second note,
- click `Save`,
- assert the linked note title appears in the editor.

Run: `node scripts/vitest.mjs run apps/web/components/__tests__/note-editor.test.tsx`

Expected: FAIL because the `Links` button and linked-notes section do not exist.

- [ ] **Step 2: Extend the note loader**

In `NoteEditor`, add `links` and a note page to the existing `Promise.all`:

```ts
services.note.links(note.id),
services.note.list(workspace.id, {}, { limit: 500, sort: "updatedAt", direction: "desc" }),
```

Resolve linked targets with `services.note.get` for each `targetNoteId`, filtering out `null`. Return `linkedNotes`, `allNotes: notes.items`, and `notesTotal: notes.total`.

Pass them to `NoteEditorForm`.

- [ ] **Step 3: Add editor state and actions**

In `NoteEditorForm`:

- Add `linksOpen` and `actionSuccess` state.
- Add `linkedNotes: Note[]`, `allNotes: Note[]`, and `notesTotal: number` props.
- Add `saveLinks(noteIds: NoteId[])` that calls `services.note.setLinks(note.id, noteIds)` and `invalidate()`.
- Add `exportMarkdown()` that calls `downloadTextFile(noteMarkdownFileName(title), noteMarkdownDocument(title, content), "text/markdown")`, sets `actionSuccess` to `notes.exportSuccess`, and sets `notes.exportError` on throw.
- Add a `Links` secondary button that opens the dialog.
- Add an `Export Markdown` secondary button.
- Render `actionSuccess` with `role="status"` near `actionError`.
- Render the linked-notes section below the tag list:
  - heading `notes.linkedNotes`,
  - link rows to `/notes/{id}` with the note title,
  - `notes.noLinkedNotes` when empty,
  - `Edit links` action.
- Render `NoteLinksDialog` when `linksOpen` is true.

- [ ] **Step 4: Run the link test**

Run: `node scripts/vitest.mjs run apps/web/components/__tests__/note-editor.test.tsx`

Expected: PASS.

- [ ] **Step 5: Add the export test**

Add a test that mocks `URL.createObjectURL` and `URL.revokeObjectURL`, spies on `HTMLAnchorElement.prototype.click`, changes the title to `Trip: Day 1`, clicks `Export Markdown`, and asserts the anchor download is `Trip- Day 1.md`.

Run: `node scripts/vitest.mjs run apps/web/components/__tests__/note-editor.test.tsx`

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Run: `node scripts/prettier.mjs --check apps/web/components/note-editor.tsx apps/web/components/__tests__/note-editor.test.tsx packages/localization/src/en.ts packages/localization/src/id.ts`

Expected: all files use Prettier style. Do not commit.

---

### Task 4: Library sort and type filter

**Files:**

- Create: `apps/web/lib/library.ts`
- Create: `apps/web/lib/__tests__/library.test.ts`
- Create: `apps/web/components/__tests__/library-browser.test.tsx`
- Modify: `apps/web/components/library-browser.tsx`
- Modify: `packages/localization/src/en.ts`
- Modify: `packages/localization/src/id.ts`

**Interfaces:**

- Consumes:
  - `SortField` from `@opennest/core`
  - `FileFilter.mimeTypes`
  - `limits.allowedMimeTypes`
- Produces:
  - `LibraryFileType = "all" | "documents" | "images"`
  - `libraryTypeMimeTypes(type: LibraryFileType): readonly string[] | undefined`

- [ ] **Step 1: Write the failing helper tests**

Create `apps/web/lib/__tests__/library.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { libraryTypeMimeTypes } from "../library";

describe("libraryTypeMimeTypes", () => {
  it("returns no filter for all files", () => {
    expect(libraryTypeMimeTypes("all")).toBeUndefined();
  });

  it("returns document MIME types", () => {
    expect(libraryTypeMimeTypes("documents")).toEqual([
      "application/pdf",
      "text/plain",
      "text/markdown",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]);
  });

  it("returns image MIME types", () => {
    expect(libraryTypeMimeTypes("images")).toEqual([
      "image/png",
      "image/jpeg",
      "image/webp",
    ]);
  });
});
```

Run: `node scripts/vitest.mjs run apps/web/lib/__tests__/library.test.ts`

Expected: FAIL because `apps/web/lib/library.ts` does not exist.

- [ ] **Step 2: Implement the helper**

Create `apps/web/lib/library.ts` with the `LibraryFileType` union and a frozen MIME map. Return `undefined` for `all`.

Run: `node scripts/vitest.mjs run apps/web/lib/__tests__/library.test.ts`

Expected: PASS.

- [ ] **Step 3: Add localization keys**

Add to `library` in both catalogs:

```ts
sortLabel: "Sort by",
sortName: "Name",
sortCreated: "Date added",
sortUpdated: "Last updated",
directionLabel: "Direction",
ascending: "Ascending",
descending: "Descending",
typeLabel: "Type",
allTypes: "All files",
documents: "Documents",
images: "Images",
clearFilters: "Clear filters",
filteredEmptyTitle: "No files match these filters",
filteredEmptyBody: "Change the type filter or clear it to see the files in this folder.",
```

Indonesian values:

```ts
sortLabel: "Urutkan berdasarkan",
sortName: "Nama",
sortCreated: "Tanggal ditambahkan",
sortUpdated: "Terakhir diperbarui",
directionLabel: "Arah",
ascending: "Naik",
descending: "Turun",
typeLabel: "Tipe",
allTypes: "Semua berkas",
documents: "Dokumen",
images: "Gambar",
clearFilters: "Hapus filter",
filteredEmptyTitle: "Tidak ada berkas yang cocok",
filteredEmptyBody: "Ubah atau hapus filter tipe untuk melihat berkas di folder ini.",
```

- [ ] **Step 4: Write the failing library component test**

Create `apps/web/components/__tests__/library-browser.test.tsx` using the `AppDataProvider` pattern from `note-editor.test.tsx`. Seed two files with `services.file.upload`:

- `alpha.md` with `Uint8Array.from([1])` and `text/markdown`,
- `beta.png` with `Uint8Array.from([2])` and `image/png`.

Mount `LibraryBrowser` with `folderId={null}`. The test must:

- wait for both file names,
- change the sort select to `Name` and direction to `Ascending`, then assert `alpha.md` appears before `beta.png` in the file list,
- change the type select to `Images` and assert only `beta.png` is shown,
- change the type select to `Documents`, assert `alpha.md` is shown and `beta.png` is absent.

Add a second test that seeds only `alpha.md`, filters to `Images`, and asserts the filtered empty state and `Clear filters` action.

Run: `node scripts/vitest.mjs run apps/web/components/__tests__/library-browser.test.tsx`

Expected: FAIL because the controls do not exist.

- [ ] **Step 5: Implement the library controls**

In `LibraryBrowser`:

- Add `sort`, `direction`, and `type` state with defaults `updatedAt`, `desc`, and `all`.
- Include them in the `useAsyncData` key.
- Pass `libraryTypeMimeTypes(type)` as `mimeTypes` only when defined.
- Pass `sort` and `direction` to `services.file.list`.
- Add a responsive filter row with three labeled `Select` controls.
- Reset `limit` to `PAGE_STEP` when any control changes.
- Show `library.filteredEmptyTitle` and `library.filteredEmptyBody` when the type filter is active and the result is empty.
- Show a `Clear filters` button that resets the type to `all` and the limit to `PAGE_STEP`.

- [ ] **Step 6: Run the component test**

Run: `node scripts/vitest.mjs run apps/web/components/__tests__/library-browser.test.tsx`

Expected: PASS.

- [ ] **Step 7: Checkpoint**

Run: `node scripts/prettier.mjs --check apps/web/lib/library.ts apps/web/lib/__tests__/library.test.ts apps/web/components/library-browser.tsx apps/web/components/__tests__/library-browser.test.tsx packages/localization/src/en.ts packages/localization/src/id.ts`

Expected: all files use Prettier style. Do not commit.

---

### Task 5: Backup reminder helper and panel status

**Files:**

- Create: `apps/web/lib/data/backup-reminder.ts`
- Create: `apps/web/lib/data/__tests__/backup-reminder.test.ts`
- Modify: `apps/web/components/backup-panel.tsx`
- Modify: `apps/web/components/__tests__/backup-panel.test.tsx`
- Modify: `apps/web/components/privacy-center.tsx`
- Modify: `packages/localization/src/en.ts`
- Modify: `packages/localization/src/id.ts`

**Interfaces:**

- Consumes: `formatCalendarDate` from `@/lib/format`
- Produces:
  - `BACKUP_REMINDER_DAYS = 14`
  - `BackupReminderStatus`
  - `readLastBackupAt(storage?: Pick<Storage, "getItem"> | null): string | null`
  - `recordBackupExported(at?: Date, storage?: Pick<Storage, "setItem"> | null): string | null`
  - `clearBackupRecord(storage?: Pick<Storage, "removeItem"> | null): void`
  - `backupReminderStatus(lastBackupAt: string | null, now?: Date): BackupReminderStatus`

- [ ] **Step 1: Write the failing helper tests**

Create `apps/web/lib/data/__tests__/backup-reminder.test.ts` with an in-memory storage double. Test:

- `readLastBackupAt` returns a stored ISO string,
- an invalid timestamp returns `null`,
- a throwing `getItem` returns `null`,
- `recordBackupExported` stores the ISO string,
- a throwing `setItem` returns `null`,
- `backupReminderStatus(null)` is due and never,
- 13 days ago is not due,
- 14 days ago is due,
- a future timestamp has `daysSince: 0`.

Run: `node scripts/vitest.mjs run apps/web/lib/data/__tests__/backup-reminder.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement the helper**

Use the key `opennest:backup:last-export`. Guard every storage call with `try/catch`. Treat an unparsable date as missing. Use `Math.floor` and clamp to `0`.

Run: `node scripts/vitest.mjs run apps/web/lib/data/__tests__/backup-reminder.test.ts`

Expected: PASS.

- [ ] **Step 3: Add localization keys**

Add to `backup` in both catalogs:

```ts
lastBackup: "Last backup",
neverBackedUp: "Never",
```

Indonesian:

```ts
lastBackup: "Backup terakhir",
neverBackedUp: "Belum pernah",
```

- [ ] **Step 4: Write the failing panel test**

In `apps/web/components/__tests__/backup-panel.test.tsx`, extend the first export test after success:

```ts
expect(window.localStorage.getItem("opennest:backup:last-export")).toMatch(
  /^\d{4}-\d{2}-\d{2}T/
);
expect(mounted.container.textContent).toContain("Last backup");
```

Run: `node scripts/vitest.mjs run apps/web/components/__tests__/backup-panel.test.tsx`

Expected: FAIL because the panel does not record or show the timestamp.

- [ ] **Step 5: Integrate the helper**

In `BackupPanel`:

- import `formatCalendarDate`, `readLastBackupAt`, `recordBackupExported`,
- add `lastBackupAt` state and a mount effect that reads it,
- set state from `recordBackupExported()` in `onExported`,
- add `id="backup"` and `scroll-mt-24` to the section,
- render a muted `Last backup` line with `formatCalendarDate(locale, lastBackupAt)` or `backup.neverBackedUp`.

In `PrivacyCenter`, call `recordBackupExported()` in its `onExported` callback before reloading.

Run: `node scripts/vitest.mjs run apps/web/components/__tests__/backup-panel.test.tsx`

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Run: `node scripts/prettier.mjs --check apps/web/lib/data/backup-reminder.ts apps/web/lib/data/__tests__/backup-reminder.test.ts apps/web/components/backup-panel.tsx apps/web/components/privacy-center.tsx apps/web/components/__tests__/backup-panel.test.tsx packages/localization/src/en.ts packages/localization/src/id.ts`

Expected: all files use Prettier style. Do not commit.

---

### Task 6: Dashboard backup reminder

**Files:**

- Create: `apps/web/components/backup-reminder.tsx`
- Create: `apps/web/components/__tests__/backup-reminder.test.tsx`
- Modify: `apps/web/components/dashboard.tsx`
- Modify: `packages/localization/src/en.ts`
- Modify: `packages/localization/src/id.ts`

**Interfaces:**

- Consumes:
  - `backupReminderStatus`, `readLastBackupAt` from Task 5
  - `formatCalendarDate` from `@/lib/format`
- Produces: `BackupReminder` component with `{ lastBackupAt: string | null; now?: Date }`

- [ ] **Step 1: Add localization keys**

Add to `backup` in both catalogs:

```ts
reminder: {
  neverTitle: "Back up your library",
  neverBody:
    "This library has not been backed up yet. A local copy is not a backup.",
  dueTitle: "Your backup is out of date",
  dueBody: "Create a fresh backup so a device problem does not take your library with it.",
  action: "Open backup settings",
},
```

Indonesian:

```ts
reminder: {
  neverTitle: "Cadangkan perpustakaanku",
  neverBody:
    "Perpustakaan ini belum pernah dicadangkan. Salinan lokal bukan backup.",
  dueTitle: "Backup kamu sudah lama",
  dueBody:
    "Buat backup baru supaya masalah perangkat tidak menghilangkan perpustakaanku.",
  action: "Buka pengaturan backup",
},
```

- [ ] **Step 2: Write the failing component tests**

Create `apps/web/components/__tests__/backup-reminder.test.tsx` with `LocaleProvider`. Test:

- `lastBackupAt={null}` renders the never title and the settings link,
- a timestamp 30 days before `now` renders the due title and the formatted date,
- a timestamp 1 day before `now` renders nothing.

Run: `node scripts/vitest.mjs run apps/web/components/__tests__/backup-reminder.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement `BackupReminder`**

Render a `Card` only when `backupReminderStatus(lastBackupAt, now).due`. Use a heading, body text, optional last-backup line, and a `Link` to `/settings#backup`.

- [ ] **Step 4: Integrate into the dashboard**

In `Dashboard`, add `lastBackupAt: readLastBackupAt()` to the async loader result. Render `<BackupReminder lastBackupAt={data.lastBackupAt} />` after the stats section when `!isEmpty`.

Run: `node scripts/vitest.mjs run apps/web/components/__tests__/backup-reminder.test.tsx`

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run: `node scripts/prettier.mjs --check apps/web/components/backup-reminder.tsx apps/web/components/__tests__/backup-reminder.test.tsx apps/web/components/dashboard.tsx packages/localization/src/en.ts packages/localization/src/id.ts`

Expected: all files use Prettier style. Do not commit.

---

### Task 7: Storage status and diagnostics card

**Files:**

- Create: `apps/web/lib/privacy/storage-status.ts`
- Create: `apps/web/lib/privacy/__tests__/storage-status.test.ts`
- Create: `apps/web/components/storage-diagnostics.tsx`
- Create: `apps/web/components/__tests__/storage-diagnostics.test.tsx`
- Modify: `packages/localization/src/en.ts`
- Modify: `packages/localization/src/id.ts`

**Interfaces:**

- Consumes: `formatBytes` from `@/lib/format`
- Produces:
  - `StorageStatus { supported, usage, quota, persisted }`
  - `readStorageStatus(): Promise<StorageStatus>`
  - `requestPersistentStorage(): Promise<"granted" | "denied" | "unsupported">`
  - `StorageDiagnostics` with `{ status, busy, onRequestPersist }`

- [ ] **Step 1: Write the failing storage helper tests**

Create `apps/web/lib/privacy/__tests__/storage-status.test.ts`. Use `Object.defineProperty(window.navigator, "storage", ...)` and restore it after each test. Test:

- missing `navigator.storage` returns `{ supported: false, usage: null, quota: null, persisted: null }`,
- valid `estimate` and `persisted` values are returned,
- a rejecting `estimate` leaves `usage` and `quota` null,
- a rejecting `persisted` leaves `persisted` null,
- `persist()` true returns `granted`,
- `persist()` false returns `denied`,
- missing `persist` returns `unsupported`.

Run: `node scripts/vitest.mjs run apps/web/lib/privacy/__tests__/storage-status.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement the storage helper**

Use optional chaining and `try/catch`. Do not throw on unsupported APIs.

Run: `node scripts/vitest.mjs run apps/web/lib/privacy/__tests__/storage-status.test.ts`

Expected: PASS.

- [ ] **Step 3: Add localization keys**

Add to `privacy` in both catalogs:

```ts
storage: {
  title: "Browser storage",
  description:
    "This estimate covers this site in your browser, not only OpenNest.",
  unsupported: "This browser does not report storage diagnostics.",
  usage: "Used",
  quota: "Quota",
  percent: "Used",
  persisted: "Persistent storage",
  granted: "Granted",
  denied: "Not granted",
  unknown: "Unknown",
  request: "Keep this data",
  requestGranted: "The browser marked this site's data as persistent.",
  requestDenied: "The browser did not grant persistent storage. Keep a backup.",
  requestError: "The browser could not change persistence. Try again.",
  notice:
    "Persistent storage reduces eviction risk, but it does not survive clearing site data. It is not a backup.",
},
```

Indonesian:

```ts
storage: {
  title: "Penyimpanan browser",
  description:
    "Perkiraan ini mencakup situs ini di browser, bukan hanya OpenNest.",
  unsupported: "Browser ini tidak melaporkan diagnostik penyimpanan.",
  usage: "Terpakai",
  quota: "Kuota",
  percent: "Terpakai",
  persisted: "Penyimpanan persisten",
  granted: "Diberikan",
  denied: "Belum diberikan",
  unknown: "Tidak diketahui",
  request: "Pertahankan data ini",
  requestGranted: "Browser menandai data situs ini sebagai persisten.",
  requestDenied: "Browser tidak memberikan penyimpanan persisten. Simpan backup.",
  requestError: "Browser tidak bisa mengubah status persisten. Coba lagi.",
  notice:
    "Penyimpanan persisten mengurangi risiko eviction, tetapi tetap hilang jika data situs dibersihkan. Ini bukan backup.",
},
```

- [ ] **Step 4: Write the failing component tests**

Create `apps/web/components/__tests__/storage-diagnostics.test.tsx` with `LocaleProvider`. Test:

- supported status with `usage: 1536`, `quota: 2 * 1024 * 1024`, `persisted: false` shows `1.5 KB`, `2 MB`, `Not granted`, and a request button,
- clicking the request button calls `onRequestPersist`,
- `{ supported: false }` shows the unsupported message and no request button.

Run: `node scripts/vitest.mjs run apps/web/components/__tests__/storage-diagnostics.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 5: Implement `StorageDiagnostics`**

Render a `Card` with a heading, description, a definition list, a percentage when quota is positive, the persistence status, the request button when supported and not granted, and the notice.

Do not show a percentage when quota is null or zero.

Run: `node scripts/vitest.mjs run apps/web/components/__tests__/storage-diagnostics.test.tsx`

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Run: `node scripts/prettier.mjs --check apps/web/lib/privacy/storage-status.ts apps/web/lib/privacy/__tests__/storage-status.test.ts apps/web/components/storage-diagnostics.tsx apps/web/components/__tests__/storage-diagnostics.test.tsx packages/localization/src/en.ts packages/localization/src/id.ts`

Expected: all files use Prettier style. Do not commit.

---

### Task 8: Privacy Center diagnostics and persistence action

**Files:**

- Modify: `apps/web/components/privacy-center.tsx`
- Modify: `apps/web/components/__tests__/privacy-center.test.tsx`
- Modify: `packages/localization/src/en.ts`
- Modify: `packages/localization/src/id.ts`

**Interfaces:**

- Consumes:
  - `readStorageStatus`, `requestPersistentStorage` from Task 7
  - `StorageDiagnostics` from Task 7
- Produces: Privacy Center renders storage diagnostics and handles persistence requests

- [ ] **Step 1: Write the failing Privacy Center test**

Add a test to `apps/web/components/__tests__/privacy-center.test.tsx`:

- define `window.navigator.storage` with `estimate` returning `{ usage: 1536, quota: 2097152 }`, `persisted` returning `false`, and `persist` returning `false`,
- mount `PrivacyCenter`,
- wait for `Browser storage`,
- assert `Not granted` is present,
- click `Keep this data`,
- assert `The browser did not grant persistent storage. Keep a backup.` appears,
- restore the original navigator property after the test.

Run: `node scripts/vitest.mjs run apps/web/components/__tests__/privacy-center.test.tsx`

Expected: FAIL because the diagnostics card and action do not exist.

- [ ] **Step 2: Load storage status**

In `PrivacyCenter`, add `storage: await readStorageStatus()` to the `Promise.all` result.

- [ ] **Step 3: Add the persistence action**

- Extend the local `Action` type with `"persist"`.
- Add `requestPersist()`:
  - set `action` to `"persist"`,
  - clear action messages,
  - call `requestPersistentStorage()`,
  - set `privacy.storage.requestGranted`, `requestDenied`, or `requestError` based on the result,
  - call `state.reload()` for granted and denied results,
  - reset `action` in `finally`.
- Render `<StorageDiagnostics status={storage} busy={action === "persist"} onRequestPersist={() => void requestPersist()} />` below `PrivacyOverview`.

- [ ] **Step 4: Resolve translation fallbacks**

If the test uses a denied message key, ensure the existing `actionSuccess`/`actionError` rendering can display it. Keep the existing message placement.

Run: `node scripts/vitest.mjs run apps/web/components/__tests__/privacy-center.test.tsx`

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run: `node scripts/prettier.mjs --check apps/web/components/privacy-center.tsx apps/web/components/__tests__/privacy-center.test.tsx packages/localization/src/en.ts packages/localization/src/id.ts`

Expected: all files use Prettier style. Do not commit.

---

### Task 9: Restore recovery guidance

**Files:**

- Create: `apps/web/lib/data/recovery.ts`
- Create: `apps/web/lib/data/__tests__/recovery.test.ts`
- Create: `apps/web/components/recovery-guide.tsx`
- Create: `apps/web/components/__tests__/recovery-guide.test.tsx`
- Modify: `apps/web/components/backup-panel.tsx`
- Modify: `packages/localization/src/en.ts`
- Modify: `packages/localization/src/id.ts`

**Interfaces:**

- Consumes: existing backup error keys and draft warning key
- Produces:
  - `RecoveryTip`
  - `recoveryTip(errorKey: string | null): RecoveryTip | null`
  - `RecoveryGuide` with `{ error: string | null }`

- [ ] **Step 1: Write the failing mapping tests**

Create `apps/web/lib/data/__tests__/recovery.test.ts`. Test:

- `backup.errors.wrongKey` -> `wrongKey`,
- `backup.errors.checksumMismatch` -> `damaged`,
- `backup.errors.invalidFormat` -> `format`,
- `backup.draftClearFailed` -> `drafts`,
- `privacy.errors.storage_failed` -> `storage`,
- `backup.errors.exportFailed` -> `generic`,
- `null` -> `null`.

Run: `node scripts/vitest.mjs run apps/web/lib/data/__tests__/recovery.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement the mapping**

Use explicit key sets. Do not use a broad prefix match that maps every privacy error to storage. Only map the storage-related codes that exist in the privacy error catalog. Return `generic` for any other non-null key.

Run: `node scripts/vitest.mjs run apps/web/lib/data/__tests__/recovery.test.ts`

Expected: PASS.

- [ ] **Step 3: Add localization keys**

Add to `backup.recovery` in both catalogs:

```ts
title: "If restore fails",
intro: "Nothing is replaced until you confirm the restore. Work through these steps.",
wrongKey: "Check the passphrase or backup key. It must match the backup you chose.",
damaged: "This backup is damaged. Try another copy or an older backup.",
format: "This file is not a backup OpenNest can read. Choose a backup created by OpenNest.",
drafts: "Drafts could not be cleared. Clear this site's storage, then restore again.",
storage: "Storage may be full or unavailable. Free space or export current data, then retry.",
generic: "Try another backup copy and check that storage is available.",
tryAnother: "Try another backup file.",
checkKey: "Check the passphrase or backup key.",
freeSpace: "Free device storage before trying again.",
clearSiteData: "If drafts cannot be cleared, clear this site's storage in browser settings.",
diagnostics: "Open storage diagnostics",
```

Indonesian:

```ts
title: "Kalau restore gagal",
intro: "Data tidak diganti sampai kamu mengonfirmasi restore. Ikuti langkah ini.",
wrongKey: "Periksa passphrase atau kunci backup. Harus cocok dengan backup yang dipilih.",
damaged: "Backup ini rusak. Coba salinan lain atau backup yang lebih lama.",
format: "Berkas ini bukan backup yang bisa dibaca OpenNest. Pilih backup dari OpenNest.",
drafts: "Draf tidak bisa dibersihkan. Bersihkan penyimpanan situs ini, lalu restore lagi.",
storage: "Penyimpanan mungkin penuh atau tidak tersedia. Kosongkan ruang atau ekspor data saat ini, lalu coba lagi.",
generic: "Coba salinan backup lain dan pastikan penyimpanan tersedia.",
tryAnother: "Coba berkas backup lain.",
checkKey: "Periksa passphrase atau kunci backup.",
freeSpace: "Kosongkan penyimpanan perangkat sebelum mencoba lagi.",
clearSiteData: "Kalau draf tidak bisa dibersihkan, bersihkan penyimpanan situs ini di pengaturan browser.",
diagnostics: "Buka diagnostik penyimpanan",
```

- [ ] **Step 4: Write the failing component tests**

Create `apps/web/components/__tests__/recovery-guide.test.tsx` with `LocaleProvider`. Test:

- `error="backup.errors.wrongKey"` shows the wrong-key tip and the diagnostics link,
- an unknown key shows the generic tip,
- `error={null}` renders nothing.

Run: `node scripts/vitest.mjs run apps/web/components/__tests__/recovery-guide.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 5: Implement `RecoveryGuide`**

Use a `Card` with the title, intro, specific tip, three actionable steps, and a `Link` to `/privacy`. Return `null` when `error` is null or mapping returns null.

- [ ] **Step 6: Integrate into `BackupPanel`**

Render `<RecoveryGuide error={error ?? draftWarning} />` below the error and draft warning messages. Keep the existing restore flow unchanged.

- [ ] **Step 7: Run the tests**

Run: `node scripts/vitest.mjs run apps/web/lib/data/__tests__/recovery.test.ts apps/web/components/__tests__/recovery-guide.test.tsx apps/web/components/__tests__/backup-panel.test.tsx`

Expected: PASS.

- [ ] **Step 8: Checkpoint**

Run: `node scripts/prettier.mjs --check apps/web/lib/data/recovery.ts apps/web/lib/data/__tests__/recovery.test.ts apps/web/components/recovery-guide.tsx apps/web/components/__tests__/recovery-guide.test.tsx apps/web/components/backup-panel.tsx packages/localization/src/en.ts packages/localization/src/id.ts`

Expected: all files use Prettier style. Do not commit.

---

### Task 10: Documentation, gap register, and full gates

**Files:**

- Modify: `ROADMAP.md`
- Modify: `CHANGELOG.md`
- Modify: `PRD.md`
- Modify: `README.md`

**Interfaces:**

- Consumes: all delivered features from Tasks 1-9.
- Produces: accurate Stage C status and explicit deferrals.

- [ ] **Step 1: Update the Stage C checkboxes**

In `ROADMAP.md`:

- Mark note-note connections delivered. Keep file-note links open with a note that they are deferred.
- Mark the Knowledge Hub foundation delivered for note links, linked notes, and Markdown export.
- Mark persistence and quota diagnostics delivered.
- Mark backup reminders delivered.
- Mark guided recovery guidance delivered and keep interrupted-restore cleanup as a Stage D deferral.
- Change the Stage C status line to state that the stage is delivered, with the remaining PRD gaps explicitly deferred.
- Keep the Stage C completion criteria: every gap is delivered or explicitly deferred.

- [ ] **Step 2: Update the status headers**

- In `PRD.md`, change the header status to `MVP 0.1 implementation in progress; Stage C delivered; Stage D in progress`.
- In `README.md`, update the English status line to `Stage C delivered, with explicit deferrals recorded in ROADMAP.md. Stage D is in progress.`
- In `README.md`, update the Indonesian status line to `Stage C selesai, dengan penundaan eksplisit yang dicatat di ROADMAP.md. Stage D sedang berjalan.`
- In `README.md`, check the Stage C checklist item if the list is still historical or active.

- [ ] **Step 3: Update the PRD Gap Register**

Set decisions:

- Note Markdown export: `Delivered`.
- Basic revision history: `Deferred: autosave and draft recovery only; owner Rya`.
- Library sort and filter: `Delivered`.
- Collection export: `Deferred: full-workspace backup covers the MVP; owner Rya`.
- Note link UI: `Delivered for note-to-note links`.
- Add a file-note links row with `Deferred: needs a new relation, migrations, backup, and sync; owner Rya`.

Use a consistent reason format. Do not claim file-note links or backlinks exist.

- [ ] **Step 4: Update the changelog**

Add a concise `Added` section under `[Unreleased]` covering:

- note links,
- Markdown export,
- library sort and type filter,
- backup reminders,
- storage diagnostics,
- restore guidance.

Add a `Deferred` or `Changed` note only if the repository already uses that structure. Do not invent a release date.

- [ ] **Step 5: Check the new UI for accessibility and mobile behavior**

Verify and fix before the gates:

- every new select and search input has a visible or `sr-only` label,
- checkbox rows and buttons are reachable by keyboard and show focus,
- the library filter row wraps without horizontal scrolling on a narrow viewport,
- touch targets remain at least 44px,
- error and status messages use `role="alert"` or `role="status"`,
- the linked-note links use real anchors.

- [ ] **Step 6: Run full quality gates**

Run each command and record the exact result:

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```

Expected: all pass. Do not suppress errors.

- [ ] **Step 7: Run the relevant E2E journey if available**

Run: `npm run test:e2e`

If the system Playwright or Chromium is unavailable, report the exact failure. Do not claim the E2E suite passed without output.

- [ ] **Step 8: Final report**

Report:

- delivered features,
- deferred items and their reasons,
- test counts and build result,
- any unrun E2E or platform limitation,
- files changed.

Do not commit. The user will ask for commits separately.
