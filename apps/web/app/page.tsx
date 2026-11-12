"use client";

import { useState } from "react";

import { Button, Card } from "@opennest/ui";
import { useTranslations } from "@opennest/localization";

import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";

const steps = [
  { title: "home.stepStorageTitle", body: "home.stepStorageBody" },
  { title: "home.stepBackupTitle", body: "home.stepBackupBody" },
  { title: "home.stepOfflineTitle", body: "home.stepOfflineBody" },
] as const;

export default function HomePage() {
  const t = useTranslations();
  const [showAll, setShowAll] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6 lg:py-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted text-sm font-medium tracking-wide uppercase">
          {t("home.eyebrow")}
        </p>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>

      <header className="flex flex-col gap-3">
        <h1 className="text-3xl leading-tight font-semibold sm:text-4xl">
          {t("home.title")}
        </h1>
        <p className="text-muted text-base leading-relaxed sm:text-lg">
          {t("home.intro")}
        </p>
      </header>

      <section aria-labelledby="getting-started" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="getting-started" className="text-xl font-semibold">
            {t("home.gettingStarted")}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAll((value) => !value)}
            aria-expanded={showAll}
            aria-controls="getting-started-steps"
            className="text-primary underline-offset-4 hover:underline"
          >
            {showAll ? t("common.less") : t("common.more")}
          </Button>
        </div>

        <p className="text-muted text-sm leading-relaxed">
          {t("home.gettingStartedBody")}
        </p>

        <div id="getting-started-steps" className="grid gap-4 sm:grid-cols-2">
          {steps.slice(0, showAll ? steps.length : 2).map((step) => (
            <Card key={step.title} className="flex flex-col gap-2">
              <h3 className="text-base font-semibold">{t(step.title)}</h3>
              <p className="text-muted text-sm leading-relaxed">{t(step.body)}</p>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="whats-next" className="flex flex-col gap-3">
        <h2 id="whats-next" className="text-xl font-semibold">
          {t("home.previewTitle")}
        </h2>
        <p className="text-muted text-sm leading-relaxed">{t("home.previewBody")}</p>
      </section>
    </div>
  );
}
