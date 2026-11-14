# ADR 0007: Note autosave durability and update coordination

- Status: Accepted
- Date: 2026-11-14

## Context

The note editor previously saved after a 600 ms idle delay and on blur. Clearing
the timer on unmount meant that closing, navigating, backgrounding, or updating
the app could discard the newest edit. Saves were also not serialized, so an
older request could finish after a newer one and overwrite it.

The PWA update prompt is intentionally user-confirmed, but a reload could still
start while an edit was pending. `pagehide` and `visibilitychange` handlers
cannot guarantee that an asynchronous IndexedDB write finishes before the page
is frozen or discarded.

## Decision

Keep IndexedDB as the source of truth and add a small synchronous draft layer in
localStorage.

- `apps/web/lib/autosave/draft-journal.ts` stores one versioned draft per note
  under `opennest:draft:note:<workspaceId>:<noteId>`. Reads validate the shape
  and discard corrupt or unsupported entries. Writes and clears fail softly.
- `apps/web/lib/autosave/use-note-autosave.ts` owns the editor text. It saves
  after 500 ms idle, on blur, on unmount, on `pagehide`, when the document
  becomes hidden, when the connection returns, and before the update action.
- Saves are serialized. A single in-flight save owns the loop; when it finishes,
  the loop saves the latest snapshot if the user kept typing. Transient failures
  retry up to three total attempts with 1 s and 2 s delays. Deterministic domain
  failures are not retried. A failed save leaves the draft and dirty state intact,
  and `saveError` appears only after the final attempt fails.
- Drafts are written after 200 ms and synchronously in lifecycle handlers. They
  are cleared only after a save succeeds, the note is deleted, or a newer draft
  is ignored because the stored note is newer.
- If the browser cannot keep a recovery draft, the editor shows a localized
  `draftError` warning. The real save still continues independently.
- A draft is restored on mount only when it differs from the stored note and is
  not older than `note.updatedAt`. The editor shows a localized recovery notice.
- `apps/web/lib/data/save-coordinator.tsx` provides one coordinator for the app.
  Editors register a flush function and the service worker update control calls
  `flushAll()` before posting `SKIP_WAITING`.
- The update control fails closed. After a successful flush it reads and validates
  the draft journal. If any valid draft remains, or the journal cannot be read, the
  worker keeps waiting. A failed save, a remaining draft, and an unreadable journal
  each get their own localized message. The page does not reload in any of these
  cases.
- `beforeunload` prompts only while work is dirty or a save is in flight. This is
  a warning, not a durability guarantee; the draft journal is the fallback.

`useAsyncData` is key-aware so a route change never shows another record's data
or error while the next record loads. Same-key reloads keep the current data
visible until the replacement arrives.

## Consequences

- A crash, reload, backgrounding, or navigation has a synchronous draft to fall
  back on even when IndexedDB cannot finish.
- The draft is plain text in localStorage. It is scoped per workspace and note,
  but it is not encrypted, so the same browser-storage caveats apply.
- localStorage quotas are small relative to IndexedDB. Draft writes may fail
  softly; the editor still attempts the real save and reports failure.
- Multi-tab editing remains last-writer-wins. Drafts do not merge.
- A stale draft is ignored when the stored note is newer. Clock skew or a draft
  from another tab may therefore be discarded rather than applied.
- The update prompt can stay visible longer while a save is retried, a draft
  remains on the device, the journal cannot be read, or the user fixes an empty
  title. That is preferable to silently losing an edit.

## Alternatives considered

- Keep debounce and blur only: simple, but still loses edits on unmount, hidden
  pages, and updates.
- Save on every keystroke: reduces the window but creates excessive writes and
  still depends on asynchronous completion.
- Block updates while dirty without a prompt: avoids reload races but leaves the
  user with no clear action.
- Await IndexedDB in `beforeunload`: browsers do not guarantee it, and the page
  may be discarded before the promise settles.
