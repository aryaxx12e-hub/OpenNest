import { beforeEach, describe, expect, it } from "vitest";

import {
  importAesGcmKey,
  randomBytes,
  type WorkspaceCryptoContext,
} from "@opennest/crypto";

import type { DraftStorage, NoteDraft } from "@/lib/autosave/draft-journal";
import {
  createEncryptedDraftStore,
  encryptedDraftKey,
} from "@/lib/autosave/encrypted-draft-store";

import {
  discardDraftRotation,
  finalizeDraftRotation,
  readDraftRotationJournal,
  stageDraftRotation,
} from "../rotation-journal";

const WORKSPACE_ID = "workspace-1";
const TEMP_PREFIX = "opennest:rdraft:";

const drafts: NoteDraft[] = [
  {
    version: 1,
    workspaceId: WORKSPACE_ID,
    noteId: "note-1",
    title: "First draft",
    content: "Unsaved first body",
    baseTitle: "First note",
    baseContent: "Saved first body",
    baseUpdatedAt: "2026-11-17T10:00:00.000Z",
    savedAt: 1_763_120_000_000,
  },
  {
    version: 1,
    workspaceId: WORKSPACE_ID,
    noteId: "note-2",
    title: "Second draft",
    content: "Unsaved second body",
    baseTitle: "Second note",
    baseContent: "Saved second body",
    baseUpdatedAt: "2026-11-17T10:05:00.000Z",
    savedAt: 1_763_120_060_000,
  },
];

async function context(kid: string): Promise<WorkspaceCryptoContext> {
  return {
    workspaceId: WORKSPACE_ID,
    keyId: kid,
    dek: await importAesGcmKey(randomBytes(32)),
  };
}

async function seed(source: WorkspaceCryptoContext): Promise<void> {
  const store = createEncryptedDraftStore({
    storage: window.localStorage,
    context: source,
  });

  for (const draft of drafts) {
    await store.put(draft);
  }
}

function tempCount(): number {
  let count = 0;

  for (let index = 0; index < window.localStorage.length; index += 1) {
    if (window.localStorage.key(index)?.startsWith(TEMP_PREFIX) === true) {
      count += 1;
    }
  }

  return count;
}

class FaultyStorage implements DraftStorage {
  failSet: ((key: string, count: number) => boolean) | null = null;
  failRemove: ((key: string, count: number) => boolean) | null = null;
  setCount = 0;
  removeCount = 0;

  get length(): number {
    return window.localStorage.length;
  }

  getItem(key: string): string | null {
    return window.localStorage.getItem(key);
  }

  setItem(key: string, value: string): void {
    this.setCount += 1;

    if (this.failSet?.(key, this.setCount) === true) {
      throw new Error("set blocked");
    }

    window.localStorage.setItem(key, value);
  }

  removeItem(key: string): void {
    this.removeCount += 1;

    if (this.failRemove?.(key, this.removeCount) === true) {
      throw new Error("remove blocked");
    }

    window.localStorage.removeItem(key);
  }

  key(index: number): string | null {
    return window.localStorage.key(index);
  }
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("draft rotation journal", () => {
  it("stages drafts under the target key without changing the originals", async () => {
    const from = await context("old-kid");
    const to = await context("new-kid");
    await seed(from);

    const staged = await stageDraftRotation({
      storage: window.localStorage,
      from,
      to,
    });

    expect(staged.count).toBe(2);
    expect(staged.journal.ready).toBe(true);
    expect(readDraftRotationJournal(window.localStorage, WORKSPACE_ID)).toEqual(
      staged.journal
    );
    expect(tempCount()).toBe(2);

    const oldStore = createEncryptedDraftStore({
      storage: window.localStorage,
      context: from,
    });
    expect(await oldStore.list()).toHaveLength(2);

    for (const draft of drafts) {
      const key = encryptedDraftKey(WORKSPACE_ID, draft.noteId);
      expect(window.localStorage.getItem(key)).toMatch(/^enc1:/);
      expect(window.localStorage.getItem(key)).not.toContain(draft.content);
    }
  });

  it("finalizes staged drafts under the new key and clears the journal", async () => {
    const from = await context("old-kid");
    const to = await context("new-kid");
    await seed(from);

    const staged = await stageDraftRotation({
      storage: window.localStorage,
      from,
      to,
    });
    await finalizeDraftRotation({
      storage: window.localStorage,
      journal: staged.journal,
      context: to,
    });

    expect(readDraftRotationJournal(window.localStorage, WORKSPACE_ID)).toBeNull();
    expect(tempCount()).toBe(0);

    const newStore = createEncryptedDraftStore({
      storage: window.localStorage,
      context: to,
    });
    expect(
      (await newStore.list()).sort((a, b) => a.noteId.localeCompare(b.noteId))
    ).toEqual([...drafts].sort((a, b) => a.noteId.localeCompare(b.noteId)));
  });

  it("resumes a partially staged rotation without touching encrypted drafts", async () => {
    const from = await context("old-kid");
    const to = await context("new-kid");
    await seed(from);
    const storage = new FaultyStorage();
    let tempWrites = 0;
    storage.failSet = (key) => {
      if (!key.startsWith(TEMP_PREFIX)) {
        return false;
      }

      tempWrites += 1;

      return tempWrites === 2;
    };

    await expect(stageDraftRotation({ storage, from, to })).rejects.toMatchObject({
      code: "rotation_state",
    });

    expect(readDraftRotationJournal(storage, WORKSPACE_ID)?.ready).toBe(false);
    expect(
      await createEncryptedDraftStore({
        storage,
        context: from,
      }).list()
    ).toHaveLength(2);

    storage.failSet = null;
    const staged = await stageDraftRotation({ storage, from, to });
    expect(staged.journal.ready).toBe(true);
    await finalizeDraftRotation({ storage, journal: staged.journal, context: to });

    expect(readDraftRotationJournal(storage, WORKSPACE_ID)).toBeNull();
    expect(
      await createEncryptedDraftStore({
        storage,
        context: to,
      }).list()
    ).toHaveLength(2);
  });

  it("retries a partially finalized rotation without losing drafts", async () => {
    const from = await context("old-kid");
    const to = await context("new-kid");
    await seed(from);
    const storage = new FaultyStorage();
    const staged = await stageDraftRotation({ storage, from, to });
    let mainWrites = 0;
    storage.failSet = (key) => {
      if (key.startsWith(TEMP_PREFIX) || key.startsWith("opennest:rotation:")) {
        return false;
      }

      mainWrites += 1;

      return mainWrites === 2;
    };

    await expect(
      finalizeDraftRotation({ storage, journal: staged.journal, context: to })
    ).rejects.toMatchObject({ code: "rotation_state" });

    expect(readDraftRotationJournal(storage, WORKSPACE_ID)).toEqual(staged.journal);

    storage.failSet = null;
    const finalized = await finalizeDraftRotation({
      storage,
      journal: staged.journal,
      context: to,
    });

    expect(finalized.count).toBe(1);
    expect(readDraftRotationJournal(storage, WORKSPACE_ID)).toBeNull();
    expect(
      await createEncryptedDraftStore({
        storage,
        context: to,
      }).list()
    ).toHaveLength(2);
  });

  it("discards staged drafts while keeping the originals readable", async () => {
    const from = await context("old-kid");
    const to = await context("new-kid");
    await seed(from);
    await stageDraftRotation({ storage: window.localStorage, from, to });

    await discardDraftRotation(window.localStorage, WORKSPACE_ID);

    expect(readDraftRotationJournal(window.localStorage, WORKSPACE_ID)).toBeNull();
    expect(tempCount()).toBe(0);
    expect(
      await createEncryptedDraftStore({
        storage: window.localStorage,
        context: from,
      }).list()
    ).toHaveLength(2);
  });

  it("rejects a second rotation journal for different keys", async () => {
    const from = await context("old-kid");
    const to = await context("new-kid");
    const other = await context("other-kid");
    await seed(from);
    await stageDraftRotation({ storage: window.localStorage, from, to });

    await expect(
      stageDraftRotation({ storage: window.localStorage, from, to: other })
    ).rejects.toMatchObject({ code: "rotation_state" });
  });

  it("fails closed when the journal is malformed", async () => {
    window.localStorage.setItem(
      "opennest:rotation:draft-journal:v1",
      JSON.stringify({ version: 1, workspaceId: WORKSPACE_ID })
    );

    expect(() =>
      readDraftRotationJournal(window.localStorage, WORKSPACE_ID)
    ).toThrowError(expect.objectContaining({ code: "rotation_state" }));
  });
});
