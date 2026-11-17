import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  StorageError,
  type IsoDate,
  type Note,
  type NoteId,
  type WorkspaceId,
} from "@opennest/core";

import { readNoteDraft, writeNoteDraft, type NoteDraft } from "../draft-journal";
import { createPlainDraftStore, type DraftStore } from "../draft-store";
import { createSaveCoordinator, type SaveCoordinator } from "../save-coordinator";
import { useNoteAutosave, type NoteSavePatch } from "../use-note-autosave";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const note: Note = {
  id: "note-1" as NoteId,
  workspaceId: "workspace-1" as WorkspaceId,
  folderId: null,
  title: "Original title",
  content: "Original content",
  pinned: false,
  createdAt: "2026-11-14T09:00:00.000Z" as IsoDate,
  updatedAt: "2026-11-14T10:00:00.000Z" as IsoDate,
};

type HarnessProps = {
  save: (patch: NoteSavePatch) => Promise<Note>;
  coordinator: SaveCoordinator;
  draftStore?: DraftStore | null;
  note?: Note;
};

function Harness({
  save,
  coordinator,
  draftStore = createPlainDraftStore(window.localStorage),
  note: activeNote = note,
}: HarnessProps) {
  const autosave = useNoteAutosave({
    note: activeNote,
    save,
    coordinator,
    draftStore,
  });

  return (
    <div>
      <input
        aria-label="Title"
        value={autosave.title}
        onChange={(event) => autosave.setTitle(event.target.value)}
      />
      <textarea
        aria-label="Content"
        value={autosave.content}
        onChange={(event) => autosave.setContent(event.target.value)}
      />
      <span data-testid="status">
        {autosave.saveError ??
          (autosave.saving ? "saving" : autosave.dirty ? "dirty" : "saved")}
      </span>
      <span data-testid="missing">{autosave.titleMissing ? "missing" : "present"}</span>
      {autosave.draftError ? (
        <span data-testid="draft-error">{autosave.draftError}</span>
      ) : null}
      {autosave.draftRestored ? <span data-testid="restored">restored</span> : null}
    </div>
  );
}

let root: Root;
let container: HTMLDivElement;

function mount(props: HarnessProps) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root.render(<Harness {...props} />);
  });

  return container;
}

function change(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

  act(() => {
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function settle() {
  for (let index = 0; index < 12; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function idle(ms = 600) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
  await settle();
}

function titleField(host: HTMLElement): HTMLInputElement {
  return host.querySelector('input[aria-label="Title"]') as HTMLInputElement;
}

function contentField(host: HTMLElement): HTMLTextAreaElement {
  return host.querySelector('textarea[aria-label="Content"]') as HTMLTextAreaElement;
}

function savedNote(patch: NoteSavePatch, updatedAt: string): Note {
  return {
    ...note,
    ...patch,
    updatedAt: updatedAt as IsoDate,
  };
}

function createFlakyStorage() {
  const values = new Map<string, string>();
  let failWrites = true;

  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      if (failWrites) {
        throw new Error("blocked");
      }

      values.set(key, value);
    },
  };

  return {
    storage,
    allowWrites() {
      failWrites = false;
    },
  };
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
  await settle();
}

beforeEach(() => {
  window.localStorage.clear();
  document.body.replaceChildren();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-14T10:00:01.000Z"));
});

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useNoteAutosave", () => {
  it("saves the latest title and content after the idle delay", async () => {
    const save = vi.fn(async (patch: NoteSavePatch) =>
      savedNote(patch, "2026-11-14T10:00:02.000Z")
    );
    const coordinator = createSaveCoordinator();
    const host = mount({ save, coordinator });

    change(titleField(host), "New title");
    change(contentField(host), "New content");
    await idle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ title: "New title", content: "New content" });
    expect(host.textContent).toContain("saved");
  });

  it("serializes saves and persists the newest edit", async () => {
    const calls: NoteSavePatch[] = [];
    const resolvers: Array<(value: Note) => void> = [];
    const save = vi.fn((patch: NoteSavePatch) => {
      calls.push(patch);
      return new Promise<Note>((resolve) => {
        resolvers.push(resolve);
      });
    });
    const coordinator = createSaveCoordinator();
    const host = mount({ save, coordinator });

    change(titleField(host), "First");
    await idle();
    expect(save).toHaveBeenCalledTimes(1);

    change(contentField(host), "Second edit");
    await idle();
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvers[0]?.(savedNote(calls[0]!, "2026-11-14T10:00:02.000Z"));
      await Promise.resolve();
    });
    await settle();

    expect(save).toHaveBeenCalledTimes(2);
    expect(calls[1]).toEqual({ title: "First", content: "Second edit" });

    await act(async () => {
      resolvers[1]?.(savedNote(calls[1]!, "2026-11-14T10:00:03.000Z"));
      await Promise.resolve();
    });
    await settle();

    expect(host.textContent).toContain("saved");
  });

  it("flushes when the editor unmounts", async () => {
    const save = vi.fn(async (patch: NoteSavePatch) =>
      savedNote(patch, "2026-11-14T10:00:02.000Z")
    );
    const coordinator = createSaveCoordinator();
    const host = mount({ save, coordinator });

    change(contentField(host), "Saved on the way out");
    act(() => root.unmount());
    await settle();

    expect(save).toHaveBeenCalledWith({
      title: "Original title",
      content: "Saved on the way out",
    });
  });

  it("flushes on pagehide", async () => {
    const save = vi.fn(async (patch: NoteSavePatch) =>
      savedNote(patch, "2026-11-14T10:00:02.000Z")
    );
    const coordinator = createSaveCoordinator();
    const host = mount({ save, coordinator });

    change(contentField(host), "Hidden page edit");
    act(() => window.dispatchEvent(new Event("pagehide")));
    await settle();

    expect(save).toHaveBeenCalledWith({
      title: "Original title",
      content: "Hidden page edit",
    });
  });

  it("restores a newer draft and clears it after saving", async () => {
    writeNoteDraft(window.localStorage, {
      version: 1,
      workspaceId: note.workspaceId,
      noteId: note.id,
      title: "Draft title",
      content: "Draft content",
      baseUpdatedAt: note.updatedAt,
      savedAt: Date.now(),
    });
    const save = vi.fn(async (patch: NoteSavePatch) =>
      savedNote(patch, "2026-11-14T10:00:02.000Z")
    );
    const coordinator = createSaveCoordinator();
    const host = mount({ save, coordinator });

    await settle();

    expect(titleField(host).value).toBe("Draft title");
    expect(contentField(host).value).toBe("Draft content");
    expect(host.textContent).toContain("restored");

    await idle();

    expect(save).toHaveBeenCalledWith({ title: "Draft title", content: "Draft content" });
    expect(readNoteDraft(window.localStorage, note.workspaceId, note.id)).toBeNull();
  });

  it("ignores a draft older than the stored note", async () => {
    writeNoteDraft(window.localStorage, {
      version: 1,
      workspaceId: note.workspaceId,
      noteId: note.id,
      title: "Stale draft",
      content: "Stale content",
      baseUpdatedAt: note.updatedAt,
      savedAt: Date.parse(note.updatedAt) - 1000,
    });
    const save = vi.fn(async (patch: NoteSavePatch) =>
      savedNote(patch, "2026-11-14T10:00:02.000Z")
    );
    const coordinator = createSaveCoordinator();
    const host = mount({ save, coordinator });

    await settle();

    expect(titleField(host).value).toBe(note.title);
    expect(readNoteDraft(window.localStorage, note.workspaceId, note.id)).toBeNull();
  });

  it("restores a draft when only note metadata changed after it was written", async () => {
    writeNoteDraft(window.localStorage, {
      version: 1,
      workspaceId: note.workspaceId,
      noteId: note.id,
      title: "Draft title",
      content: "Draft content",
      baseTitle: note.title,
      baseContent: note.content,
      baseUpdatedAt: note.updatedAt,
      savedAt: Date.parse("2026-11-14T10:00:01.000Z"),
    });
    const save = vi.fn(async (patch: NoteSavePatch) =>
      savedNote(patch, "2026-11-14T10:00:03.000Z")
    );
    const coordinator = createSaveCoordinator();
    const host = mount({
      note: { ...note, updatedAt: "2026-11-14T10:00:02.000Z" as IsoDate },
      save,
      coordinator,
    });

    await settle();

    expect(titleField(host).value).toBe("Draft title");
    expect(contentField(host).value).toBe("Draft content");
    expect(host.textContent).toContain("restored");
  });

  it("persists the saved note text as the draft base", async () => {
    const save = vi.fn(async (patch: NoteSavePatch) =>
      savedNote(patch, "2026-11-14T10:00:03.000Z")
    );
    const coordinator = createSaveCoordinator();
    const host = mount({ save, coordinator });

    change(titleField(host), "Draft title");
    change(contentField(host), "Draft content");
    await advance(250);

    const draft = readNoteDraft(window.localStorage, note.workspaceId, note.id);

    expect(draft?.baseTitle).toBe(note.title);
    expect(draft?.baseContent).toBe(note.content);
  });

  it("ignores a draft whose base differs from the updated note text", async () => {
    writeNoteDraft(window.localStorage, {
      version: 1,
      workspaceId: note.workspaceId,
      noteId: note.id,
      title: "Stale draft",
      content: "Stale content",
      baseTitle: note.title,
      baseContent: note.content,
      baseUpdatedAt: note.updatedAt,
      savedAt: Date.parse("2026-11-14T10:00:01.000Z"),
    });
    const save = vi.fn(async (patch: NoteSavePatch) =>
      savedNote(patch, "2026-11-14T10:00:03.000Z")
    );
    const coordinator = createSaveCoordinator();
    const host = mount({
      note: {
        ...note,
        title: "Edited on another tab",
        content: "Edited content",
        updatedAt: "2026-11-14T10:00:02.000Z" as IsoDate,
      },
      save,
      coordinator,
    });

    await settle();

    expect(titleField(host).value).toBe("Edited on another tab");
    expect(contentField(host).value).toBe("Edited content");
    expect(host.textContent).not.toContain("restored");
    expect(readNoteDraft(window.localStorage, note.workspaceId, note.id)).toBeNull();
  });

  it("surfaces a draft write failure and clears it after a later write", async () => {
    const flaky = createFlakyStorage();
    const save = vi.fn(async (patch: NoteSavePatch) =>
      savedNote(patch, "2026-11-14T10:00:02.000Z")
    );
    const coordinator = createSaveCoordinator();
    const host = mount({
      save,
      coordinator,
      draftStore: createPlainDraftStore(flaky.storage),
    });

    change(contentField(host), "Draft that cannot persist");
    await advance(250);

    expect(host.querySelector('[data-testid="draft-error"]')?.textContent).toBe(
      "notes.draftError"
    );

    flaky.allowWrites();
    change(contentField(host), "Draft that can persist");
    await advance(250);

    expect(host.querySelector('[data-testid="draft-error"]')).toBeNull();
    expect(readNoteDraft(flaky.storage, note.workspaceId, note.id)?.content).toBe(
      "Draft that can persist"
    );
  });

  it("clears a draft write warning after the note saves", async () => {
    const flaky = createFlakyStorage();
    const save = vi.fn(async (patch: NoteSavePatch) =>
      savedNote(patch, "2026-11-14T10:00:02.000Z")
    );
    const coordinator = createSaveCoordinator();
    const host = mount({
      save,
      coordinator,
      draftStore: createPlainDraftStore(flaky.storage),
    });

    change(contentField(host), "Saved despite the blocked draft");
    await advance(250);

    expect(host.querySelector('[data-testid="draft-error"]')).not.toBeNull();

    await idle(600);

    expect(save).toHaveBeenCalledWith({
      title: "Original title",
      content: "Saved despite the blocked draft",
    });
    expect(host.querySelector('[data-testid="draft-error"]')).toBeNull();
    expect(host.textContent).toContain("saved");
  });

  it("retries a transient save failure without showing an error", async () => {
    const save = vi
      .fn<(patch: NoteSavePatch) => Promise<Note>>()
      .mockRejectedValueOnce(new StorageError("temporary", "corrupt_data"))
      .mockImplementation(async (patch) => savedNote(patch, "2026-11-14T10:00:02.000Z"));
    const coordinator = createSaveCoordinator();
    const host = mount({ save, coordinator });

    change(contentField(host), "Do not lose this");
    await idle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("saving");
    expect(host.textContent).not.toContain("errors.storage");
    expect(readNoteDraft(window.localStorage, note.workspaceId, note.id)?.content).toBe(
      "Do not lose this"
    );

    await advance(1_000);

    expect(save).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("saved");
    expect(readNoteDraft(window.localStorage, note.workspaceId, note.id)).toBeNull();
  });

  it("stops after the retry budget and keeps the draft", async () => {
    const save = vi
      .fn<(patch: NoteSavePatch) => Promise<Note>>()
      .mockRejectedValue(new StorageError("temporary", "corrupt_data"));
    const coordinator = createSaveCoordinator();
    const host = mount({ save, coordinator });

    change(contentField(host), "Keep this after retries");
    await idle();

    expect(save).toHaveBeenCalledTimes(1);

    await advance(1_000);
    expect(save).toHaveBeenCalledTimes(2);

    await advance(2_000);
    expect(save).toHaveBeenCalledTimes(3);
    expect(host.textContent).toContain("errors.storage");
    expect(readNoteDraft(window.localStorage, note.workspaceId, note.id)?.content).toBe(
      "Keep this after retries"
    );
  });

  it("starts a fresh retry budget on the next flush", async () => {
    const save = vi
      .fn<(patch: NoteSavePatch) => Promise<Note>>()
      .mockRejectedValueOnce(new StorageError("temporary", "corrupt_data"))
      .mockRejectedValueOnce(new StorageError("temporary", "corrupt_data"))
      .mockRejectedValueOnce(new StorageError("temporary", "corrupt_data"))
      .mockRejectedValueOnce(new StorageError("temporary", "corrupt_data"))
      .mockImplementation(async (patch) => savedNote(patch, "2026-11-14T10:00:02.000Z"));
    const coordinator = createSaveCoordinator();
    const host = mount({ save, coordinator });

    change(contentField(host), "First attempt budget");
    await idle();
    await advance(1_000);
    await advance(2_000);

    expect(save).toHaveBeenCalledTimes(3);
    expect(host.textContent).toContain("errors.storage");

    change(contentField(host), "Second attempt budget");
    await idle();

    expect(save).toHaveBeenCalledTimes(4);

    await advance(1_000);

    expect(save).toHaveBeenCalledTimes(5);
    expect(host.textContent).toContain("saved");
  });

  it("does not retry a deterministic storage failure", async () => {
    const save = vi
      .fn<(patch: NoteSavePatch) => Promise<Note>>()
      .mockRejectedValue(new StorageError("full", "quota_exceeded"));
    const coordinator = createSaveCoordinator();
    const host = mount({ save, coordinator });

    change(contentField(host), "Too large to save");
    await idle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("errors.storage");

    await advance(5_000);

    expect(save).toHaveBeenCalledTimes(1);
    expect(readNoteDraft(window.localStorage, note.workspaceId, note.id)?.content).toBe(
      "Too large to save"
    );
  });

  it("does not write an empty title but keeps its content in a draft", async () => {
    const save = vi.fn(async (patch: NoteSavePatch) =>
      savedNote(patch, "2026-11-14T10:00:02.000Z")
    );
    const coordinator = createSaveCoordinator();
    const host = mount({ save, coordinator });

    change(titleField(host), "");
    change(contentField(host), "Content that still matters");
    await idle();

    expect(save).not.toHaveBeenCalled();
    expect(host.textContent).toContain("missing");
    expect(readNoteDraft(window.localStorage, note.workspaceId, note.id)?.content).toBe(
      "Content that still matters"
    );
    await act(async () => {
      await expect(coordinator.flushAll()).resolves.toMatchObject({ ok: false });
    });
    await settle();
  });

  it("waits for draft recovery before saving user edits", async () => {
    let resolveLoad!: (draft: NoteDraft | null) => void;
    const load = new Promise<NoteDraft | null>((resolve) => {
      resolveLoad = resolve;
    });
    const plain = createPlainDraftStore(window.localStorage);
    const draftStore: DraftStore = {
      ...plain,
      get: vi.fn(() => load),
    };
    const save = vi.fn(async (patch: NoteSavePatch) =>
      savedNote(patch, "2026-11-14T10:00:02.000Z")
    );
    const coordinator = createSaveCoordinator();
    const host = mount({ save, coordinator, draftStore });

    change(contentField(host), "Typed before recovery");
    await idle();
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      resolveLoad({
        version: 1,
        workspaceId: note.workspaceId,
        noteId: note.id,
        title: "Recovered title",
        content: "Recovered content",
        baseUpdatedAt: note.updatedAt,
        savedAt: Date.now(),
      });
      await Promise.resolve();
    });
    await settle();

    expect(save).toHaveBeenCalledWith({
      title: "Original title",
      content: "Typed before recovery",
    });
  });

  it("does not clear an unseen draft when the editor unmounts", async () => {
    let resolveLoad!: (draft: NoteDraft | null) => void;
    const load = new Promise<NoteDraft | null>((resolve) => {
      resolveLoad = resolve;
    });
    const plain = createPlainDraftStore(window.localStorage);
    const remove = vi.fn(async () => undefined);
    const put = vi.fn(async () => undefined);
    const draftStore: DraftStore = {
      ...plain,
      get: vi.fn(() => load),
      remove,
      put,
    };
    const save = vi.fn(async (patch: NoteSavePatch) =>
      savedNote(patch, "2026-11-14T10:00:02.000Z")
    );
    const coordinator = createSaveCoordinator();
    mount({ save, coordinator, draftStore });

    act(() => root.unmount());
    await act(async () => {
      resolveLoad({
        version: 1,
        workspaceId: note.workspaceId,
        noteId: note.id,
        title: "Unseen title",
        content: "Unseen content",
        baseUpdatedAt: note.updatedAt,
        savedAt: Date.now(),
      });
      await Promise.resolve();
    });
    await settle();

    expect(remove).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("prompts before unload only while work is unsaved", async () => {
    const save = vi.fn(async (patch: NoteSavePatch) =>
      savedNote(patch, "2026-11-14T10:00:02.000Z")
    );
    const coordinator = createSaveCoordinator();
    const host = mount({ save, coordinator });

    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    change(contentField(host), "Unsaved");
    const dirty = new Event("beforeunload", { cancelable: true });
    act(() => window.dispatchEvent(dirty));
    await settle();

    expect(dirty.defaultPrevented).toBe(true);
  });
});
