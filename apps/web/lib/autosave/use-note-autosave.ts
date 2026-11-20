"use client";

import type { Note } from "@opennest/core";
import { useCallback, useEffect, useRef, useState } from "react";

import { errorKey } from "../errors";
import type { NoteDraft } from "./draft-journal";
import type { DraftStore } from "./draft-store";
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
  draftStore: DraftStore | null;
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
  applyRemoteContent: (value: string) => void;
  flush: () => Promise<SaveFlushResult>;
  deactivate: () => void;
}

const IDLE_DELAY_MS = 500;
const DRAFT_DELAY_MS = 200;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

interface ResolvedDraftStore {
  store: DraftStore | null;
  failed: boolean;
}

function resolveDraftStore(storeOption: DraftStore | null): ResolvedDraftStore {
  return { store: storeOption, failed: storeOption === null };
}

export function useNoteAutosave({
  note,
  save,
  coordinator,
  draftStore: draftStoreOption,
}: NoteAutosaveOptions): NoteAutosave {
  const [draftStorage] = useState(() => resolveDraftStore(draftStoreOption));
  const store = draftStorage.store;
  const [title, setTitleState] = useState(note.title);
  const [content, setContentState] = useState(note.content);
  const [saved, setSaved] = useState({ title: note.title, content: note.content });
  const [updatedAt, setUpdatedAt] = useState<string>(note.updatedAt);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(
    draftStorage.failed ? "notes.draftError" : null
  );
  const [draftRestored, setDraftRestored] = useState(false);

  const titleRef = useRef(title);
  const contentRef = useRef(content);
  const savedRef = useRef(saved);
  const baseUpdatedAtRef = useRef(note.updatedAt);
  const revisionRef = useRef(0);
  const activeRef = useRef(true);
  const mountedRef = useRef(true);
  const savingRef = useRef(false);
  const inFlightRef = useRef<Promise<SaveFlushResult> | null>(null);
  const draftLoadedRef = useRef(false);
  const draftLoadRef = useRef<Promise<void> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  const hasUnsaved = useCallback(
    () =>
      titleRef.current !== savedRef.current.title ||
      contentRef.current !== savedRef.current.content,
    []
  );

  const clearDraftNow = useCallback(async (): Promise<boolean> => {
    if (store === null) {
      if (draftStorage.failed && mountedRef.current) {
        setDraftError("notes.draftError");
      }

      return !draftStorage.failed;
    }

    try {
      await store.remove(note.workspaceId, note.id);

      if (mountedRef.current) {
        setDraftError(null);
      }

      return true;
    } catch {
      if (mountedRef.current) {
        setDraftError("notes.draftError");
      }

      return false;
    }
  }, [store, draftStorage.failed, note.workspaceId, note.id]);

  const writeDraftNow = useCallback(async (): Promise<boolean> => {
    if (!activeRef.current) {
      return true;
    }

    if (store === null) {
      if (draftStorage.failed && mountedRef.current) {
        setDraftError("notes.draftError");
      }

      return !draftStorage.failed;
    }

    if (!hasUnsaved()) {
      if (!draftLoadedRef.current) {
        return true;
      }

      return clearDraftNow();
    }

    try {
      await store.put({
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
        setDraftError(null);
      }

      return true;
    } catch {
      if (mountedRef.current) {
        setDraftError("notes.draftError");
      }

      return false;
    }
  }, [store, draftStorage.failed, note.workspaceId, note.id, hasUnsaved, clearDraftNow]);

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
        if (draftLoadRef.current !== null) {
          await draftLoadRef.current;
        }

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
            if (draftLoadedRef.current) {
              await clearDraftNow();
            }

            return { ok: true };
          }

          if (snapshot.title.trim().length === 0) {
            await writeDraftNow();
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
              await writeDraftNow();
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
          }

          if (revision === revisionRef.current) {
            titleRef.current = updated.title;
            contentRef.current = updated.content;

            if (mountedRef.current) {
              setTitleState(updated.title);
              setContentState(updated.content);
            }

            await clearDraftNow();

            return { ok: true };
          }

          await writeDraftNow();
        }
      } catch (caught) {
        await writeDraftNow();

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
  }, [clearDraftNow, writeDraftNow]);

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

  const applyRemoteContent = useCallback((value: string) => {
    if (contentRef.current === value) {
      return;
    }

    contentRef.current = value;
    revisionRef.current += 1;
    setContentState(value);
    savedRef.current = { ...savedRef.current, content: value };
    setSaved(savedRef.current);
  }, []);

  const deactivate = useCallback(() => {
    activeRef.current = false;
    void clearDraftNow();
  }, [clearDraftNow]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const revision = revisionRef.current;

    if (store === null) {
      if (draftStorage.failed && mountedRef.current) {
        setDraftError("notes.draftError");
      }

      return;
    }

    const load = (async () => {
      let draft: NoteDraft | null;

      try {
        draft = await store.get(note.workspaceId, note.id);
      } catch {
        if (!cancelled && mountedRef.current) {
          setDraftError("notes.draftError");
        }

        return;
      }

      if (cancelled || !mountedRef.current) {
        return;
      }

      draftLoadedRef.current = true;

      if (draft === null) {
        return;
      }

      if (!isNewerDraft(note, draft)) {
        try {
          await store.remove(note.workspaceId, note.id);
        } catch {
          if (mountedRef.current) {
            setDraftError("notes.draftError");
          }
        }

        return;
      }

      if (revisionRef.current !== revision) {
        return;
      }

      titleRef.current = draft.title;
      contentRef.current = draft.content;
      setTitleState(draft.title);
      setContentState(draft.content);
      setDraftRestored(true);
      setDraftError(null);
    })();

    draftLoadRef.current = load;

    return () => {
      cancelled = true;
    };
  }, [store, draftStorage.failed, note]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void writeDraftNow();
    }, DRAFT_DELAY_MS);

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
      void writeDraftNow();
      void flush();
      unregister();
    };
  }, [coordinator, note.workspaceId, note.id, flush, hasUnsaved, writeDraftNow]);

  useEffect(() => {
    function flushHiddenPage() {
      void writeDraftNow();
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

      void writeDraftNow();
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
    applyRemoteContent,
    flush,
    deactivate,
  };
}
