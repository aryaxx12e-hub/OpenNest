"use client";

import Link from "next/link";

import { useTranslations } from "@opennest/localization";
import { Card } from "@opennest/ui";

import { BackupPanel } from "@/components/backup-panel";
import { PageHeader } from "@/components/page-header";

export function SettingsView() {
  const t = useTranslations();

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <PageHeader title={t("settings.title")} description={t("settings.subtitle")} />
      <Card className="space-y-2">
        <h2 className="text-lg font-semibold">{t("settings.privacyTitle")}</h2>
        <p className="text-muted text-sm leading-6">{t("settings.privacyBody")}</p>
        <Link
          href="/privacy"
          className="text-primary inline-flex min-h-11 items-center text-sm font-medium underline"
        >
          {t("settings.privacyAction")}
        </Link>
      </Card>
      <BackupPanel />
    </div>
  );
}
