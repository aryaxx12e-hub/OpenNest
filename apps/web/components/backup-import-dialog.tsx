"use client";

import { useId, useState } from "react";

import { formatNumber, useLocale, useTranslations } from "@opennest/localization";
import { Button, Dialog, Input, Label } from "@opennest/ui";

import {
  backupErrorKey,
  type BackupKeySource,
  type BackupSummary,
} from "@/lib/data/backup";

type ImportProtection = "passphrase" | "backupKey";

export interface BackupImportDialogProps {
  open: boolean;
  summary?: BackupSummary | null;
  onClose: () => void;
  onSubmit: (keySource: BackupKeySource) => Promise<void>;
}

export function BackupImportDialog({
  open,
  summary = null,
  onClose,
  onSubmit,
}: BackupImportDialogProps) {
  const t = useTranslations();
  const { locale } = useLocale();
  const ids = useId();
  const [protection, setProtection] = useState<ImportProtection>("passphrase");
  const [passphrase, setPassphrase] = useState("");
  const [backupKey, setBackupKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock() {
    if (busy) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await onSubmit(
        protection === "passphrase"
          ? { kind: "passphrase", passphrase }
          : { kind: "backupKey", backupKey }
      );
    } catch (caught) {
      setError(backupErrorKey(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      title={t("backup.importKey.title")}
      description={t("backup.importKey.description")}
      onClose={() => {
        if (!busy) {
          onClose();
        }
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button loading={busy} onClick={() => void unlock()}>
            {busy ? t("backup.importing") : t("backup.importKey.unlock")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {summary === null ? null : (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("backup.summary")}</p>
            <ul className="text-muted grid grid-cols-2 gap-1 text-sm">
              <li>
                {formatNumber(locale, summary.files)} {t("backup.files")}
              </li>
              <li>
                {formatNumber(locale, summary.notes)} {t("backup.notes")}
              </li>
              <li>
                {formatNumber(locale, summary.folders)} {t("backup.folders")}
              </li>
              <li>
                {formatNumber(locale, summary.tags)} {t("backup.tags")}
              </li>
            </ul>
          </div>
        )}

        <fieldset className="space-y-2" disabled={busy}>
          <legend className="text-sm font-medium">
            {t("backup.exportDialog.protection")}
          </legend>
          <label className="border-border flex items-start gap-3 rounded-xl border p-3 text-sm">
            <input
              type="radio"
              name="backup-import-protection"
              className="mt-1"
              checked={protection === "passphrase"}
              onChange={() => setProtection("passphrase")}
            />
            <span className="font-medium">{t("backup.importKey.passphrase")}</span>
          </label>
          <label className="border-border flex items-start gap-3 rounded-xl border p-3 text-sm">
            <input
              type="radio"
              name="backup-import-protection"
              className="mt-1"
              checked={protection === "backupKey"}
              onChange={() => setProtection("backupKey")}
            />
            <span className="font-medium">{t("backup.importKey.backupKey")}</span>
          </label>
        </fieldset>

        {protection === "passphrase" ? (
          <div className="space-y-1">
            <Label htmlFor={`${ids}-passphrase`}>
              {t("backup.importKey.passphrase")}
            </Label>
            <Input
              id={`${ids}-passphrase`}
              type="password"
              autoComplete="current-password"
              value={passphrase}
              placeholder={t("backup.importKey.passphrasePlaceholder")}
              disabled={busy}
              onChange={(event) => setPassphrase(event.target.value)}
            />
          </div>
        ) : (
          <div className="space-y-1">
            <Label htmlFor={`${ids}-backup-key`}>{t("backup.importKey.backupKey")}</Label>
            <Input
              id={`${ids}-backup-key`}
              className="font-mono text-xs"
              value={backupKey}
              placeholder={t("backup.importKey.keyPlaceholder")}
              disabled={busy}
              onChange={(event) => setBackupKey(event.target.value)}
            />
          </div>
        )}

        {error === null ? null : (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {t(error)}
          </p>
        )}
      </div>
    </Dialog>
  );
}
