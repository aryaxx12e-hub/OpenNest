"use client";

import { useTranslations } from "@opennest/localization";
import { Button } from "@opennest/ui";

import type {
  EncryptionOperation,
  EncryptionOperationPhase,
} from "@/lib/crypto/encryption-gate";

const PHASE_KEYS: Record<EncryptionOperationPhase, string> = {
  start: "encryption.operation.phases.start",
  drafts: "encryption.operation.phases.drafts",
  snapshot: "encryption.operation.phases.snapshot",
  verify: "encryption.operation.phases.verify",
  restore: "encryption.operation.phases.restore",
  cleanup: "encryption.operation.phases.cleanup",
  active: "encryption.operation.phases.active",
  "drafts-stage": "encryption.operation.phases.draftsStage",
  "drafts-finalize": "encryption.operation.phases.draftsFinalize",
  "drafts-discard": "encryption.operation.phases.draftsDiscard",
};

export interface EncryptionOperationScreenProps {
  operation: EncryptionOperation;
  onCancelSetup: () => Promise<void>;
  onDismiss: () => void;
}

export function EncryptionOperationScreen({
  operation,
  onCancelSetup,
  onDismiss,
}: EncryptionOperationScreenProps) {
  const t = useTranslations();
  const total = Math.max(operation.progress.total, 1);
  const completed = Math.min(operation.progress.completed, total);
  const percent = Math.round((completed / total) * 100);
  const setup = operation.kind === "setup";

  return (
    <main className="bg-background grid min-h-dvh place-items-center px-5 py-10">
      <section
        aria-labelledby="encryption-operation-title"
        className="border-border bg-surface w-full max-w-md rounded-3xl border p-6 shadow-sm sm:p-8"
      >
        <div className="mb-6 space-y-2">
          <div className="bg-primary text-primary-foreground mb-4 grid size-11 place-items-center rounded-2xl text-base font-bold">
            O
          </div>
          <h1
            id="encryption-operation-title"
            className="text-2xl font-semibold tracking-tight"
          >
            {setup
              ? t("encryption.operation.setupTitle")
              : t("encryption.operation.rotationTitle")}
          </h1>
          <p className="text-muted text-sm leading-6">
            {setup
              ? t("encryption.operation.setupDescription")
              : t("encryption.operation.rotationDescription")}
          </p>
        </div>

        <div className="space-y-2">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={t("encryption.operation.progressLabel")}
            className="bg-border h-2 overflow-hidden rounded-full"
          >
            <div
              className="bg-primary h-full rounded-full transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="text-muted flex items-center justify-between gap-3 text-xs">
            <span>{t(PHASE_KEYS[operation.progress.phase])}</span>
            <span>{`${completed} / ${total}`}</span>
          </div>
        </div>

        {operation.error === null ? null : (
          <div className="mt-5 space-y-3">
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {t("encryption.operation.failed")}
            </p>
            {setup ? (
              <Button variant="secondary" onClick={() => void onCancelSetup()}>
                {t("encryption.operation.cancel")}
              </Button>
            ) : operation.canDismiss ? (
              <Button variant="secondary" onClick={onDismiss}>
                {t("encryption.operation.dismiss")}
              </Button>
            ) : null}
          </div>
        )}

        {operation.error === null && setup ? (
          <Button
            variant="secondary"
            className="mt-5"
            onClick={() => void onCancelSetup()}
          >
            {t("encryption.operation.cancel")}
          </Button>
        ) : null}
      </section>
    </main>
  );
}
