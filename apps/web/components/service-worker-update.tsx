"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

import { useTranslations } from "@opennest/localization";
import { Button } from "@opennest/ui";

import type { DraftJournal, NoteDraft } from "@/lib/autosave/draft-journal";
import {
  createBrowserPlainDraftStore,
  type DraftStore,
} from "@/lib/autosave/draft-store";
import { useOptionalAppData, useOptionalAppRevision } from "@/lib/data/app-data-provider";
import { useSaveCoordinator } from "@/lib/data/save-coordinator";
import {
  browserPwaContainer,
  startPwa,
  type PwaContainer,
  type PwaHandle,
} from "@/lib/pwa";

import { DraftRecovery, type DraftTarget } from "./draft-recovery";

function reloadPage() {
  window.location.reload();
}

async function readBrowserDrafts(activeStore?: DraftStore | null): Promise<DraftJournal> {
  if (typeof window === "undefined") {
    return { ok: true, drafts: [] };
  }

  const store = activeStore ?? createBrowserPlainDraftStore();

  if (store === null) {
    return { ok: false, error: new Error("Draft storage is unavailable.") };
  }

  try {
    return { ok: true, drafts: await store.list() };
  } catch (error) {
    return { ok: false, error };
  }
}

async function clearBrowserDraft(
  workspaceId: string,
  noteId: string,
  activeStore?: DraftStore | null
): Promise<boolean> {
  const store = activeStore ?? createBrowserPlainDraftStore();

  if (store === null) {
    return false;
  }

  try {
    await store.remove(workspaceId, noteId);
    return true;
  } catch {
    return false;
  }
}

async function clearBrowserDrafts(
  activeStore?: DraftStore | null
): Promise<{ removed: number; failed: number }> {
  const store = activeStore ?? createBrowserPlainDraftStore();

  if (store === null) {
    return { removed: 0, failed: 1 };
  }

  try {
    return await store.clear();
  } catch {
    return { removed: 0, failed: 1 };
  }
}

type UpdateError = "save" | "update";

type Recovery =
  { kind: "drafts"; targets: DraftTarget[] } | { kind: "unreadable" } | null;

export interface ServiceWorkerUpdateProps {
  enabled?: boolean;
  container?: PwaContainer | null;
  reload?: () => void;
  readDrafts?: () => Promise<DraftJournal>;
  classifyDrafts?: (drafts: NoteDraft[]) => Promise<DraftTarget[]>;
  clearDraft?: (workspaceId: string, noteId: string) => Promise<boolean>;
  clearDrafts?: () => Promise<{ removed: number; failed: number }>;
  download?: (fileName: string, text: string) => void;
}

async function classifyAsUnverified(drafts: NoteDraft[]): Promise<DraftTarget[]> {
  return drafts.map((draft) => ({ draft, exists: false, verified: false }));
}

function draftKey(draft: NoteDraft): string {
  return `${draft.workspaceId}:${draft.noteId}`;
}

function coverAllDrafts(drafts: NoteDraft[], targets: DraftTarget[]): DraftTarget[] {
  const byKey = new Map(targets.map((target) => [draftKey(target.draft), target]));

  return drafts.map(
    (draft) => byKey.get(draftKey(draft)) ?? { draft, exists: false, verified: false }
  );
}

export function ServiceWorkerUpdate({
  enabled = process.env.NODE_ENV === "production",
  container,
  reload = reloadPage,
  readDrafts,
  classifyDrafts = classifyAsUnverified,
  clearDraft,
  clearDrafts,
  download,
}: ServiceWorkerUpdateProps) {
  const t = useTranslations();
  const coordinator = useSaveCoordinator();
  const appData = useOptionalAppData();
  const activeDrafts = appData?.drafts;
  const readRecoveryDrafts = readDrafts ?? (() => readBrowserDrafts(activeDrafts));
  const clearRecoveryDraft =
    clearDraft ??
    ((workspaceId, noteId) => clearBrowserDraft(workspaceId, noteId, activeDrafts));
  const clearRecoveryDrafts = clearDrafts ?? (() => clearBrowserDrafts(activeDrafts));
  const handleRef = useRef<PwaHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<UpdateError | null>(null);
  const [recovery, setRecovery] = useState<Recovery>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const revision = useOptionalAppRevision();

  async function readRecovery(): Promise<Recovery> {
    let journal: DraftJournal;

    try {
      journal = await readRecoveryDrafts();
    } catch (error) {
      journal = { ok: false, error };
    }

    if (!journal.ok) {
      return { kind: "unreadable" };
    }

    if (journal.drafts.length === 0) {
      return null;
    }

    let targets: DraftTarget[];

    try {
      targets = coverAllDrafts(journal.drafts, await classifyDrafts(journal.drafts));
    } catch {
      targets = await classifyAsUnverified(journal.drafts);
    }

    return { kind: "drafts", targets };
  }

  const refreshRecovery = useEffectEvent(async (): Promise<Recovery | undefined> => {
    if (recovery?.kind !== "drafts") {
      return undefined;
    }

    return readRecovery();
  });

  useEffect(() => {
    if (!ready) {
      return;
    }

    let active = true;

    void refreshRecovery()
      .then((next) => {
        if (active && next !== undefined) {
          setRecoveryError(null);
          setRecovery(next);
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [ready, revision]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const target = container === undefined ? browserPwaContainer() : container;

    if (target === null) {
      return;
    }

    let active = true;

    void startPwa(target, {
      onUpdateReady: () => {
        if (active) {
          setUpdateError(null);
          setRecovery(null);
          setRecoveryError(null);
          setReady(true);
        }
      },
      onControllerChange: () => {
        if (active) {
          reload();
        }
      },
    })
      .then((handle) => {
        if (!active) {
          handle.dispose();
          return;
        }

        handleRef.current = handle;
      })
      .catch(() => undefined);

    return () => {
      active = false;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [container, enabled, reload]);

  async function activateUpdate() {
    const handle = handleRef.current;

    if (handle === null) {
      setReady(false);
      return;
    }

    setUpdating(true);
    setUpdateError(null);
    setRecoveryError(null);

    try {
      const result = await coordinator.flushAll();

      if (!result.ok) {
        setUpdating(false);
        setUpdateError("save");
        return;
      }

      const next = await readRecovery();

      if (next !== null) {
        setUpdating(false);
        setRecovery(next);
        return;
      }

      setRecovery(null);

      try {
        if (!handle.requestUpdate()) {
          setUpdating(false);
          setUpdateError("update");
        }
      } catch {
        setUpdating(false);
        setUpdateError("update");
      }
    } catch {
      setUpdating(false);
      setUpdateError("save");
    }
  }

  async function discardDraft(draft: NoteDraft) {
    setUpdating(true);
    setRecoveryError(null);

    let cleared = false;

    try {
      cleared = await clearRecoveryDraft(draft.workspaceId, draft.noteId);
    } catch {
      cleared = false;
    }

    if (!cleared) {
      setUpdating(false);
      setRecoveryError("pwa.updateDraftError");
      return;
    }

    setRecovery(null);
    await activateUpdate();
  }

  async function clearUnreadableJournal() {
    setUpdating(true);
    setRecoveryError(null);

    let result: { removed: number; failed: number };

    try {
      result = await clearRecoveryDrafts();
    } catch {
      result = { removed: 0, failed: 1 };
    }

    if (result.failed > 0) {
      setUpdating(false);
      setRecoveryError("pwa.updateDraftClearFailed");
      return;
    }

    setRecovery(null);
    await activateUpdate();
  }

  if (!ready) {
    return null;
  }

  return (
    <div className="border-border bg-surface border-b px-4 py-3 sm:px-6">
      <div className="mx-auto w-full max-w-5xl">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div role="status" aria-live="polite" className="min-w-0">
            <p className="text-sm font-semibold">{t("pwa.updateTitle")}</p>
            <p
              role={updateError === null ? undefined : "alert"}
              className={
                updateError === null
                  ? "text-muted mt-0.5 text-xs leading-5"
                  : "mt-0.5 text-xs leading-5 text-red-700 dark:text-red-300"
              }
            >
              {updateError === null
                ? t("pwa.updateDescription")
                : updateError === "save"
                  ? t("pwa.updateSaveError")
                  : t("pwa.updateStartError")}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setReady(false);
                setRecovery(null);
                setRecoveryError(null);
                setUpdateError(null);
              }}
            >
              {t("pwa.updateLater")}
            </Button>
            <Button size="sm" loading={updating} onClick={() => void activateUpdate()}>
              {t("pwa.updateAction")}
            </Button>
          </div>
        </div>
        {recovery === null ? null : (
          <DraftRecovery
            targets={recovery.kind === "drafts" ? recovery.targets : []}
            unreadable={recovery.kind === "unreadable"}
            busy={updating}
            error={recoveryError}
            download={download}
            onDiscard={(draft) => void discardDraft(draft)}
            onClearAll={() => void clearUnreadableJournal()}
          />
        )}
      </div>
    </div>
  );
}
