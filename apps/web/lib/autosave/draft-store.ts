import {
  clearAllNoteDrafts,
  clearNoteDraft,
  readDraftJournal,
  readNoteDraft,
  writeNoteDraft,
  type DraftStorage,
  type NoteDraft,
} from "./draft-journal";

export interface DraftClearResult {
  removed: number;
  failed: number;
}

export interface DraftStore {
  list(): Promise<NoteDraft[]>;
  get(workspaceId: string, noteId: string): Promise<NoteDraft | null>;
  put(draft: NoteDraft): Promise<void>;
  remove(workspaceId: string, noteId: string): Promise<void>;
  clear(): Promise<DraftClearResult>;
  count(): Promise<number>;
  flush(): Promise<void>;
}

export function createPlainDraftStore(storage: DraftStorage): DraftStore {
  return {
    async list() {
      const journal = readDraftJournal(storage);

      if (!journal.ok) {
        throw journal.error;
      }

      return journal.drafts;
    },
    async get(workspaceId, noteId) {
      return readNoteDraft(storage, workspaceId, noteId);
    },
    async put(draft) {
      if (!writeNoteDraft(storage, draft)) {
        throw new Error("The recovery draft could not be written.");
      }
    },
    async remove(workspaceId, noteId) {
      if (!clearNoteDraft(storage, workspaceId, noteId)) {
        throw new Error("The recovery draft could not be removed.");
      }
    },
    async clear() {
      return clearAllNoteDrafts(storage);
    },
    async count() {
      const journal = readDraftJournal(storage);

      return journal.ok ? journal.drafts.length : 0;
    },
    async flush() {
      return undefined;
    },
  };
}

export function createBrowserPlainDraftStore(): DraftStore | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const storage = window.localStorage;
    void storage.length;

    return createPlainDraftStore(storage);
  } catch {
    return null;
  }
}
