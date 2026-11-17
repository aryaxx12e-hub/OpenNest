import { beforeEach, describe, expect, it } from "vitest";

import { noteDraftKey, type DraftStorage, type NoteDraft } from "../draft-journal";
import { createPlainDraftStore } from "../draft-store";

const draft: NoteDraft = {
  version: 1,
  workspaceId: "workspace-1",
  noteId: "note-1",
  title: "Draft title",
  content: "Unsaved words",
  baseTitle: "Saved title",
  baseContent: "Saved words",
  baseUpdatedAt: "2026-11-14T10:00:00.000Z",
  savedAt: 1_763_120_000_000,
};

function blockedStorage(): DraftStorage {
  return {
    get length(): number {
      throw new Error("blocked");
    },
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
    key() {
      throw new Error("blocked");
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("plain draft store", () => {
  it("round-trips drafts through the async interface", async () => {
    const store = createPlainDraftStore(window.localStorage);

    await store.put(draft);

    await expect(store.get("workspace-1", "note-1")).resolves.toEqual(draft);
    await expect(store.list()).resolves.toEqual([draft]);
    await expect(store.count()).resolves.toBe(1);
    await expect(store.flush()).resolves.toBeUndefined();
  });

  it("keeps plaintext workspaces readable at rest", async () => {
    const store = createPlainDraftStore(window.localStorage);

    await store.put(draft);

    const raw = window.localStorage.getItem(noteDraftKey("workspace-1", "note-1"));
    expect(raw).toContain("Draft title");
    expect(raw).toContain("Unsaved words");
  });

  it("removes one draft and clears the rest", async () => {
    const store = createPlainDraftStore(window.localStorage);
    await store.put(draft);
    await store.put({ ...draft, noteId: "note-2" });
    window.localStorage.setItem("unrelated", "keep me");

    await store.remove("workspace-1", "note-1");

    await expect(store.get("workspace-1", "note-1")).resolves.toBeNull();
    await expect(store.count()).resolves.toBe(1);
    await expect(store.clear()).resolves.toEqual({ removed: 1, failed: 0 });
    expect(window.localStorage.getItem("unrelated")).toBe("keep me");
  });

  it("rejects writes and removals when storage is blocked", async () => {
    const store = createPlainDraftStore(blockedStorage());

    await expect(store.put(draft)).rejects.toThrow();
    await expect(store.remove("workspace-1", "note-1")).rejects.toThrow();
    await expect(store.list()).rejects.toThrow();
    await expect(store.clear()).resolves.toEqual({ removed: 0, failed: 1 });
  });
});
