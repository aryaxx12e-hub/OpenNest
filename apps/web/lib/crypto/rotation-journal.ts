import { CryptoError, type WorkspaceCryptoContext } from "@opennest/crypto";

import type { DraftStorage, NoteDraft } from "@/lib/autosave/draft-journal";
import { createEncryptedDraftStore } from "@/lib/autosave/encrypted-draft-store";

const JOURNAL_KEY = "opennest:rotation:draft-journal:v1";
const TEMP_PREFIX = "opennest:rdraft:";

export interface DraftRotationJournal {
  version: 1;
  workspaceId: string;
  fromKid: string;
  toKid: string;
  ready: boolean;
  createdAt: number;
}

export interface StageDraftRotationInput {
  storage: DraftStorage;
  from: WorkspaceCryptoContext;
  to: WorkspaceCryptoContext;
  now?: () => number;
}

export interface FinalizeDraftRotationInput {
  storage: DraftStorage;
  journal: DraftRotationJournal;
  context: WorkspaceCryptoContext;
}

function rotationError(message: string, cause?: unknown): CryptoError {
  return new CryptoError(
    "rotation_state",
    message,
    cause === undefined ? undefined : { cause }
  );
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw rotationError(`The draft rotation ${label} is invalid`);
  }

  return value;
}

function parseJournal(raw: string): DraftRotationJournal {
  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw rotationError("The draft rotation journal is not valid JSON", error);
  }

  if (typeof value !== "object" || value === null) {
    throw rotationError("The draft rotation journal is invalid");
  }

  const record = value as Record<string, unknown>;
  const workspaceId = requireString(record.workspaceId, "workspace");
  const fromKid = requireString(record.fromKid, "source key");
  const toKid = requireString(record.toKid, "target key");

  if (record.version !== 1 || (record.ready !== true && record.ready !== false)) {
    throw rotationError("The draft rotation journal version is invalid");
  }

  if (fromKid === toKid) {
    throw rotationError("The draft rotation keys must differ");
  }

  if (
    typeof record.createdAt !== "number" ||
    !Number.isFinite(record.createdAt) ||
    record.createdAt < 0
  ) {
    throw rotationError("The draft rotation timestamp is invalid");
  }

  return {
    version: 1,
    workspaceId,
    fromKid,
    toKid,
    ready: record.ready,
    createdAt: record.createdAt,
  };
}

export function readDraftRotationJournal(
  storage: DraftStorage,
  workspaceId: string
): DraftRotationJournal | null {
  const raw = storage.getItem(JOURNAL_KEY);

  if (raw === null) {
    return null;
  }

  const journal = parseJournal(raw);

  if (journal.workspaceId !== workspaceId) {
    return null;
  }

  return journal;
}

function writeJournal(storage: DraftStorage, journal: DraftRotationJournal): void {
  try {
    storage.setItem(JOURNAL_KEY, JSON.stringify(journal));
  } catch (error) {
    throw rotationError("The draft rotation journal could not be written", error);
  }
}

function clearJournal(storage: DraftStorage): void {
  try {
    storage.removeItem(JOURNAL_KEY);
  } catch (error) {
    throw rotationError("The draft rotation journal could not be cleared", error);
  }
}

function tempKeys(storage: DraftStorage): string[] {
  const keys: string[] = [];

  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);

      if (key !== null && key.startsWith(TEMP_PREFIX)) {
        keys.push(key);
      }
    }
  } catch (error) {
    throw rotationError("The draft rotation storage could not be read", error);
  }

  return keys;
}

function createTempStorage(storage: DraftStorage): DraftStorage {
  return {
    get length(): number {
      return tempKeys(storage).length;
    },
    getItem(key) {
      return storage.getItem(`${TEMP_PREFIX}${key}`);
    },
    setItem(key, value) {
      storage.setItem(`${TEMP_PREFIX}${key}`, value);
    },
    removeItem(key) {
      storage.removeItem(`${TEMP_PREFIX}${key}`);
    },
    key(index) {
      const key = tempKeys(storage)[index];

      return key === undefined ? null : key.slice(TEMP_PREFIX.length);
    },
  };
}

function sameDraft(left: NoteDraft, right: NoteDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function stageDraftRotation(
  input: StageDraftRotationInput
): Promise<{ journal: DraftRotationJournal; count: number }> {
  if (
    input.from.workspaceId !== input.to.workspaceId ||
    input.from.keyId === input.to.keyId
  ) {
    throw rotationError("The draft rotation context is invalid");
  }

  const existing = readDraftRotationJournal(input.storage, input.from.workspaceId);

  if (
    existing !== null &&
    (existing.fromKid !== input.from.keyId || existing.toKid !== input.to.keyId)
  ) {
    throw rotationError("Another draft rotation is already journaled");
  }

  const journal: DraftRotationJournal = {
    version: 1,
    workspaceId: input.from.workspaceId,
    fromKid: input.from.keyId,
    toKid: input.to.keyId,
    ready: false,
    createdAt: existing?.createdAt ?? (input.now ?? Date.now)(),
  };

  writeJournal(input.storage, journal);

  const source = createEncryptedDraftStore({
    storage: input.storage,
    context: input.from,
  });
  const destination = createEncryptedDraftStore({
    storage: createTempStorage(input.storage),
    context: input.to,
  });
  let drafts: NoteDraft[];

  try {
    drafts = await source.list();
  } catch (error) {
    throw rotationError("Encrypted drafts could not be read for rotation", error);
  }

  for (const draft of drafts) {
    try {
      await destination.put(draft);
      const stored = await destination.get(draft.workspaceId, draft.noteId);

      if (stored === null || !sameDraft(stored, draft)) {
        throw new Error("The rotated draft did not match its source");
      }
    } catch (error) {
      throw rotationError("An encrypted draft could not be rotated", error);
    }
  }

  const ready = { ...journal, ready: true };
  writeJournal(input.storage, ready);

  return { journal: ready, count: drafts.length };
}

export async function finalizeDraftRotation(
  input: FinalizeDraftRotationInput
): Promise<{ count: number }> {
  if (
    input.journal.workspaceId !== input.context.workspaceId ||
    input.journal.toKid !== input.context.keyId
  ) {
    throw rotationError("The draft rotation does not match the active key");
  }

  if (!input.journal.ready) {
    throw rotationError("The draft rotation is not ready to finalize");
  }

  const source = createEncryptedDraftStore({
    storage: createTempStorage(input.storage),
    context: input.context,
  });
  const destination = createEncryptedDraftStore({
    storage: input.storage,
    context: input.context,
  });
  let drafts: NoteDraft[];

  try {
    drafts = await source.list();
  } catch (error) {
    throw rotationError("Rotated drafts could not be read", error);
  }

  for (const draft of drafts) {
    try {
      await destination.put(draft);
      const stored = await destination.get(draft.workspaceId, draft.noteId);

      if (stored === null || !sameDraft(stored, draft)) {
        throw new Error("The finalized draft did not match its source");
      }

      await source.remove(draft.workspaceId, draft.noteId);
    } catch (error) {
      throw rotationError("A rotated draft could not be finalized", error);
    }
  }

  clearJournal(input.storage);

  return { count: drafts.length };
}

export async function discardDraftRotation(
  storage: DraftStorage,
  workspaceId: string
): Promise<{ removed: number }> {
  const journal = readDraftRotationJournal(storage, workspaceId);
  let removed = 0;

  for (const key of tempKeys(storage)) {
    try {
      storage.removeItem(key);
      removed += 1;
    } catch (error) {
      throw rotationError("A temporary rotated draft could not be removed", error);
    }
  }

  if (journal !== null) {
    clearJournal(storage);
  }

  return { removed };
}
