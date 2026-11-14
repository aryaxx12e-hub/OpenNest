"use client";

import { useRef, useState } from "react";

import type { BackupSnapshot } from "@opennest/core";
import { formatNumber, useLocale, useTranslations } from "@opennest/localization";
import { Button, Card, ConfirmDialog } from "@opennest/ui";

import { clearAllNoteDrafts } from "@/lib/autosave/draft-journal";
import { useAppData } from "@/lib/data/app-data-provider";
import {
  backupErrorKey,
  buildBackup,
  downloadTextFile,
  parseBackupFile,
  summarizeBackup,
  type BackupSummary,
} from "@/lib/data/backup";

export interface BackupPanelProps {
  download?: (fileName: string, text: string) => void;
}

interface PendingImport {
  snapshot: BackupSnapshot;
  summary: BackupSummary;
}

export function BackupPanel({ download = downloadTextFile }: BackupPanelProps) {
  const t = useTranslations();
  const { locale } = useLocale();
  const { storage, workspace, refreshWorkspace } = useAppData();
  const inputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [draftWarning, setDraftWarning] = useState<string | null>(null);

  async function exportBackup() {
    setExporting(true);
    setError(null);
    setSuccess(null);
    setDraftWarning(null);

    try {
      const built = await buildBackup(storage, workspace.id);
      download(built.fileName, built.text);
      setSuccess("backup.exportSuccess");
    } catch (caught) {
      setError(backupErrorKey(caught));
    } finally {
      setExporting(false);
    }
  }

  async function chooseBackup(file: File) {
    setImporting(true);
    setError(null);
    setSuccess(null);
    setDraftWarning(null);

    try {
      const snapshot = await parseBackupFile(await file.text());
      setPending({ snapshot, summary: summarizeBackup(snapshot) });
    } catch (caught) {
      setError(backupErrorKey(caught));
    } finally {
      setImporting(false);

      if (inputRef.current !== null) {
        inputRef.current.value = "";
      }
    }
  }

  async function restoreBackup() {
    if (pending === null) {
      return;
    }

    setRestoring(true);
    setError(null);
    setDraftWarning(null);

    try {
      await storage.restore(pending.snapshot);

      let draftClearFailed = false;

      try {
        draftClearFailed = clearAllNoteDrafts(window.localStorage).failed > 0;
      } catch {
        draftClearFailed = true;
      }

      setPending(null);
      await refreshWorkspace();
      setSuccess("backup.importSuccess");
      setDraftWarning(draftClearFailed ? "backup.draftClearFailed" : null);
    } catch (caught) {
      setPending(null);
      setError(backupErrorKey(caught));
    } finally {
      setRestoring(false);
    }
  }

  return (
    <section className="space-y-4">
      <Card className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t("backup.title")}</h2>
          <p className="text-muted text-sm leading-6">{t("backup.description")}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button loading={exporting} onClick={() => void exportBackup()}>
            {exporting ? t("backup.exporting") : t("backup.export")}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0];

              if (file !== undefined) {
                void chooseBackup(file);
              }
            }}
          />
          <Button
            variant="secondary"
            loading={importing}
            onClick={() => inputRef.current?.click()}
          >
            {importing ? t("backup.importing") : t("backup.import")}
          </Button>
        </div>

        <p className="text-muted text-xs leading-5">{t("backup.localOnly")}</p>

        {error === null ? null : (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {t(error)}
          </p>
        )}
        {success === null ? null : (
          <p role="status" className="text-muted text-sm">
            {t(success)}
          </p>
        )}
        {draftWarning === null ? null : (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {t(draftWarning)}
          </p>
        )}
      </Card>

      <ConfirmDialog
        open={pending !== null}
        title={t("backup.importTitle")}
        description={t("backup.importDescription")}
        confirmLabel={t("backup.importConfirm")}
        cancelLabel={t("common.cancel")}
        busy={restoring}
        destructive
        onConfirm={() => void restoreBackup()}
        onClose={() => setPending(null)}
      >
        {pending === null ? null : (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("backup.summary")}</p>
            <ul className="text-muted grid grid-cols-2 gap-1 text-sm">
              <li>
                {formatNumber(locale, pending.summary.files)} {t("backup.files")}
              </li>
              <li>
                {formatNumber(locale, pending.summary.notes)} {t("backup.notes")}
              </li>
              <li>
                {formatNumber(locale, pending.summary.folders)} {t("backup.folders")}
              </li>
              <li>
                {formatNumber(locale, pending.summary.tags)} {t("backup.tags")}
              </li>
            </ul>
          </div>
        )}
      </ConfirmDialog>
    </section>
  );
}
