import { beforeEach, describe, expect, it } from "vitest";

import {
  clearAllNoteDrafts,
  clearNoteDraft,
  noteDraftKey,
  readDraftJournal,
  readNoteDraft,
  writeNoteDraft,
  type NoteDraft,
} from "../draft-journal";

const draft: NoteDraft = {
  version: 1,
  workspaceId: "workspace-1",
  noteId: "note-1",
  title: "A draft title",
  content: "Unsaved words",
  baseUpdatedAt: "2026-11-14T10:00:00.000Z",
  savedAt: 1_763_120_000_000,
};

beforeEach(() => {
  window.localStorage.clear();
});

describe("note draft journal", () => {
  it("round-trips a versioned draft under a workspace-scoped key", () => {
    expect(writeNoteDraft(window.localStorage, draft)).toBe(true);
    expect(readNoteDraft(window.localStorage, "workspace-1", "note-1")).toEqual(draft);
    expect(
      window.localStorage.getItem(noteDraftKey("workspace-1", "note-1"))
    ).not.toBeNull();
  });

  it("ignores and removes a corrupt draft", () => {
    window.localStorage.setItem(noteDraftKey("workspace-1", "note-1"), "{not json");

    expect(readNoteDraft(window.localStorage, "workspace-1", "note-1")).toBeNull();
    expect(window.localStorage.getItem(noteDraftKey("workspace-1", "note-1"))).toBeNull();
  });

  it("ignores a draft with an unsupported shape", () => {
    window.localStorage.setItem(
      noteDraftKey("workspace-1", "note-1"),
      JSON.stringify({ ...draft, version: 2 })
    );

    expect(readNoteDraft(window.localStorage, "workspace-1", "note-1")).toBeNull();
  });

  it("clears one note draft without touching another", () => {
    writeNoteDraft(window.localStorage, draft);
    writeNoteDraft(window.localStorage, { ...draft, noteId: "note-2" });

    expect(clearNoteDraft(window.localStorage, "workspace-1", "note-1")).toBe(true);

    expect(readNoteDraft(window.localStorage, "workspace-1", "note-1")).toBeNull();
    expect(readNoteDraft(window.localStorage, "workspace-1", "note-2")).not.toBeNull();
  });

  it("clears every draft owned by the app", () => {
    writeNoteDraft(window.localStorage, draft);
    writeNoteDraft(window.localStorage, { ...draft, noteId: "note-2" });
    window.localStorage.setItem("unrelated", "keep me");

    clearAllNoteDrafts(window.localStorage);

    expect(window.localStorage.getItem("unrelated")).toBe("keep me");
    expect(readNoteDraft(window.localStorage, "workspace-1", "note-1")).toBeNull();
    expect(readNoteDraft(window.localStorage, "workspace-1", "note-2")).toBeNull();
  });

  it("fails soft when storage refuses writes", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
      key: () => {
        throw new Error("blocked");
      },
      length: 0,
    };

    expect(writeNoteDraft(blocked, draft)).toBe(false);
    expect(readNoteDraft(blocked, "workspace-1", "note-1")).toBeNull();
    expect(clearNoteDraft(blocked, "workspace-1", "note-1")).toBe(false);
    expect(() => clearAllNoteDrafts(blocked)).not.toThrow();
  });

  it("reads every valid draft across workspaces and notes", () => {
    writeNoteDraft(window.localStorage, draft);
    writeNoteDraft(window.localStorage, { ...draft, noteId: "note-2" });
    writeNoteDraft(window.localStorage, {
      ...draft,
      workspaceId: "workspace-2",
      noteId: "note-3",
    });
    window.localStorage.setItem("unrelated", "keep me");

    const result = readDraftJournal(window.localStorage);

    expect(result.ok).toBe(true);
    expect(result.ok ? result.drafts : []).toEqual(
      expect.arrayContaining([
        draft,
        { ...draft, noteId: "note-2" },
        { ...draft, workspaceId: "workspace-2", noteId: "note-3" },
      ])
    );
    expect(result.ok ? result.drafts : []).toHaveLength(3);
    expect(window.localStorage.getItem("unrelated")).toBe("keep me");
  });

  it("skips a draft whose key does not match its workspace and note", () => {
    window.localStorage.setItem(
      noteDraftKey("workspace-1", "note-1"),
      JSON.stringify({ ...draft, workspaceId: "workspace-2", noteId: "note-2" })
    );

    const result = readDraftJournal(window.localStorage);

    expect(result.ok).toBe(true);
    expect(result.ok ? result.drafts : []).toEqual([]);
  });

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

  it("skips corrupt and unsupported draft entries", () => {
    writeNoteDraft(window.localStorage, draft);
    window.localStorage.setItem(noteDraftKey("workspace-1", "corrupt"), "{not json");
    window.localStorage.setItem(
      noteDraftKey("workspace-1", "future"),
      JSON.stringify({ ...draft, version: 2 })
    );

    const result = readDraftJournal(window.localStorage);

    expect(result.ok).toBe(true);
    expect(result.ok ? result.drafts : []).toEqual([draft]);
  });

  it("reports when the journal cannot be read", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
      key: () => {
        throw new Error("blocked");
      },
      get length(): number {
        throw new Error("blocked");
      },
    };

    const result = readDraftJournal(blocked);

    expect(result.ok).toBe(false);
  });
});
