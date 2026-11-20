"use client";

import { formatNumber, useLocale, useTranslations } from "@opennest/localization";
import { Card } from "@opennest/ui";

import { formatBytes } from "@/lib/format";
import type { DataOverview } from "@/lib/privacy/data-controls";

export function PrivacyOverview({ overview }: { overview: DataOverview }) {
  const t = useTranslations();
  const { locale } = useLocale();
  const stats = [
    { label: t("privacy.overview.bytes"), value: formatBytes(locale, overview.bytes) },
    {
      label: t("privacy.overview.items"),
      value: formatNumber(locale, overview.totalItems),
    },
    { label: t("privacy.overview.grants"), value: formatNumber(locale, overview.grants) },
    {
      label: t("privacy.overview.audit"),
      value: formatNumber(locale, overview.auditEntries),
    },
  ];
  const counts = [
    { label: t("privacy.overview.files"), value: overview.files },
    { label: t("privacy.overview.notes"), value: overview.notes },
    { label: t("privacy.overview.folders"), value: overview.folders },
    { label: t("privacy.overview.tags"), value: overview.tags },
    { label: t("privacy.overview.drafts"), value: overview.drafts },
  ];

  return (
    <Card className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t("privacy.overview.title")}</h2>
        <p className="text-muted text-sm leading-6">
          {t("privacy.overview.description")}
        </p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="border-border bg-surface-muted rounded-control border p-3"
          >
            <dt className="text-muted text-xs font-medium tracking-wide uppercase">
              {stat.label}
            </dt>
            <dd className="mt-1 text-xl font-semibold">{stat.value}</dd>
          </div>
        ))}
      </dl>

      <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {counts.map((count) => (
          <div key={count.label} className="flex items-baseline justify-between gap-2">
            <dt className="text-muted text-sm">{count.label}</dt>
            <dd className="text-sm font-semibold">{formatNumber(locale, count.value)}</dd>
          </div>
        ))}
      </dl>

      <p className="border-border text-muted rounded-control border border-dashed p-3 text-xs leading-5">
        {t("privacy.backup.notice")}
      </p>
    </Card>
  );
}
