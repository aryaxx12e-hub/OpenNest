import { openText, sealText, type WorkspaceCryptoContext } from "@opennest/crypto";

import { isNoteDraft, type DraftStorage, type NoteDraft } from "./draft-journal";
import type { DraftClearResult, DraftStore } from "./draft-store";

const ENCRYPTED_DRAFT_PREFIX = "opennest:edraft:note:";

export function encryptedDraftKey(workspaceId: string, noteId: string): string {
  return `${ENCRYPTED_DRAFT_PREFIX}${workspaceId}:${noteId}`;
}

export function parseEncryptedDraftKey(
  key: string
): { workspaceId: string; noteId: string } | null {
  if (!key.startsWith(ENCRYPTED_DRAFT_PREFIX)) {
    return null;
  }

  const rest = key.slice(ENCRYPTED_DRAFT_PREFIX.length);
  const separator = rest.indexOf(":");

  if (separator <= 0 || separator === rest.length - 1) {
    return null;
  }

  return {
    workspaceId: rest.slice(0, separator),
    noteId: rest.slice(separator + 1),
  };
}

export interface CreateEncryptedDraftStoreOptions {
  storage: DraftStorage;
  context: WorkspaceCryptoContext;
}

function draftContext(context: WorkspaceCryptoContext, noteId: string) {
  return {
    workspaceId: context.workspaceId,
    purpose: "draft",
    entityType: "draft",
    entityId: noteId,
  };
}

function parseDraft(value: unknown, workspaceId: string, noteId: string): NoteDraft {
  if (!isNoteDraft(value)) {
    throw new Error("The encrypted draft record is invalid.");
  }

  if (value.workspaceId !== workspaceId || value.noteId !== noteId) {
    throw new Error("The encrypted draft record does not match its key.");
  }

  return value;
}

function removeQuietly(storage: DraftStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    return;
  }
}

export function createEncryptedDraftStore({
  storage,
  context,
}: CreateEncryptedDraftStoreOptions): DraftStore {
  let tail: Promise<void> = Promise.resolve();
  let lastFailure: unknown = null;

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation);

    tail = result.then(
      () => {
        lastFailure = null;
      },
      (error: unknown) => {
        lastFailure = error;
      }
    );

    return result;
  }

  async function flush(): Promise<void> {
    let current: Promise<void>;

    do {
      current = tail;
      await current;
    } while (current !== tail);

    if (lastFailure !== null) {
      throw lastFailure;
    }
  }

  async function decode(
    workspaceId: string,
    noteId: string,
    raw: string
  ): Promise<NoteDraft> {
    const plaintext = await openText({
      context: draftContext(context, noteId),
      dek: context.dek,
      keyId: context.keyId,
      envelope: raw,
    });

    return parseDraft(JSON.parse(plaintext) as unknown, workspaceId, noteId);
  }

  async function listDrafts(): Promise<NoteDraft[]> {
    await flush();

    const keys: string[] = [];

    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);

      if (key !== null && key.startsWith(ENCRYPTED_DRAFT_PREFIX)) {
        keys.push(key);
      }
    }

    const drafts: NoteDraft[] = [];

    for (const key of keys) {
      const keyParts = parseEncryptedDraftKey(key);

      if (keyParts === null || keyParts.workspaceId !== context.workspaceId) {
        continue;
      }

      const raw = storage.getItem(key);

      if (raw === null) {
        continue;
      }

      try {
        drafts.push(await decode(keyParts.workspaceId, keyParts.noteId, raw));
      } catch {
        removeQuietly(storage, key);
      }
    }

    return drafts;
  }

  return {
    list: listDrafts,
    async get(workspaceId, noteId) {
      if (workspaceId !== context.workspaceId) {
        return null;
      }

      await flush();

      const key = encryptedDraftKey(workspaceId, noteId);
      const raw = storage.getItem(key);

      if (raw === null) {
        return null;
      }

      try {
        return await decode(workspaceId, noteId, raw);
      } catch {
        removeQuietly(storage, key);
        return null;
      }
    },
    async put(draft) {
      if (!isNoteDraft(draft)) {
        throw new Error("The draft record is invalid.");
      }

      if (draft.workspaceId !== context.workspaceId) {
        throw new Error("The draft belongs to another workspace.");
      }

      await enqueue(async () => {
        const envelope = await sealText({
          context: draftContext(context, draft.noteId),
          dek: context.dek,
          keyId: context.keyId,
          plaintext: JSON.stringify(draft),
        });

        storage.setItem(encryptedDraftKey(draft.workspaceId, draft.noteId), envelope);
      });
    },
    async remove(workspaceId, noteId) {
      await enqueue(async () => {
        storage.removeItem(encryptedDraftKey(workspaceId, noteId));
      });
    },
    async clear(): Promise<DraftClearResult> {
      return enqueue(async () => {
        const keys: string[] = [];

        try {
          for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);

            if (key !== null && key.startsWith(ENCRYPTED_DRAFT_PREFIX)) {
              keys.push(key);
            }
          }
        } catch {
          return { removed: 0, failed: 1 };
        }

        let removed = 0;
        let failed = 0;

        for (const key of keys) {
          try {
            storage.removeItem(key);
            removed += 1;
          } catch {
            failed += 1;
          }
        }

        return { removed, failed };
      });
    },
    async count() {
      return (await listDrafts()).length;
    },
    async flush() {
      await flush();
    },
  };
}
