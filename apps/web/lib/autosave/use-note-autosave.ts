"use client";

import type { Note } from "@opennest/core";
import { useCallback, useEffect, useRef, useState } from "react";

import { errorKey } from "../errors";
import {
  clearNoteDraft,
  readNoteDraft,
  writeNoteDraft,
  type DraftStorage,
  type NoteDraft,
} from "./draft-journal";
import { SAVE_RETRY_DELAYS_MS, isRetryableSaveError } from "./retry";
import type { SaveCoordinator, SaveFlushResult } from "./save-coordinator";

export interface NoteSavePatch {
  title: string;
  content: string;
}

export interface NoteAutosaveOptions {
  note: Note;
  save: (patch: NoteSavePatch) => Promise<Note>;
  coordinator: SaveCoordinator;
  storage?: DraftStorage | null;
}

export interface NoteAutosave {
  title: string;
  content: string;
  updatedAt: string;
  saving: boolean;
  dirty: boolean;
  titleMissing: boolean;
  saveError: string | null;
  draftError: string | null;
  draftRestored: boolean;
  setTitle: (value: string) => void;
  setContent: (value: string) => void;
  flush: () => Promise<SaveFlushResult>;
  deactivate: () => void;
}

const IDLE_DELAY_MS = 500;
const DRAFT_DELAY_MS = 200;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface InitialState {
  title: string;
  content: string;
  draftRestored: boolean;
  ignoredDraft: NoteDraft | null;
}

function isNewerDraft(note: Note, draft: NoteDraft): boolean {
  if (draft.title === note.title && draft.content === note.content) {
    return false;
  }

  if (
    draft.baseTitle !== undefined &&
    draft.baseContent !== undefined &&
    draft.baseTitle === note.title &&
    draft.baseContent === note.content
  ) {
    return true;
  }

  const updatedAt = Date.parse(note.updatedAt);

  return Number.isNaN(updatedAt) || draft.savedAt >= updatedAt;
}

function readInitialState(note: Note, storage: DraftStorage | null): InitialState {
  const draft =
    storage === null ? null : readNoteDraft(storage, note.workspaceId, note.id);

  if (draft === null) {
    return {
      title: note.title,
      content: note.content,
      draftRestored: false,
      ignoredDraft: null,
    };
  }

  if (!isNewerDraft(note, draft)) {
    return {
      title: note.title,
      content: note.content,
      draftRestored: false,
      ignoredDraft: draft,
    };
  }

  return {
    title: draft.title,
    content: draft.content,
    draftRestored: true,
    ignoredDraft: null,
  };
}

interface ResolvedDraftStorage {
  storage: DraftStorage | null;
  failed: boolean;
}

function resolveDraftStorage(
  storageOption: DraftStorage | null | undefined
): ResolvedDraftStorage {
  if (storageOption !== undefined) {
    return { storage: storageOption, failed: false };
  }

  if (typeof window === "undefined") {
    return { storage: null, failed: false };
  }

  try {
    const storage = window.localStorage;
    void storage.length;

    return { storage, failed: false };
  } catch {
    return { storage: null, failed: true };
  }
}

export function useNoteAutosave({
  note,
  save,
  coordinator,
  storage: storageOption,
}: NoteAutosaveOptions): NoteAutosave {
  const [draftStorage] = useState(() => resolveDraftStorage(storageOption));
  const storage = draftStorage.storage;
  const [initial] = useState(() => readInitialState(note, storage));

  const [title, setTitleState] = useState(initial.title);
  const [content, setContentState] = useState(initial.content);
  const [saved, setSaved] = useState({ title: note.title, content: note.content });
  const [updatedAt, setUpdatedAt] = useState<string>(note.updatedAt);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(
    draftStorage.failed ? "notes.draftError" : null
  );
  const [draftRestored, setDraftRestored] = useState(initial.draftRestored);

  const titleRef = useRef(title);
  const contentRef = useRef(content);
  const savedRef = useRef(saved);
  const baseUpdatedAtRef = useRef(note.updatedAt);
  const revisionRef = useRef(0);
  const activeRef = useRef(true);
  const mountedRef = useRef(true);
  const savingRef = useRef(false);
  const inFlightRef = useRef<Promise<SaveFlushResult> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  const hasUnsaved = useCallback(
    () =>
      titleRef.current !== savedRef.current.title ||
      contentRef.current !== savedRef.current.content,
    []
  );

  const clearDraft = useCallback(() => {
    if (storage !== null) {
      clearNoteDraft(storage, note.workspaceId, note.id);
    }
  }, [storage, note.workspaceId, note.id]);

  const writeDraftNow = useCallback((): boolean => {
    if (!activeRef.current) {
      return true;
    }

    if (storage === null) {
      if (draftStorage.failed && mountedRef.current) {
        setDraftError("notes.draftError");
      }

      return !draftStorage.failed;
    }

    if (!hasUnsaved()) {
      clearDraft();

      if (mountedRef.current) {
        setDraftError(null);
      }

      return true;
    }

    const written = writeNoteDraft(storage, {
      version: 1,
      workspaceId: note.workspaceId,
      noteId: note.id,
      title: titleRef.current,
      content: contentRef.current,
      baseTitle: savedRef.current.title,
      baseContent: savedRef.current.content,
      baseUpdatedAt: baseUpdatedAtRef.current,
      savedAt: Date.now(),
    });

    if (mountedRef.current) {
      setDraftError(written ? null : "notes.draftError");
    }

    return written;
  }, [storage, draftStorage.failed, note.workspaceId, note.id, hasUnsaved, clearDraft]);

  const flush = useCallback(async (): Promise<SaveFlushResult> => {
    if (!activeRef.current) {
      return { ok: true };
    }

    if (inFlightRef.current !== null) {
      return inFlightRef.current;
    }

    const request = (async (): Promise<SaveFlushResult> => {
      savingRef.current = true;

      if (mountedRef.current) {
        setSaving(true);
        setSaveError(null);
      }

      let attempt = 0;

      try {
        for (;;) {
          if (!activeRef.current) {
            return { ok: true };
          }

          const snapshot = {
            title: titleRef.current,
            content: contentRef.current,
          };

          if (
            snapshot.title === savedRef.current.title &&
            snapshot.content === savedRef.current.content
          ) {
            clearDraft();

            if (mountedRef.current) {
              setDraftError(null);
            }

            return { ok: true };
          }

          if (snapshot.title.trim().length === 0) {
            writeDraftNow();
            return { ok: false, error: new Error("Note title is required.") };
          }

          const revision = revisionRef.current;

          let updated: Note;

          try {
            updated = await saveRef.current(snapshot);
          } catch (caught) {
            if (
              activeRef.current &&
              attempt < SAVE_RETRY_DELAYS_MS.length &&
              isRetryableSaveError(caught)
            ) {
              const delay = SAVE_RETRY_DELAYS_MS[attempt]!;
              attempt += 1;
              writeDraftNow();
              await wait(delay);
              continue;
            }

            throw caught;
          }

          attempt = 0;
          savedRef.current = { title: updated.title, content: updated.content };
          baseUpdatedAtRef.current = updated.updatedAt;

          if (mountedRef.current) {
            setSaved(savedRef.current);
            setUpdatedAt(updated.updatedAt);
            setDraftRestored(false);
            setSaveError(null);
            setDraftError(null);
          }

          if (revision === revisionRef.current) {
            titleRef.current = updated.title;
            contentRef.current = updated.content;

            if (mountedRef.current) {
              setTitleState(updated.title);
              setContentState(updated.content);
            }

            clearDraft();

            if (mountedRef.current) {
              setDraftError(null);
            }

            return { ok: true };
          }

          writeDraftNow();
        }
      } catch (caught) {
        writeDraftNow();

        if (mountedRef.current) {
          setSaveError(errorKey(caught));
        }

        return { ok: false, error: caught };
      } finally {
        savingRef.current = false;

        if (mountedRef.current) {
          setSaving(false);
        }
      }
    })().finally(() => {
      if (inFlightRef.current === request) {
        inFlightRef.current = null;
      }
    });

    inFlightRef.current = request;
    return request;
  }, [clearDraft, writeDraftNow]);

  const setTitle = useCallback((value: string) => {
    titleRef.current = value;
    revisionRef.current += 1;
    setTitleState(value);
  }, []);

  const setContent = useCallback((value: string) => {
    contentRef.current = value;
    revisionRef.current += 1;
    setContentState(value);
  }, []);

  const deactivate = useCallback(() => {
    activeRef.current = false;
    clearDraft();
  }, [clearDraft]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (initial.ignoredDraft !== null) {
      clearDraft();
    }
  }, [initial.ignoredDraft, clearDraft]);

  useEffect(() => {
    const timer = setTimeout(writeDraftNow, DRAFT_DELAY_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [title, content, writeDraftNow]);

  useEffect(() => {
    if (!hasUnsaved()) {
      return;
    }

    const timer = setTimeout(() => {
      void flush();
    }, IDLE_DELAY_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [title, content, hasUnsaved, flush]);

  useEffect(() => {
    const unregister = coordinator.register({
      id: `note-autosave:${note.workspaceId}:${note.id}`,
      flush: async () => {
        const result = await flush();

        if (!result.ok) {
          throw result.error;
        }
      },
      isDirty: hasUnsaved,
    });

    return () => {
      mountedRef.current = false;
      writeDraftNow();
      void flush();
      unregister();
    };
  }, [coordinator, note.workspaceId, note.id, flush, hasUnsaved, writeDraftNow]);

  useEffect(() => {
    function flushHiddenPage() {
      writeDraftNow();
      void flush();
    }

    function flushWhenHidden() {
      if (document.visibilityState === "hidden") {
        flushHiddenPage();
      }
    }

    function flushWhenOnline() {
      if (hasUnsaved()) {
        void flush();
      }
    }

    window.addEventListener("pagehide", flushHiddenPage);
    document.addEventListener("visibilitychange", flushWhenHidden);
    window.addEventListener("online", flushWhenOnline);

    return () => {
      window.removeEventListener("pagehide", flushHiddenPage);
      document.removeEventListener("visibilitychange", flushWhenHidden);
      window.removeEventListener("online", flushWhenOnline);
    };
  }, [flush, hasUnsaved, writeDraftNow]);

  useEffect(() => {
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasUnsaved() && !savingRef.current) {
        return;
      }

      writeDraftNow();
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", warnBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
    };
  }, [hasUnsaved, writeDraftNow]);

  return {
    title,
    content,
    updatedAt,
    saving,
    dirty: title !== saved.title || content !== saved.content,
    titleMissing: title.trim().length === 0,
    saveError,
    draftError,
    draftRestored,
    setTitle,
    setContent,
    flush,
    deactivate,
  };
}
