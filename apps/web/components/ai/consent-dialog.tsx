"use client";

import { formatNumber, useLocale, useTranslations } from "@opennest/localization";
import { Button, Dialog } from "@opennest/ui";

import type { QaPrepared } from "@/lib/ai/qa";

export interface QaConsentDialogProps {
  open: boolean;
  prepared: QaPrepared | null;
  busy: boolean;
  onApprove: () => void;
  onCancel: () => void;
}

export function QaConsentDialog({
  open,
  prepared,
  busy,
  onApprove,
  onCancel,
}: QaConsentDialogProps) {
  const t = useTranslations();
  const { locale } = useLocale();

  if (prepared === null) {
    return null;
  }

  const provider = prepared.request.provider;

  return (
    <Dialog
      open={open}
      title={t("ai.qa.consentTitle")}
      description={t("ai.qa.consentDescription")}
      onClose={() => {
        if (!busy) {
          onCancel();
        }
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {busy ? t("ai.qa.stop") : t("ai.qa.cancel")}
          </Button>
          <Button onClick={onApprove} loading={busy}>
            {busy ? t("ai.qa.sending") : t("ai.qa.approve")}
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="qa-consent">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <dt className="text-muted">{t("ai.qa.consentProvider")}</dt>
          <dd>{provider.label}</dd>
          <dt className="text-muted">{t("ai.qa.consentOrigin")}</dt>
          <dd className="break-all">{prepared.request.prepared.origin}</dd>
          <dt className="text-muted">{t("ai.qa.consentModel")}</dt>
          <dd>{prepared.request.prepared.request.model}</dd>
          <dt className="text-muted">{t("ai.qa.consentClasses")}</dt>
          <dd>{prepared.request.dataClasses.join(", ")}</dd>
          <dt className="text-muted">{t("ai.qa.consentBytes")}</dt>
          <dd>
            {formatNumber(locale, prepared.payloadBytes)} {t("ai.qa.bytesUnit")}
          </dd>
        </dl>

        <div className="space-y-1">
          <p className="text-sm font-medium">{t("ai.qa.consentSources")}</p>
          <ul className="text-muted list-inside list-disc text-xs leading-5">
            {prepared.passages.map((passage) => (
              <li key={passage.id}>{passage.sourceTitle}</li>
            ))}
          </ul>
        </div>

        <div className="space-y-1">
          <p className="text-sm font-medium">{t("ai.qa.consentPrompt")}</p>
          <pre
            data-testid="qa-consent-prompt"
            className="border-border bg-border/20 rounded-control max-h-56 overflow-auto border p-3 text-xs whitespace-pre-wrap"
          >
            {prepared.prompt}
          </pre>
        </div>

        <p className="text-muted text-xs leading-5">{t("ai.qa.consentRetention")}</p>
      </div>
    </Dialog>
  );
}
