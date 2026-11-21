"use client";

import { useRef, useState, useSyncExternalStore } from "react";

import type { BackupSnapshot } from "@opennest/core";
import { formatNumber, useLocale, useTranslations } from "@opennest/localization";
import { Button, Card, ConfirmDialog } from "@opennest/ui";

import { BackupExportDialog } from "@/components/backup-export-dialog";
import { BackupImportDialog } from "@/components/backup-import-dialog";
import { RecoveryGuide } from "@/components/recovery-guide";
import { useEncryption } from "@/lib/crypto/encryption-gate";
import { useAppData } from "@/lib/data/app-data-provider";
import {
  readLastBackupAt,
  recordBackupExported,
  subscribeBackupRecord,
} from "@/lib/data/backup-reminder";
import {
  backupErrorKey,
  inspectBackupFile,
  parseBackupFile,
  summarizeBackup,
  type BackupKeySource,
  type BackupSummary,
} from "@/lib/data/backup";
import { exportTextFile } from "@/lib/export";
import { formatCalendarDate } from "@/lib/format";
import { dataControlErrorKey } from "@/lib/privacy/errors";

export interface BackupPanelProps {
  download?: (fileName: string, text: string) => void | Promise<void>;
  encryptionActive?: boolean;
}

interface PendingImport {
  snapshot: BackupSnapshot;
  summary: BackupSummary;
  encrypted: boolean;
}

interface EncryptedFile {
  text: string;
  summary: BackupSummary;
}

export function BackupPanel({
  download = exportTextFile,
  encryptionActive = false,
}: BackupPanelProps) {
  const t = useTranslations();
  const { locale } = useLocale();
  const { privacy, workspace, refreshWorkspace } = useAppData();
  const encryption = useEncryption();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preparing, setPreparing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSummary, setExportSummary] = useState<BackupSummary | null>(null);
  const [encryptedFile, setEncryptedFile] = useState<EncryptedFile | null>(null);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [draftWarning, setDraftWarning] = useState<string | null>(null);
  const lastBackupAt = useSyncExternalStore(
    subscribeBackupRecord,
    readLastBackupAt,
    () => null
  );

  async function prepareExport() {
    setPreparing(true);
    setError(null);
    setSuccess(null);
    setDraftWarning(null);

    try {
      const overview = await privacy.data.overview();
      setExportSummary({
        files: overview.files,
        notes: overview.notes,
        folders: overview.folders,
        tags: overview.tags,
      });
      setExportOpen(true);
    } catch (caught) {
      setError(dataControlErrorKey(caught));
    } finally {
      setPreparing(false);
    }
  }

  async function chooseBackup(file: File) {
    setImporting(true);
    setError(null);
    setSuccess(null);
    setDraftWarning(null);

    try {
      const text = await file.text();
      const inspection = inspectBackupFile(text);

      if (inspection.formatVersion === 1) {
        const snapshot = await parseBackupFile(text);

        setPending({
          snapshot,
          summary: summarizeBackup(snapshot),
          encrypted: false,
        });
      } else {
        setEncryptedFile({
          text,
          summary: {
            files: inspection.summary.counts.files,
            notes: inspection.summary.counts.notes,
            folders: inspection.summary.counts.folders,
            tags: inspection.summary.counts.tags,
          },
        });
      }
    } catch (caught) {
      setError(backupErrorKey(caught));
    } finally {
      setImporting(false);

      if (inputRef.current !== null) {
        inputRef.current.value = "";
      }
    }
  }

  async function unlockBackup(keySource: BackupKeySource): Promise<void> {
    if (encryptedFile === null) {
      return;
    }

    const snapshot = await parseBackupFile(encryptedFile.text, keySource, {
      targetWorkspaceId: workspace.id,
    });

    setPending({
      snapshot,
      summary: summarizeBackup(snapshot),
      encrypted: true,
    });
    setEncryptedFile(null);
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
    <section id="backup" className="scroll-mt-24 space-y-4">
      <Card className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t("backup.title")}</h2>
          <p className="text-muted text-sm leading-6">{t("backup.description")}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button loading={preparing} onClick={() => void prepareExport()}>
            {preparing ? t("backup.exporting") : t("backup.export")}
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
        <p className="text-muted text-xs leading-5">
          {t("backup.lastBackup")}:{" "}
          {lastBackupAt === null
            ? t("backup.neverBackedUp")
            : formatCalendarDate(locale, lastBackupAt)}
        </p>

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

      <RecoveryGuide error={error ?? draftWarning} />

      {exportOpen ? (
        <BackupExportDialog
          open
          summary={exportSummary}
          encryptionActive={encryptionActive || encryption.record !== null}
          download={download}
          onExport={(options) => privacy.data.exportAll(options)}
          onExported={() => {
            recordBackupExported();
            setSuccess("backup.exportSuccess");
          }}
          onClose={() => setExportOpen(false)}
        />
      ) : null}

      {encryptedFile === null ? null : (
        <BackupImportDialog
          open
          summary={encryptedFile.summary}
          onSubmit={unlockBackup}
          onClose={() => setEncryptedFile(null)}
        />
      )}

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
            {pending.encrypted ? (
              encryptionActive ? null : (
                <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">
                  {t("backup.importWarning.notEncryptedAtRest")}
                </p>
              )
            ) : (
              <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">
                {t("backup.importWarning.plaintext")}
              </p>
            )}
          </div>
        )}
      </ConfirmDialog>
    </section>
  );
}
