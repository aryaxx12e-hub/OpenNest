import { beforeEach, describe, expect, it } from "vitest";

import {
  importAesGcmKey,
  randomBytes,
  type WorkspaceCryptoContext,
} from "@opennest/crypto";

import {
  noteDraftKey,
  writeNoteDraft,
  type DraftStorage,
  type NoteDraft,
} from "../draft-journal";
import { createEncryptedDraftStore, encryptedDraftKey } from "../encrypted-draft-store";

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

async function context(workspaceId = "workspace-1"): Promise<WorkspaceCryptoContext> {
  return {
    workspaceId,
    keyId: "kid-1",
    dek: await importAesGcmKey(randomBytes(32)),
  };
}

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

describe("encrypted draft store", () => {
  it("encrypts the complete draft at rest and round-trips it", async () => {
    const store = createEncryptedDraftStore({
      storage: window.localStorage,
      context: await context(),
    });

    await store.put(draft);

    const key = encryptedDraftKey("workspace-1", "note-1");
    const raw = window.localStorage.getItem(key);

    expect(raw).toMatch(/^enc1:/);
    expect(raw).not.toContain("Draft title");
    expect(raw).not.toContain("Unsaved words");
    expect(raw).not.toContain("Saved title");
    expect(raw).not.toContain("Saved words");
    expect(window.localStorage.getItem(noteDraftKey("workspace-1", "note-1"))).toBeNull();

    await expect(store.get("workspace-1", "note-1")).resolves.toEqual(draft);
    await expect(store.list()).resolves.toEqual([draft]);
    await expect(store.count()).resolves.toBe(1);
  });

  it("serializes pending writes so the latest draft wins", async () => {
    const store = createEncryptedDraftStore({
      storage: window.localStorage,
      context: await context(),
    });

    void store.put({ ...draft, content: "older" });
    void store.put({ ...draft, content: "newer" });
    await expect(store.flush()).resolves.toBeUndefined();

    await expect(store.get("workspace-1", "note-1")).resolves.toMatchObject({
      content: "newer",
    });
  });

  it("removes a draft moved to another note", async () => {
    const store = createEncryptedDraftStore({
      storage: window.localStorage,
      context: await context(),
    });
    await store.put(draft);

    const firstKey = encryptedDraftKey("workspace-1", "note-1");
    const secondKey = encryptedDraftKey("workspace-1", "note-2");
    window.localStorage.setItem(secondKey, window.localStorage.getItem(firstKey)!);
    window.localStorage.removeItem(firstKey);

    await expect(store.get("workspace-1", "note-2")).resolves.toBeNull();
    await expect(store.list()).resolves.toEqual([]);
    expect(window.localStorage.getItem(secondKey)).toBeNull();
  });

  it("ignores a draft encrypted with a different key", async () => {
    const writer = createEncryptedDraftStore({
      storage: window.localStorage,
      context: await context(),
    });
    await writer.put(draft);

    const reader = createEncryptedDraftStore({
      storage: window.localStorage,
      context: await context(),
    });

    await expect(reader.get("workspace-1", "note-1")).resolves.toBeNull();
    expect(
      window.localStorage.getItem(encryptedDraftKey("workspace-1", "note-1"))
    ).toBeNull();
  });

  it("does not read or overwrite the plaintext draft namespace", async () => {
    writeNoteDraft(window.localStorage, draft);
    const store = createEncryptedDraftStore({
      storage: window.localStorage,
      context: await context(),
    });

    await expect(store.get("workspace-1", "note-1")).resolves.toBeNull();
    await expect(store.list()).resolves.toEqual([]);
    await store.clear();

    expect(
      window.localStorage.getItem(noteDraftKey("workspace-1", "note-1"))
    ).not.toBeNull();
  });

  it("removes and clears encrypted drafts across workspaces", async () => {
    const current = createEncryptedDraftStore({
      storage: window.localStorage,
      context: await context(),
    });
    const other = createEncryptedDraftStore({
      storage: window.localStorage,
      context: await context("workspace-2"),
    });
    await current.put(draft);
    await current.put({ ...draft, noteId: "note-2" });
    await other.put({ ...draft, workspaceId: "workspace-2", noteId: "note-3" });

    await current.remove("workspace-1", "note-1");

    await expect(current.count()).resolves.toBe(1);
    await expect(current.clear()).resolves.toEqual({ removed: 2, failed: 0 });
    expect(window.localStorage.length).toBe(0);
  });

  it("rejects a draft for another workspace", async () => {
    const store = createEncryptedDraftStore({
      storage: window.localStorage,
      context: await context(),
    });

    await expect(store.put({ ...draft, workspaceId: "workspace-2" })).rejects.toThrow();
  });

  it("reports storage failures and rejects unverified flushes", async () => {
    const storage = blockedStorage();
    const store = createEncryptedDraftStore({
      storage,
      context: await context(),
    });

    await expect(store.put(draft)).rejects.toThrow();
    await expect(store.flush()).rejects.toThrow();
    await expect(store.get("workspace-1", "note-1")).rejects.toThrow();
    await expect(store.list()).rejects.toThrow();
    await expect(store.clear()).resolves.toEqual({ removed: 0, failed: 1 });
  });
});
