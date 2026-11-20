"use client";

import { locales, useLocale, useTranslations } from "@opennest/localization";

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();
  const t = useTranslations();

  return (
    <label className="text-muted flex items-center gap-2 text-xs">
      <span className="sr-only">{t("common.language")}</span>
      <select
        value={locale}
        aria-label={t("common.language")}
        onChange={(event) => {
          const next = event.target.value;
          const match = locales.find((candidate) => candidate === next);
          if (match !== undefined) {
            setLocale(match);
          }
        }}
        className="border-border bg-surface text-foreground rounded-control min-h-11 w-[4.5rem] border px-2 text-sm"
      >
        <option value="en">EN</option>
        <option value="id">ID</option>
      </select>
    </label>
  );
}
