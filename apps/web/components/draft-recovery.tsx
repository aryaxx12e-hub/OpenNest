"use client";

import { useState } from "react";
import Link from "next/link";

import { useTranslations } from "@opennest/localization";
import { Button, ConfirmDialog } from "@opennest/ui";

import type { NoteDraft } from "@/lib/autosave/draft-journal";
import { downloadTextFile } from "@/lib/data/backup";

export interface DraftTarget {
  draft: NoteDraft;
  exists: boolean;
  verified?: boolean;
}

export interface DraftRecoveryProps {
  targets: DraftTarget[];
  unreadable: boolean;
  busy: boolean;
  error: string | null;
  download?: (fileName: string, text: string) => void;
  onDiscard: (draft: NoteDraft) => void;
  onClearAll: () => void;
}

type PendingAction = { kind: "discard"; draft: NoteDraft } | { kind: "clear" } | null;

function draftFileName(draft: NoteDraft): string {
  const workspace = draft.workspaceId.replace(/[^a-zA-Z0-9_-]/g, "-");

  return `opennest-draft-${workspace}-${draft.noteId}.json`;
}

function draftFileText(draft: NoteDraft): string {
  return JSON.stringify(draft, null, 2);
}

export function DraftRecovery({
  targets,
  unreadable,
  busy,
  error,
  download = downloadTextFile,
  onDiscard,
  onClearAll,
}: DraftRecoveryProps) {
  const t = useTranslations();
  const [pending, setPending] = useState<PendingAction>(null);
  const [downloaded, setDownloaded] = useState(false);
  const existingCount = targets.filter((target) => target.exists).length;
  const orphanCount = targets.length - existingCount;
  const unverifiedCount = targets.filter(
    (target) => !target.exists && target.verified === false
  ).length;

  function confirmPending() {
    const action = pending;
    setPending(null);

    if (action?.kind === "discard") {
      onDiscard(action.draft);
    } else if (action?.kind === "clear") {
      onClearAll();
    }
  }

  return (
    <div className="border-border mt-3 space-y-3 border-t pt-3">
      <div role="status" aria-live="polite" className="space-y-1">
        {unreadable ? (
          <p className="text-muted text-xs leading-5">{t("pwa.updateDraftUnverified")}</p>
        ) : (
          <p className="text-muted text-xs leading-5">
            {existingCount > 0 ? t("pwa.updateDraftExisting") : null}{" "}
            {orphanCount > 0 ? t("pwa.updateDraftOrphan") : null}
          </p>
        )}
      </div>

      {error === null ? null : (
        <p role="alert" className="text-xs leading-5 text-red-700 dark:text-red-300">
          {t(error)}
        </p>
      )}

      {unverifiedCount > 0 ? (
        <p role="status" className="text-muted text-xs leading-5">
          {t("pwa.updateDraftUnverifiedNote")}
        </p>
      ) : null}

      {unreadable ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => setPending({ kind: "clear" })}
        >
          {t("pwa.updateDraftClearAction")}
        </Button>
      ) : (
        <ul className="space-y-2">
          {targets.map(({ draft, exists }) => (
            <li
              key={`${draft.workspaceId}:${draft.noteId}`}
              className="flex flex-wrap items-center gap-2"
            >
              <span className="min-w-0 flex-1 truncate text-xs font-medium">
                {draft.title.trim() === "" ? t("notes.untitled") : draft.title}
              </span>
              {exists ? (
                <Link
                  className="text-primary text-xs font-medium underline underline-offset-4"
                  href={`/notes/${draft.noteId}`}
                >
                  {t("pwa.updateDraftOpen")}
                </Link>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      download(draftFileName(draft), draftFileText(draft));
                      setDownloaded(true);
                    }}
                  >
                    {t("pwa.updateDraftDownload")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setPending({ kind: "discard", draft })}
                  >
                    {t("pwa.updateDraftDiscard")}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {downloaded ? (
        <p role="status" className="text-muted text-xs leading-5">
          {t("pwa.updateDraftDownloaded")}
        </p>
      ) : null}

      <ConfirmDialog
        open={pending?.kind === "discard"}
        title={t("pwa.updateDraftDiscardTitle")}
        description={t("pwa.updateDraftDiscardDescription")}
        confirmLabel={t("pwa.updateDraftDiscardConfirm")}
        cancelLabel={t("common.cancel")}
        busy={busy}
        destructive
        onConfirm={confirmPending}
        onClose={() => setPending(null)}
      />
      <ConfirmDialog
        open={pending?.kind === "clear"}
        title={t("pwa.updateDraftClearTitle")}
        description={t("pwa.updateDraftClearDescription")}
        confirmLabel={t("pwa.updateDraftClearConfirm")}
        cancelLabel={t("common.cancel")}
        busy={busy}
        destructive
        onConfirm={confirmPending}
        onClose={() => setPending(null)}
      />
    </div>
  );
}
