"use client";

import { useTranslations } from "@opennest/localization";
import { Button, Card } from "@opennest/ui";

import { PageContainer } from "@/components/page-container";

export function OfflineView() {
  const t = useTranslations();

  return (
    <PageContainer className="max-w-2xl py-12">
      <Card className="rounded-panel space-y-4 p-6 sm:p-8">
        <p className="text-muted text-xs font-semibold tracking-wide uppercase">
          {t("pwa.offline")}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {t("pwa.offlineTitle")}
        </h1>
        <p className="text-muted text-sm leading-6">{t("pwa.offlineDescription")}</p>
        <div className="flex flex-wrap gap-2 pt-2">
          <a
            href="/library"
            className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-primary rounded-control inline-flex min-h-11 items-center justify-center px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {t("pwa.offlineLibrary")}
          </a>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            {t("pwa.offlineRetry")}
          </Button>
        </div>
        <p className="text-muted text-xs">{t("pwa.offlineHint")}</p>
      </Card>
    </PageContainer>
  );
}
