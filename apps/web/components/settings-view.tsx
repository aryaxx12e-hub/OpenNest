"use client";

import { useTranslations } from "@opennest/localization";

import { BackupPanel } from "@/components/backup-panel";
import { PageHeader } from "@/components/page-header";

export function SettingsView() {
  const t = useTranslations();

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <PageHeader title={t("settings.title")} description={t("settings.subtitle")} />
      <BackupPanel />
    </div>
  );
}
