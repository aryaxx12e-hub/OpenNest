export interface DraftStorage {
  readonly length: number;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
}

export interface NoteDraft {
  version: 1;
  workspaceId: string;
  noteId: string;
  title: string;
  content: string;
  baseTitle?: string;
  baseContent?: string;
  baseUpdatedAt: string;
  savedAt: number;
}

const DRAFT_PREFIX = "opennest:draft:note:";

export function noteDraftKey(workspaceId: string, noteId: string): string {
  return `${DRAFT_PREFIX}${workspaceId}:${noteId}`;
}

export function parseNoteDraftKey(
  key: string
): { workspaceId: string; noteId: string } | null {
  if (!key.startsWith(DRAFT_PREFIX)) {
    return null;
  }

  const rest = key.slice(DRAFT_PREFIX.length);
  const separator = rest.indexOf(":");

  if (separator <= 0 || separator === rest.length - 1) {
    return null;
  }

  return {
    workspaceId: rest.slice(0, separator),
    noteId: rest.slice(separator + 1),
  };
}

function isNoteDraft(value: unknown): value is NoteDraft {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const draft = value as Record<string, unknown>;

  return (
    draft.version === 1 &&
    typeof draft.workspaceId === "string" &&
    typeof draft.noteId === "string" &&
    typeof draft.title === "string" &&
    typeof draft.content === "string" &&
    (draft.baseTitle === undefined || typeof draft.baseTitle === "string") &&
    (draft.baseContent === undefined || typeof draft.baseContent === "string") &&
    typeof draft.baseUpdatedAt === "string" &&
    typeof draft.savedAt === "number" &&
    Number.isFinite(draft.savedAt)
  );
}

export function readNoteDraft(
  storage: DraftStorage,
  workspaceId: string,
  noteId: string
): NoteDraft | null {
  const key = noteDraftKey(workspaceId, noteId);
  let parsed: unknown = null;

  try {
    const stored = storage.getItem(key);

    if (stored === null) {
      return null;
    }

    parsed = JSON.parse(stored);
  } catch {
    parsed = null;
  }

  if (
    isNoteDraft(parsed) &&
    parsed.workspaceId === workspaceId &&
    parsed.noteId === noteId
  ) {
    return parsed;
  }

  try {
    storage.removeItem(key);
  } catch {
    return null;
  }

  return null;
}

export type DraftJournal =
  { ok: true; drafts: NoteDraft[] } | { ok: false; error: unknown };

export function readDraftJournal(storage: DraftStorage): DraftJournal {
  const keys: string[] = [];

  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);

      if (key !== null && key.startsWith(DRAFT_PREFIX)) {
        keys.push(key);
      }
    }
  } catch (error) {
    return { ok: false, error };
  }

  const drafts: NoteDraft[] = [];

  for (const key of keys) {
    const keyParts = parseNoteDraftKey(key);

    if (keyParts === null) {
      continue;
    }

    let stored: string | null;

    try {
      stored = storage.getItem(key);
    } catch (error) {
      return { ok: false, error };
    }

    if (stored === null) {
      continue;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(stored);
    } catch {
      continue;
    }

    if (
      isNoteDraft(parsed) &&
      parsed.workspaceId === keyParts.workspaceId &&
      parsed.noteId === keyParts.noteId
    ) {
      drafts.push(parsed);
    }
  }

  return { ok: true, drafts };
}

export function writeNoteDraft(storage: DraftStorage, draft: NoteDraft): boolean {
  try {
    storage.setItem(noteDraftKey(draft.workspaceId, draft.noteId), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearNoteDraft(
  storage: DraftStorage,
  workspaceId: string,
  noteId: string
): boolean {
  try {
    storage.removeItem(noteDraftKey(workspaceId, noteId));
    return true;
  } catch {
    return false;
  }
}

export function clearAllNoteDrafts(storage: DraftStorage): {
  removed: number;
  failed: number;
} {
  const keys: string[] = [];

  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);

      if (key !== null && key.startsWith(DRAFT_PREFIX)) {
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
}
