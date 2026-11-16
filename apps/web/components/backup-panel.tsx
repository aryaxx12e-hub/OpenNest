"use client";

import { useRef, useState } from "react";

import type { BackupSnapshot } from "@opennest/core";
import { formatNumber, useLocale, useTranslations } from "@opennest/localization";
import { Button, Card, ConfirmDialog } from "@opennest/ui";

import { useAppData } from "@/lib/data/app-data-provider";
import {
  backupErrorKey,
  downloadTextFile,
  parseBackupFile,
  summarizeBackup,
  type BackupSummary,
} from "@/lib/data/backup";
import type { DataOverview } from "@/lib/privacy/data-controls";
import { dataControlErrorKey } from "@/lib/privacy/errors";

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
  const { privacy, refreshWorkspace } = useAppData();
  const inputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [pendingExport, setPendingExport] = useState<DataOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [draftWarning, setDraftWarning] = useState<string | null>(null);

  async function prepareExport() {
    setExporting(true);
    setError(null);
    setSuccess(null);
    setDraftWarning(null);

    try {
      setPendingExport(await privacy.data.overview());
    } catch (caught) {
      setError(dataControlErrorKey(caught));
    } finally {
      setExporting(false);
    }
  }

  async function exportBackup() {
    setExporting(true);
    setError(null);
    setSuccess(null);
    setDraftWarning(null);

    try {
      const built = await privacy.data.exportAll();
      download(built.fileName, built.text);
      setSuccess("backup.exportSuccess");
    } catch (caught) {
      setError(dataControlErrorKey(caught));
    } finally {
      setExporting(false);
      setPendingExport(null);
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
      const result = await privacy.data.restore(pending.snapshot);
      setPending(null);
      await refreshWorkspace();
      setSuccess("backup.importSuccess");
      setDraftWarning(result.draftClearFailed ? "backup.draftClearFailed" : null);
    } catch (caught) {
      setPending(null);
      setError(dataControlErrorKey(caught));
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
          <Button loading={exporting} onClick={() => void prepareExport()}>
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
        open={pendingExport !== null}
        title={t("backup.exportTitle")}
        description={t("backup.exportDescription")}
        confirmLabel={t("backup.exportConfirm")}
        cancelLabel={t("common.cancel")}
        busy={exporting}
        onConfirm={() => void exportBackup()}
        onClose={() => setPendingExport(null)}
      >
        {pendingExport === null ? null : (
          <div className="space-y-2">
            <ul className="text-muted grid grid-cols-2 gap-1 text-sm">
              <li>
                {formatNumber(locale, pendingExport.files)} {t("backup.files")}
              </li>
              <li>
                {formatNumber(locale, pendingExport.notes)} {t("backup.notes")}
              </li>
              <li>
                {formatNumber(locale, pendingExport.folders)} {t("backup.folders")}
              </li>
              <li>
                {formatNumber(locale, pendingExport.tags)} {t("backup.tags")}
              </li>
            </ul>
            <p className="text-muted text-xs leading-5">{t("backup.exportExclusion")}</p>
          </div>
        )}
      </ConfirmDialog>

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
