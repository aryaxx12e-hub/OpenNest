# ADR 0007: Note autosave durability and update coordination

- Status: Accepted
- Date: 2026-11-14
- Amendment: AD-7-1 accepted 2026-11-16 for Stage D3

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

## Amendment AD-7-1: asynchronous encrypted drafts

- Status: Accepted for D3 implementation on 2026-11-16.
- Scope: this amendment changes only draft storage and flush behavior. The rest
  of ADR 0007 remains in force.

Plaintext workspaces keep the existing synchronous `localStorage` journal and
the `opennest:draft:note:` key prefix. An encrypted workspace uses a new
`DraftStore` interface whose operations return promises:

- `list`, `get`, `put`, `remove`, `clear`, `count`, and `flush`.
- The encrypted implementation stores under
  `opennest:edraft:note:<workspaceId>:<noteId>`.
- The complete draft record, including title, content, base title, base content,
  and timestamps, is serialized and encrypted. The note ID and workspace ID
  remain in the key and in AAD, but no draft text is written in plaintext.
- The envelope uses the workspace key hierarchy and binds workspace ID, note ID,
  purpose `draft`, envelope version, and key ID. A moved or swapped draft must
  fail authentication.
- `put` resolves only after the encrypted write is committed. `flush` resolves
  after pending writes settle. `count` reports stored drafts without exposing
  their contents.

Lifecycle behavior changes in encrypted mode:

- `pagehide`, hidden-document, unmount, and update prompts are best effort. The
  browser does not guarantee that an asynchronous encrypted write finishes before
  the page is frozen or discarded.
- The editor still attempts the normal IndexedDB save and the encrypted draft.
  It must not fall back to a plaintext draft when encryption is active.
- If the encrypted draft cannot be written, the editor reports a localized
  warning while continuing the normal save. The update control must not reload
  while a pending encrypted draft cannot be verified.
- On unlock, draft recovery runs after the workspace key is available. A draft
  that cannot be decrypted is ignored and removed without displaying ciphertext.

Migration behavior:

- Plaintext drafts are copied to encrypted keys first.
- Each copied draft is decrypted and compared before the encrypted base restore
  commits.
- Plaintext drafts are deleted only after the encrypted restore commits and the
  new base is readable.
- If migration fails before commit, plaintext storage and plaintext drafts remain
  readable. There is no mixed mode that locks the user out.
- If migration is cancelled, encrypted draft copies are removed and plaintext
  drafts remain.

Consequences of this amendment:

- Encrypted draft durability is weaker than the synchronous plaintext journal at
  the final instant before a page is discarded. The product must not promise
  crash-proof drafts in encrypted mode.
- Losing the workspace passphrase and recovery key also makes pending encrypted
  drafts unrecoverable.
- Draft metadata in key names remains visible. Draft text, title, and base values
  do not.
- Every draft write has encryption cost. The editor must serialize draft writes
  so an older write cannot overwrite a newer snapshot.

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
