# Draft Recovery and Reload Race Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the permanent PWA update deadlock from orphan drafts, stop discarding unsaved drafts after metadata-only note updates, and ignore late results from same-key reloads.

**Architecture:** Add explicit draft recovery to the update banner, store the last saved base text in each draft for staleness decisions, and guard `useAsyncData` with a synchronous request id. No core Note or IndexedDB schema changes.

**Tech Stack:** Next.js 16, React 19, TypeScript strict, Vitest, Testing Library via react-dom root, @opennest/localization, @opennest/ui.

**Spec:** Approved plan in the session: Critical 1, Important 2, Important 3; review report in the session.

## Global Constraints

- Do not change core `Note`, IndexedDB schema, or migrations.
- Keep draft `version: 1`; new base fields are optional for backward compatibility.
- All new user-facing text goes in `packages/localization/src/en.ts` and `id.ts`.
- Do not fix Minor 4-9 in this plan.
- Do not commit unless the human partner asks.
- Fail closed: a draft is never discarded silently.

---

### Task 1: Harden the draft journal and recovery primitives

**Files:**

- Modify: `apps/web/lib/autosave/draft-journal.ts`
- Test: `apps/web/lib/autosave/__tests__/draft-journal.test.ts`

**Interfaces:**

- Produces: `parseNoteDraftKey(key: string): { workspaceId: string; noteId: string } | null`
- Produces: `clearNoteDraft(storage, workspaceId, noteId): boolean`
- Produces: `clearAllNoteDrafts(storage): { removed: number; failed: number }`
- Consumes: existing `DraftStorage`, `NoteDraft`, `DRAFT_PREFIX`.

- [x] **Step 1: Write the failing test for a key that does not match its draft**

Add to `draft-journal.test.ts`:

```ts
it("skips a draft whose key does not match its workspace and note", () => {
  window.localStorage.setItem(
    noteDraftKey("workspace-1", "note-1"),
    JSON.stringify({ ...draft, workspaceId: "workspace-2", noteId: "note-2" })
  );

  const result = readDraftJournal(window.localStorage);

  expect(result.ok).toBe(true);
  expect(result.ok ? result.drafts : []).toEqual([]);
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npm test -- draft-journal`
Expected: FAIL because the mismatched draft is returned.

- [x] **Step 3: Write the failing test for clear-all failure reporting**

Add to `draft-journal.test.ts`:

```ts
it("reports drafts it could not remove", () => {
  const values = new Map<string, string>();
  const key = noteDraftKey("workspace-1", "note-1");
  values.set(key, JSON.stringify(draft));

  const blocked = {
    get length() {
      return values.size;
    },
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => values.set(name, value),
    removeItem: () => {
      throw new Error("blocked");
    },
    key: (index: number) => Array.from(values.keys())[index] ?? null,
  };

  expect(clearAllNoteDrafts(blocked)).toEqual({ removed: 0, failed: 1 });
});
```

- [x] **Step 4: Run the test to verify it fails**

Run: `npm test -- draft-journal`
Expected: FAIL because `clearAllNoteDrafts` returns undefined.

- [x] **Step 5: Implement the journal changes**

In `draft-journal.ts`:

- Add `parseNoteDraftKey` that strips `DRAFT_PREFIX` and splits once on `:`.
- In `readDraftJournal`, require the parsed key to equal `parsed.workspaceId` and `parsed.noteId` before pushing.
- Make `clearNoteDraft` return `true` when `removeItem` does not throw.
- Make `clearAllNoteDrafts` count `removed` and `failed` and return the object.

- [x] **Step 6: Run the test to verify it passes**

Run: `npm test -- draft-journal`
Expected: PASS, including existing journal tests.

---

### Task 2: Add the draft recovery panel and wire it into the update banner

**Files:**

- Create: `apps/web/components/draft-recovery.tsx`
- Modify: `apps/web/components/service-worker-update.tsx`
- Modify: `apps/web/components/app-shell.tsx`
- Modify: `packages/localization/src/en.ts`
- Modify: `packages/localization/src/id.ts`
- Test: `apps/web/components/__tests__/pwa-ui.test.tsx`

**Interfaces:**

- Produces: `DraftTarget = { draft: NoteDraft; exists: boolean }`
- Produces props on `ServiceWorkerUpdate`: `classifyDrafts?: (drafts: NoteDraft[]) => Promise<DraftTarget[]>`, `clearDraft?: (workspaceId: string, noteId: string) => boolean`, `clearDrafts?: () => { removed: number; failed: number }`, `download?: (fileName: string, text: string) => void`
- Consumes: `NoteDraft`, `clearNoteDraft`, `clearAllNoteDrafts`.

- [x] **Step 1: Write the failing test for orphan recovery**

Add to `pwa-ui.test.tsx` a test that writes one draft for `note-1`, mounts `ServiceWorkerUpdate` with `classifyDrafts: async (drafts) => drafts.map((draft) => ({ draft, exists: false }))` and an injected `download` plus `clearDraft` spy. Trigger the update and click Refresh. Assert the banner contains the orphan recovery action. Click `Discard` and assert `clearDraft` is called with the workspace and note, and `SKIP_WAITING` is eventually posted.

- [x] **Step 2: Run the test to verify it fails**

Run: `npm test -- pwa-ui`
Expected: FAIL because no recovery action exists.

- [x] **Step 3: Write the failing test for an existing-note draft**

Add a test that classifies the draft as `exists: true`. Trigger Refresh. Assert the banner contains an `Open note` link to `/notes/note-1` and does not expose the orphan discard action.

- [x] **Step 4: Write the failing test for an unreadable journal**

Use `readDrafts={() => ({ ok: false, error: new Error("blocked") })}` and an injected `clearDrafts` spy. Trigger Refresh. Assert `Clear draft data` is shown, confirm it, and assert `clearDrafts` was called and the update retried.

- [x] **Step 5: Run the tests to verify they fail**

Run: `npm test -- pwa-ui`
Expected: FAIL because the recovery UI and props are missing.

- [x] **Step 6: Implement `DraftRecovery`**

Create `apps/web/components/draft-recovery.tsx` with:

- A status message and list of drafts.
- `Open note` links for targets with `exists: true`.
- `Download` and `Discard` for targets with `exists: false`.
- A `Clear draft data` action for unreadable mode.
- `ConfirmDialog` for destructive actions, disabled while busy.
- No new global state.

- [x] **Step 7: Wire `ServiceWorkerUpdate`**

In `service-worker-update.tsx`:

- Add the new props with fail-closed defaults.
- After a successful flush, read the journal.
- If unreadable, set the unreadable recovery state.
- If drafts exist, call `classifyDrafts`; set the target state.
- Render `DraftRecovery` under the existing message.
- On discard, clear only orphan targets, retry the update if all clear, and show an error if any removal failed.
- Reset recovery state on `Later` and on a new update-ready event.

- [x] **Step 8: Wire `AppShell`**

Call `useAppData()` in `AppShell` and pass `classifyDrafts` that resolves each note through `services.note.get` and requires `note.workspaceId === draft.workspaceId`.

- [x] **Step 9: Add EN and ID copy**

Add all new `pwa.updateDraft*` keys to both locale files with matching key names.

- [x] **Step 10: Run the tests to verify they pass**

Run: `npm test -- pwa-ui`
Expected: PASS, including the existing nine PWA banner tests.

---

### Task 3: Clear drafts after a successful backup restore

**Files:**

- Modify: `apps/web/components/backup-panel.tsx`
- Modify: `packages/localization/src/en.ts`
- Modify: `packages/localization/src/id.ts`
- Test: `apps/web/components/__tests__/backup-panel.test.tsx`

**Interfaces:**

- Consumes: `clearAllNoteDrafts` from `draft-journal`.

- [x] **Step 1: Write the failing test for successful restore clearing drafts**

Write a draft with `writeNoteDraft(window.localStorage, ...)`, perform a successful restore, and assert `readNoteDraft` returns null.

- [x] **Step 2: Run the test to verify it fails**

Run: `npm test -- backup-panel`
Expected: FAIL because the draft remains.

- [x] **Step 3: Write the failing test for a failed draft clear**

Spy on `window.localStorage.removeItem` to throw once. Restore successfully. Assert the success message is still shown and the new `backup.draftClearFailed` alert appears.

- [x] **Step 4: Implement the clear call**

After `storage.restore(pending.snapshot)` and before/after `refreshWorkspace`, call `clearAllNoteDrafts(window.localStorage)`. If `failed > 0`, set the warning key while keeping the success key.

- [x] **Step 5: Add EN and ID copy**

Add `backup.draftClearFailed` to both locale files.

- [x] **Step 6: Run the tests to verify they pass**

Run: `npm test -- backup-panel`
Expected: PASS.

---

### Task 4: Keep drafts after metadata-only note updates

**Files:**

- Modify: `apps/web/lib/autosave/draft-journal.ts`
- Modify: `apps/web/lib/autosave/use-note-autosave.ts`
- Test: `apps/web/lib/autosave/__tests__/draft-journal.test.ts`
- Test: `apps/web/lib/autosave/__tests__/use-note-autosave.test.tsx`

**Interfaces:**

- Produces: optional `baseTitle?: string` and `baseContent?: string` on `NoteDraft`.
- Consumes: `savedRef.current` in `writeDraftNow`.

- [x] **Step 1: Write the failing autosave test**

Add a test where the note `updatedAt` is `2026-11-14T10:00:02.000Z`, the draft `savedAt` is `10:00:01`, `baseTitle`/`baseContent` equal the note text, and the draft title/content differ. Mount the editor and assert the draft text is restored and the draft notice is shown.

- [x] **Step 2: Run the test to verify it fails**

Run: `npm test -- use-note-autosave`
Expected: FAIL because the draft is treated as stale.

- [x] **Step 3: Write the failing stale-draft regression test**

Add a test where the note text differs from `baseTitle`/`baseContent` and the draft is older than the note. Assert the note text is shown and the draft is removed.

- [x] **Step 4: Run the tests to verify they fail**

Run: `npm test -- use-note-autosave`
Expected: the stale test may already pass; confirm only the metadata test fails for the intended reason.

- [x] **Step 5: Extend the draft shape**

In `draft-journal.ts`, accept optional `baseTitle` and `baseContent` strings in `isNoteDraft`.

- [x] **Step 6: Write the base text and change staleness**

In `use-note-autosave.ts`, `writeNoteDraft` receives `baseTitle: savedRef.current.title` and `baseContent: savedRef.current.content`. Update `isNewerDraft` to return true when the note text equals the draft base, before falling back to the timestamp.

- [x] **Step 7: Run the tests to verify they pass**

Run: `npm test -- use-note-autosave draft-journal`
Expected: PASS, including legacy drafts without base fields.

---

### Task 5: Ignore late results from the same key in `useAsyncData`

**Files:**

- Modify: `apps/web/lib/data/hooks.ts`
- Test: `apps/web/lib/data/__tests__/hooks.test.tsx`

**Interfaces:**

- Consumes: existing `useAsyncData` signature.
- Produces: no public API change.

- [x] **Step 1: Write the failing same-key late-resolution test**

Add a test with a loader that returns a pending promise on the first call and a second pending promise on the second call. Click reload while the first is pending. Resolve the first promise. Assert the UI is still loading and data is unchanged. Resolve the second promise and assert the new data appears.

- [x] **Step 2: Run the test to verify it fails**

Run: `npm test -- hooks`
Expected: FAIL because the first resolution sets the state.

- [x] **Step 3: Write the failing same-key late-rejection test**

Click reload while the first request is pending, reject the first request, and assert the error stays clear and loading stays true until the second resolves.

- [x] **Step 4: Run the tests to verify they fail**

Run: `npm test -- hooks`
Expected: FAIL because the first rejection sets the error.

- [x] **Step 5: Implement the request id**

In `hooks.ts`, add `requestRef`, increment it synchronously in `reload`, increment it in the effect, and only set state when the captured id is still current.

- [x] **Step 6: Run the tests to verify they pass**

Run: `npm test -- hooks`
Expected: PASS, including all existing key-change tests.

---

### Task 6: Run the full verification gates

- [x] **Step 1: Format**

Run: `npm run format:check`
Expected: PASS.

- [x] **Step 2: Lint**

Run: `npm run lint`
Expected: PASS.

- [x] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [x] **Step 4: Unit and integration tests**

Run: `npm test`
Expected: PASS with the new tests included.

- [x] **Step 5: Production build**

Run: `npm run build`
Expected: PASS.

- [x] **Step 6: E2E**

Run: `npm run test:e2e`
Expected: PASS, including the existing Stage C and PWA checks.
