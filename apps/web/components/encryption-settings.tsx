"use client";

import { useId, useState, type FormEvent } from "react";

import { CryptoError } from "@opennest/crypto";
import { useTranslations } from "@opennest/localization";
import { Badge, Button, Card, ConfirmDialog, Input, Label } from "@opennest/ui";

import { useEncryption } from "@/lib/crypto/encryption-gate";

const MIN_PASSPHRASE = 12;

function changeErrorKey(error: unknown): string {
  if (error instanceof CryptoError) {
    if (error.code === "authentication_failed") {
      return "encryption.settings.errors.currentWrong";
    }

    if (error.code === "rate_limited") {
      return "encryption.settings.errors.rateLimited";
    }

    if (error.code === "pending_rotation") {
      return "encryption.settings.errors.pendingRotation";
    }
  }

  return "encryption.settings.errors.changeFailed";
}

export function EncryptionSettings() {
  const t = useTranslations();
  const ids = useId();
  const { status, pendingRotation, notice, changePassphrase, rotate, lock, clearNotice } =
    useEncryption();
  const [currentPassphrase, setCurrentPassphrase] = useState("");
  const [nextPassphrase, setNextPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [changeBusy, setChangeBusy] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [changeSuccess, setChangeSuccess] = useState(false);
  const [rotationPassphrase, setRotationPassphrase] = useState("");
  const [rotationOpen, setRotationOpen] = useState(false);
  const [rotationBusy, setRotationBusy] = useState(false);
  const [rotationError, setRotationError] = useState<string | null>(null);

  if (status !== "unlocked") {
    return null;
  }

  async function submitChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (changeBusy) {
      return;
    }

    if (currentPassphrase.trim().length === 0) {
      setChangeError("encryption.settings.errors.currentRequired");
      return;
    }

    if (nextPassphrase.length < MIN_PASSPHRASE) {
      setChangeError("encryption.settings.errors.nextTooShort");
      return;
    }

    if (nextPassphrase !== confirmation) {
      setChangeError("encryption.settings.errors.mismatch");
      return;
    }

    setChangeBusy(true);
    setChangeError(null);
    setChangeSuccess(false);

    try {
      await changePassphrase(currentPassphrase, nextPassphrase);
      setCurrentPassphrase("");
      setNextPassphrase("");
      setConfirmation("");
      setChangeSuccess(true);
      clearNotice();
    } catch (error) {
      setChangeError(changeErrorKey(error));
    } finally {
      setChangeBusy(false);
    }
  }

  function requestRotation() {
    if (rotationPassphrase.trim().length === 0) {
      setRotationError("encryption.settings.errors.rotationPassphrase");
      return;
    }

    setRotationError(null);
    setRotationOpen(true);
  }

  async function confirmRotation() {
    if (rotationBusy) {
      return;
    }

    setRotationBusy(true);
    setRotationError(null);

    try {
      await rotate(rotationPassphrase);
      setRotationOpen(false);
      setRotationPassphrase("");
    } catch (error) {
      setRotationOpen(false);
      setRotationError(
        error instanceof CryptoError && error.code === "authentication_failed"
          ? "encryption.settings.errors.currentWrong"
          : "encryption.settings.errors.rotationFailed"
      );
    } finally {
      setRotationBusy(false);
    }
  }

  const success = notice === null ? null : t(notice);

  return (
    <section className="space-y-4">
      <Card className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{t("encryption.settings.title")}</h2>
            <p className="text-muted text-sm leading-6">
              {t("encryption.settings.description")}
            </p>
          </div>
          <Badge tone={pendingRotation ? "warning" : "success"}>
            {pendingRotation
              ? t("encryption.settings.pending")
              : t("encryption.settings.active")}
          </Badge>
        </div>

        {pendingRotation ? (
          <p role="status" className="text-muted text-sm leading-6">
            {t("encryption.settings.pendingRecovery")}
          </p>
        ) : null}

        {success === null && !changeSuccess ? null : (
          <p role="status" className="text-sm font-medium">
            {success ?? t("encryption.settings.passphraseSuccess")}
          </p>
        )}

        <Button variant="secondary" onClick={() => void lock()}>
          {t("encryption.settings.lockNow")}
        </Button>
      </Card>

      <Card className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">
            {t("encryption.settings.passphraseTitle")}
          </h3>
          <p className="text-muted text-sm leading-6">
            {t("encryption.settings.passphraseDescription")}
          </p>
        </div>

        <form className="space-y-3" onSubmit={submitChange} noValidate>
          <div className="space-y-1">
            <Label htmlFor={`${ids}-current`}>
              {t("encryption.settings.currentPassphrase")}
            </Label>
            <Input
              id={`${ids}-current`}
              type="password"
              autoComplete="current-password"
              value={currentPassphrase}
              disabled={changeBusy}
              aria-invalid={changeError !== null}
              onChange={(event) => {
                setCurrentPassphrase(event.target.value);
                setChangeError(null);
                setChangeSuccess(false);
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${ids}-next`}>
              {t("encryption.settings.newPassphrase")}
            </Label>
            <Input
              id={`${ids}-next`}
              type="password"
              autoComplete="new-password"
              value={nextPassphrase}
              placeholder={t("encryption.settings.passphrasePlaceholder")}
              disabled={changeBusy}
              aria-invalid={changeError !== null}
              onChange={(event) => {
                setNextPassphrase(event.target.value);
                setChangeError(null);
                setChangeSuccess(false);
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${ids}-confirm`}>
              {t("encryption.settings.confirmPassphrase")}
            </Label>
            <Input
              id={`${ids}-confirm`}
              type="password"
              autoComplete="new-password"
              value={confirmation}
              disabled={changeBusy}
              aria-invalid={changeError !== null}
              onChange={(event) => {
                setConfirmation(event.target.value);
                setChangeError(null);
                setChangeSuccess(false);
              }}
            />
          </div>

          {changeError === null ? null : (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {t(changeError)}
            </p>
          )}

          <Button type="submit" loading={changeBusy}>
            {changeBusy
              ? t("encryption.settings.changing")
              : t("encryption.settings.changeAction")}
          </Button>
        </form>
      </Card>

      <Card className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">
            {t("encryption.settings.rotationTitle")}
          </h3>
          <p className="text-muted text-sm leading-6">
            {t("encryption.settings.rotationDescription")}
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor={`${ids}-rotation`}>
            {t("encryption.settings.rotationPassphrase")}
          </Label>
          <Input
            id={`${ids}-rotation`}
            data-testid="rotation-passphrase"
            type="password"
            autoComplete="current-password"
            value={rotationPassphrase}
            disabled={rotationBusy}
            aria-invalid={rotationError !== null}
            onChange={(event) => {
              setRotationPassphrase(event.target.value);
              setRotationError(null);
            }}
          />
        </div>

        {rotationError === null ? null : (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {t(rotationError)}
          </p>
        )}

        <Button variant="secondary" disabled={rotationBusy} onClick={requestRotation}>
          {t("encryption.settings.rotateAction")}
        </Button>
      </Card>

      <ConfirmDialog
        open={rotationOpen}
        title={t("encryption.settings.rotationConfirmTitle")}
        description={t("encryption.settings.rotationConfirmDescription")}
        confirmLabel={t("encryption.settings.rotateAction")}
        cancelLabel={t("common.cancel")}
        busy={rotationBusy}
        onConfirm={() => void confirmRotation()}
        onClose={() => {
          if (!rotationBusy) {
            setRotationOpen(false);
          }
        }}
      >
        <p className="text-muted text-xs leading-5">
          {t("encryption.settings.rotationWarning")}
        </p>
      </ConfirmDialog>
    </section>
  );
}
