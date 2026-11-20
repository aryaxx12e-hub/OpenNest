"use client";

import Link from "next/link";

import { useTranslations } from "@opennest/localization";
import { Card } from "@opennest/ui";

import { AiSettings } from "@/components/ai-settings";
import { BackupPanel } from "@/components/backup-panel";
import { EncryptionSettings } from "@/components/encryption-settings";
import { EncryptionSetup } from "@/components/encryption-setup";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { useEncryption } from "@/lib/crypto/encryption-gate";
import { useAppData } from "@/lib/data/app-data-provider";

export function SettingsView() {
  const t = useTranslations();
  const { ai, credentials } = useAppData();
  const encryption = useEncryption();

  return (
    <PageContainer>
      <PageHeader title={t("settings.title")} description={t("settings.subtitle")} />
      <div className="grid gap-4 sm:grid-cols-2">
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
        <Card className="space-y-2">
          <h2 className="text-lg font-semibold">{t("settings.extensionsTitle")}</h2>
          <p className="text-muted text-sm leading-6">{t("settings.extensionsBody")}</p>
          <Link
            href="/extensions"
            className="text-primary inline-flex min-h-11 items-center text-sm font-medium underline"
          >
            {t("settings.extensionsAction")}
          </Link>
        </Card>
      </div>
      <AiSettings ai={ai} credentials={credentials} />
      {encryption.status === "plaintext" ? <EncryptionSetup /> : null}
      {encryption.status === "unlocked" ? <EncryptionSettings /> : null}
      <BackupPanel />
    </PageContainer>
  );
}
