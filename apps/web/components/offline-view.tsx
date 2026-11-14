"use client";

import { useTranslations } from "@opennest/localization";
import { Button } from "@opennest/ui";

export function OfflineView() {
  const t = useTranslations();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col px-4 py-12 sm:px-6">
      <section className="border-border bg-surface rounded-2xl border p-6 sm:p-8">
        <p className="text-muted text-xs font-semibold tracking-wide uppercase">
          {t("pwa.offline")}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {t("pwa.offlineTitle")}
        </h1>
        <p className="text-muted mt-3 text-sm leading-6">{t("pwa.offlineDescription")}</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <a
            href="/library"
            className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-primary inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {t("pwa.offlineLibrary")}
          </a>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            {t("pwa.offlineRetry")}
          </Button>
        </div>
        <p className="text-muted mt-4 text-xs">{t("pwa.offlineHint")}</p>
      </section>
    </div>
  );
}
