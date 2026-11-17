"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { CryptoError } from "@opennest/crypto";
import { useTranslations } from "@opennest/localization";
import { Button } from "@opennest/ui";

type UnlockMode = "passphrase" | "recovery";

export interface UnlockScreenProps {
  onUnlock: (passphrase: string) => Promise<void>;
  onUnlockWithRecoveryKey: (recoveryKey: string) => Promise<void>;
}

function messageFor(error: unknown): string {
  if (error instanceof CryptoError) {
    if (error.code === "authentication_failed") {
      return "encryption.unlock.errors.wrong";
    }

    if (error.code === "rate_limited") {
      return "encryption.unlock.errors.rateLimited";
    }

    if (error.code === "keyring_corrupt" || error.code === "keyring_missing") {
      return "encryption.unlock.errors.corrupt";
    }
  }

  return "encryption.unlock.errors.failed";
}

export function UnlockScreen({ onUnlock, onUnlockWithRecoveryKey }: UnlockScreenProps) {
  const t = useTranslations();
  const errorId = useId();
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<UnlockMode>("passphrase");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (busy) {
      return;
    }

    const secret = mode === "passphrase" ? value : value.trim();

    if (secret.length === 0) {
      setError(
        mode === "passphrase"
          ? "encryption.unlock.requiredPassphrase"
          : "encryption.unlock.requiredRecoveryKey"
      );
      inputRef.current?.focus();
      return;
    }

    setBusy(true);
    setError(null);

    try {
      if (mode === "passphrase") {
        await onUnlock(secret);
      } else {
        await onUnlockWithRecoveryKey(secret);
      }
    } catch (failure) {
      setError(messageFor(failure));
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  const passphrase = mode === "passphrase";
  const label = passphrase
    ? t("encryption.unlock.passphrase")
    : t("encryption.unlock.recoveryKey");
  const hint = passphrase
    ? t("encryption.unlock.passphraseHint")
    : t("encryption.unlock.recoveryHint");
  const describedBy = error === null ? hintId : `${hintId} ${errorId}`;

  return (
    <main className="bg-background grid min-h-dvh place-items-center px-5 py-10">
      <section
        aria-labelledby="unlock-title"
        className="border-border bg-surface w-full max-w-md rounded-3xl border p-6 shadow-sm sm:p-8"
      >
        <div className="mb-6 space-y-2">
          <div className="bg-primary text-primary-foreground mb-4 grid size-11 place-items-center rounded-2xl text-base font-bold">
            O
          </div>
          <h1 id="unlock-title" className="text-2xl font-semibold tracking-tight">
            {t("encryption.unlock.title")}
          </h1>
          <p className="text-muted text-sm leading-6">
            {t("encryption.unlock.description")}
          </p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <div className="space-y-2">
            <label htmlFor="unlock-secret" className="block text-sm font-medium">
              {label}
            </label>
            <input
              ref={inputRef}
              id="unlock-secret"
              name={passphrase ? "passphrase" : "recovery-key"}
              type={passphrase ? "password" : "text"}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
              }}
              placeholder={
                passphrase
                  ? t("encryption.unlock.passphrasePlaceholder")
                  : t("encryption.unlock.recoveryKeyPlaceholder")
              }
              autoComplete={passphrase ? "current-password" : "off"}
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={error !== null}
              aria-describedby={describedBy}
              className="border-border bg-background focus-visible:outline-primary min-h-12 w-full rounded-xl border px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2"
            />
            <p id={hintId} className="text-muted text-xs leading-5">
              {hint}
            </p>
            {error === null ? null : (
              <p
                id={errorId}
                role="alert"
                className="text-sm text-red-700 dark:text-red-400"
              >
                {t(error)}
              </p>
            )}
          </div>

          <Button type="submit" size="lg" className="w-full" loading={busy}>
            {busy ? t("encryption.unlock.unlocking") : t("encryption.unlock.unlock")}
          </Button>
        </form>

        <Button
          type="button"
          variant="ghost"
          className="mt-3 w-full"
          onClick={() => {
            setMode((current) => (current === "passphrase" ? "recovery" : "passphrase"));
            setValue("");
            setError(null);
          }}
        >
          {passphrase
            ? t("encryption.unlock.useRecoveryKey")
            : t("encryption.unlock.usePassphrase")}
        </Button>
      </section>
    </main>
  );
}
