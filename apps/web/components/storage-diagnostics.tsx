"use client";

import { formatNumber, useLocale, useTranslations } from "@opennest/localization";
import { Button, Card } from "@opennest/ui";

import { formatBytes } from "@/lib/format";
import type { StorageStatus } from "@/lib/privacy/storage-status";

export interface StorageDiagnosticsProps {
  status: StorageStatus;
  busy: boolean;
  onRequestPersist: () => void;
}

export function StorageDiagnostics({
  status,
  busy,
  onRequestPersist,
}: StorageDiagnosticsProps) {
  const t = useTranslations();
  const { locale } = useLocale();
  const persisted =
    status.persisted === true
      ? t("privacy.storage.granted")
      : status.persisted === false
        ? t("privacy.storage.denied")
        : t("privacy.storage.unknown");
  const percent =
    status.usage !== null && status.quota !== null && status.quota > 0
      ? formatNumber(locale, (status.usage / status.quota) * 100, {
          maximumFractionDigits: 1,
        })
      : null;

  return (
    <Card className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t("privacy.storage.title")}</h2>
        <p className="text-muted text-sm leading-6">{t("privacy.storage.description")}</p>
      </div>

      {status.supported ? (
        <>
          <dl className="grid gap-3 sm:grid-cols-3">
            <div className="border-border bg-surface-muted rounded-control border p-3">
              <dt className="text-muted text-xs font-medium tracking-wide uppercase">
                {t("privacy.storage.usage")}
              </dt>
              <dd className="mt-1 text-xl font-semibold">
                {status.usage === null
                  ? t("privacy.storage.unknown")
                  : formatBytes(locale, status.usage)}
              </dd>
            </div>
            <div className="border-border bg-surface-muted rounded-control border p-3">
              <dt className="text-muted text-xs font-medium tracking-wide uppercase">
                {t("privacy.storage.quota")}
              </dt>
              <dd className="mt-1 text-xl font-semibold">
                {status.quota === null
                  ? t("privacy.storage.unknown")
                  : formatBytes(locale, status.quota)}
              </dd>
            </div>
            {percent === null ? null : (
              <div className="border-border bg-surface-muted rounded-control border p-3">
                <dt className="text-muted text-xs font-medium tracking-wide uppercase">
                  {t("privacy.storage.percent")}
                </dt>
                <dd className="mt-1 text-xl font-semibold">{percent}%</dd>
              </div>
            )}
          </dl>

          <dl className="flex items-baseline justify-between gap-2">
            <dt className="text-muted text-sm">{t("privacy.storage.persisted")}</dt>
            <dd className="text-sm font-semibold">{persisted}</dd>
          </dl>

          {status.persisted === true ? null : (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={onRequestPersist}
            >
              {t("privacy.storage.request")}
            </Button>
          )}
        </>
      ) : (
        <p className="text-muted text-sm leading-6">{t("privacy.storage.unsupported")}</p>
      )}

      <p className="border-border text-muted rounded-control border border-dashed p-3 text-xs leading-5">
        {t("privacy.storage.notice")}
      </p>
    </Card>
  );
}
