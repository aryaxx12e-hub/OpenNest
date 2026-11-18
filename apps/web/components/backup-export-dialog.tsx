"use client";

import { useId, useState } from "react";

import { formatNumber, useLocale, useTranslations } from "@opennest/localization";
import { Button, Dialog, Input, Label } from "@opennest/ui";

import {
  backupErrorKey,
  createBackupKey,
  downloadTextFile,
  type BackupExportOptions,
  type BackupSummary,
  type BuiltBackup,
} from "@/lib/data/backup";

type Protection = "passphrase" | "backupKey" | "plaintext";

export interface BackupExportDialogProps {
  open: boolean;
  summary?: BackupSummary | null;
  encryptionActive?: boolean;
  download?: (fileName: string, text: string) => void;
  onExport: (options: BackupExportOptions) => Promise<BuiltBackup>;
  onClose: () => void;
  onExported?: (backup: BuiltBackup) => void;
}

export function BackupExportDialog({
  open,
  summary = null,
  encryptionActive = false,
  download = downloadTextFile,
  onExport,
  onClose,
  onExported,
}: BackupExportDialogProps) {
  const t = useTranslations();
  const { locale } = useLocale();
  const ids = useId();
  const [protection, setProtection] = useState<Protection>("passphrase");
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [backupKey, setBackupKey] = useState<string | null>(null);
  const [keySaved, setKeySaved] = useState(false);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function chooseProtection(next: Protection) {
    setProtection(next);
    setError(null);
    setCopyNote(null);

    if (next === "backupKey" && backupKey === null) {
      setBackupKey(createBackupKey());
    }
  }

  async function copyKey() {
    if (backupKey === null) {
      return;
    }

    try {
      if (navigator.clipboard === undefined) {
        throw new Error("clipboard unavailable");
      }

      await navigator.clipboard.writeText(backupKey);
      setCopyNote("backup.exportDialog.keyCopied");
    } catch {
      setCopyNote("backup.exportDialog.copyUnavailable");
    }
  }

  async function runExport() {
    if (completed) {
      onClose();
      return;
    }

    if (exporting) {
      return;
    }

    let options: BackupExportOptions;

    if (protection === "plaintext") {
      options = { format: "v1" };
    } else if (protection === "backupKey") {
      if (backupKey === null || !keySaved) {
        setError("backup.exportDialog.keyRequired");
        return;
      }

      options = {
        format: "v2",
        keySource: { kind: "backupKey", backupKey },
      };
    } else {
      if (passphrase.length < 12) {
        setError("backup.exportDialog.passphraseTooShort");
        return;
      }

      if (passphrase !== confirmation) {
        setError("backup.exportDialog.passphraseMismatch");
        return;
      }

      options = {
        format: "v2",
        keySource: { kind: "passphrase", passphrase },
      };
    }

    setExporting(true);
    setError(null);

    try {
      const built = await onExport(options);
      download(built.fileName, built.text);
      setCompleted(true);
      onExported?.(built);
    } catch (caught) {
      setError(backupErrorKey(caught));
    } finally {
      setExporting(false);
    }
  }

  const controlsDisabled = exporting || completed;

  return (
    <Dialog
      open={open}
      title={t("backup.exportDialog.title")}
      description={t("backup.exportDialog.description")}
      onClose={() => {
        if (!exporting) {
          onClose();
        }
      }}
      footer={
        completed ? (
          <Button onClick={onClose}>{t("backup.exportDialog.done")}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={exporting}>
              {t("common.cancel")}
            </Button>
            <Button loading={exporting} onClick={() => void runExport()}>
              {exporting ? t("backup.exporting") : t("backup.exportDialog.download")}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {summary === null ? null : (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("backup.exportDialog.summary")}</p>
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

        <fieldset className="space-y-2" disabled={controlsDisabled}>
          <legend className="text-sm font-medium">
            {t("backup.exportDialog.protection")}
          </legend>
          <ProtectionOption
            checked={protection === "passphrase"}
            label={t("backup.exportDialog.passphrase")}
            hint={t("backup.exportDialog.passphraseHint")}
            onSelect={() => chooseProtection("passphrase")}
          />
          <ProtectionOption
            checked={protection === "backupKey"}
            label={t("backup.exportDialog.backupKey")}
            hint={t("backup.exportDialog.backupKeyHint")}
            onSelect={() => chooseProtection("backupKey")}
          />
          <ProtectionOption
            checked={protection === "plaintext"}
            label={t("backup.exportDialog.plaintext")}
            hint={t("backup.exportDialog.plaintextHint")}
            onSelect={() => chooseProtection("plaintext")}
          />
        </fieldset>

        {protection === "passphrase" ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor={`${ids}-passphrase`}>
                {t("backup.exportDialog.passphraseLabel")}
              </Label>
              <Input
                id={`${ids}-passphrase`}
                type="password"
                autoComplete="new-password"
                value={passphrase}
                placeholder={t("backup.exportDialog.passphrasePlaceholder")}
                disabled={controlsDisabled}
                onChange={(event) => setPassphrase(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${ids}-confirmation`}>
                {t("backup.exportDialog.confirmPassphraseLabel")}
              </Label>
              <Input
                id={`${ids}-confirmation`}
                type="password"
                autoComplete="new-password"
                value={confirmation}
                disabled={controlsDisabled}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </div>
            <p className="text-muted text-xs leading-5">
              {t("backup.exportDialog.encryptionNotice")}
            </p>
          </div>
        ) : null}

        {protection === "backupKey" ? (
          <div className="border-border bg-background/60 space-y-2 rounded-xl border p-3">
            <Label htmlFor={`${ids}-backup-key`}>
              {t("backup.exportDialog.generatedKeyLabel")}
            </Label>
            <Input
              id={`${ids}-backup-key`}
              readOnly
              className="font-mono text-xs"
              value={backupKey ?? ""}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={backupKey === null}
                onClick={() => void copyKey()}
              >
                {t("backup.exportDialog.copyKey")}
              </Button>
              {copyNote === null ? null : (
                <span role="status" className="text-muted text-xs">
                  {t(copyNote)}
                </span>
              )}
            </div>
            <p className="text-muted text-xs leading-5">
              {t("backup.exportDialog.generatedKeyHint")}
            </p>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={keySaved}
                disabled={controlsDisabled}
                onChange={(event) => setKeySaved(event.target.checked)}
              />
              <span>{t("backup.exportDialog.keySaved")}</span>
            </label>
            <p className="text-muted text-xs leading-5">
              {t("backup.exportDialog.encryptionNotice")}
            </p>
          </div>
        ) : null}

        {protection === "plaintext" ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">
              {t("backup.exportDialog.plaintextWarning")}
            </p>
            {encryptionActive ? (
              <p className="text-muted text-xs leading-5">
                {t("backup.exportDialog.encryptedAtRestNotice")}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-1">
          <p className="text-muted text-xs leading-5">{t("backup.exportExclusion")}</p>
          <p className="text-muted text-xs leading-5">{t("backup.exportExclusionAi")}</p>
        </div>

        {completed ? (
          <p role="status" className="text-sm font-medium">
            {t("backup.exportDialog.success")}
          </p>
        ) : null}
        {error === null ? null : (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {t(error)}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function ProtectionOption({
  checked,
  label,
  hint,
  onSelect,
}: {
  checked: boolean;
  label: string;
  hint: string;
  onSelect: () => void;
}) {
  return (
    <label className="border-border flex items-start gap-3 rounded-xl border p-3 text-sm">
      <input
        type="radio"
        name="backup-protection"
        className="mt-1"
        checked={checked}
        onChange={onSelect}
      />
      <span className="space-y-1">
        <span className="block font-medium">{label}</span>
        <span className="text-muted block text-xs leading-5">{hint}</span>
      </span>
    </label>
  );
}
