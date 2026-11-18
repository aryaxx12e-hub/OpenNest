"use client";

import Link from "next/link";

import { useTranslations } from "@opennest/localization";
import { Card } from "@opennest/ui";

import { recoveryTip, type RecoveryTip } from "@/lib/data/recovery";

export interface RecoveryGuideProps {
  error: string | null;
}

export function RecoveryGuide({ error }: RecoveryGuideProps) {
  const t = useTranslations();
  const tip: RecoveryTip | null = recoveryTip(error);

  if (tip === null) {
    return null;
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">{t("backup.recovery.title")}</h2>
        <p className="text-muted text-sm leading-5">{t("backup.recovery.intro")}</p>
      </div>

      <p className="text-sm leading-5">{t(`backup.recovery.${tip}`)}</p>

      <ol className="list-decimal space-y-1 pl-5 text-sm leading-5">
        <li>{t("backup.recovery.tryAnother")}</li>
        <li>{t("backup.recovery.checkKey")}</li>
        <li>{t("backup.recovery.freeSpace")}</li>
      </ol>

      {tip === "drafts" ? (
        <p className="text-muted text-xs leading-5">
          {t("backup.recovery.clearSiteData")}
        </p>
      ) : null}

      <Link
        href="/privacy"
        className="text-primary inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline"
      >
        {t("backup.recovery.diagnostics")}
      </Link>
    </Card>
  );
}
