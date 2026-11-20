"use client";

import { useId, useRef, useState, type FormEvent } from "react";

import { encodeRecoveryKey, randomBytes } from "@opennest/crypto";
import { useTranslations } from "@opennest/localization";
import { Button, Label, cn } from "@opennest/ui";

import { useEncryption } from "@/lib/crypto/encryption-gate";

type Step = "form" | "recovery";

const MIN_PASSPHRASE = 12;
const FIELD_CLASS =
  "border-border bg-surface text-foreground placeholder:text-muted focus-visible:outline-primary min-h-11 w-full rounded-control border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2";

export function EncryptionSetup() {
  const t = useTranslations();
  const ids = useId();
  const passphraseRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("form");
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { startSetup } = useEncryption();

  function continueToRecovery(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    if (passphrase.trim().length === 0) {
      setError("encryption.setup.requiredPassphrase");
      passphraseRef.current?.focus();
      return;
    }

    if (passphrase.length < MIN_PASSPHRASE) {
      setError("encryption.setup.passphraseTooShort");
      passphraseRef.current?.focus();
      return;
    }

    if (passphrase !== confirmation) {
      setError("encryption.setup.passphraseMismatch");
      confirmationRef.current?.focus();
      return;
    }

    setError(null);
    setSaved(false);
    setCopyNote(null);
    setRecoveryKey(encodeRecoveryKey(randomBytes(32)));
    setStep("recovery");
  }

  async function copyRecoveryKey() {
    try {
      if (navigator.clipboard === undefined) {
        throw new Error("clipboard unavailable");
      }

      await navigator.clipboard.writeText(recoveryKey);
      setCopyNote("encryption.setup.keyCopied");
    } catch {
      setCopyNote("encryption.setup.copyUnavailable");
    }
  }

  async function enableEncryption() {
    if (busy || !saved) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await startSetup(passphrase, recoveryKey);
    } catch {
      setError("encryption.setup.failed");
      setBusy(false);
    }
  }

  if (step === "recovery") {
    return (
      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t("encryption.setup.recoveryTitle")}</h2>
          <p className="text-muted text-sm leading-6">
            {t("encryption.setup.recoveryDescription")}
          </p>
        </div>

        <div className="border-border bg-background/60 rounded-control space-y-3 border p-3">
          <div className="space-y-1">
            <p id={`${ids}-recovery`} className="text-sm font-medium">
              {t("encryption.setup.recoveryKeyLabel")}
            </p>
            <code
              aria-labelledby={`${ids}-recovery`}
              className="border-border bg-surface text-foreground rounded-control block min-h-11 border px-3 py-3 font-mono text-xs leading-5 break-all select-all"
            >
              {recoveryKey}
            </code>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => void copyRecoveryKey()}>
              {t("encryption.setup.copyKey")}
            </Button>
            {copyNote === null ? null : (
              <span role="status" className="text-muted text-xs">
                {t(copyNote)}
              </span>
            )}
          </div>
          <p className="text-muted text-xs leading-5">
            {t("encryption.setup.recoveryHint")}
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={saved}
              disabled={busy}
              onChange={(event) => setSaved(event.target.checked)}
            />
            <span>{t("encryption.setup.recoveryConfirm")}</span>
          </label>
        </div>

        {error === null ? null : (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {t(error)}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => setStep("form")}>
            {t("encryption.setup.back")}
          </Button>
          <Button
            loading={busy}
            disabled={!saved}
            onClick={() => void enableEncryption()}
          >
            {busy ? t("encryption.setup.enabling") : t("encryption.setup.enable")}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t("encryption.setup.title")}</h2>
        <p className="text-muted text-sm leading-6">
          {t("encryption.setup.description")}
        </p>
      </div>

      <form className="space-y-3" onSubmit={continueToRecovery} noValidate>
        <div className="space-y-1">
          <Label htmlFor={`${ids}-passphrase`}>{t("encryption.setup.passphrase")}</Label>
          <input
            ref={passphraseRef}
            id={`${ids}-passphrase`}
            type="password"
            autoComplete="new-password"
            value={passphrase}
            placeholder={t("encryption.setup.passphrasePlaceholder")}
            aria-invalid={error !== null}
            className={cn(FIELD_CLASS)}
            onChange={(event) => {
              setPassphrase(event.target.value);
              setError(null);
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${ids}-confirmation`}>
            {t("encryption.setup.confirmPassphrase")}
          </Label>
          <input
            ref={confirmationRef}
            id={`${ids}-confirmation`}
            type="password"
            autoComplete="new-password"
            value={confirmation}
            aria-invalid={error !== null}
            className={cn(FIELD_CLASS)}
            onChange={(event) => {
              setConfirmation(event.target.value);
              setError(null);
            }}
          />
        </div>
        <p className="text-muted text-xs leading-5">
          {t("encryption.setup.passphraseHint")}
        </p>
        {error === null ? null : (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {t(error)}
          </p>
        )}
        <Button type="submit">{t("encryption.setup.continue")}</Button>
      </form>
    </section>
  );
}
