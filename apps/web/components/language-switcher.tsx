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
        onChange={(event) => {
          const next = event.target.value;
          const match = locales.find((candidate) => candidate === next);
          if (match !== undefined) {
            setLocale(match);
          }
        }}
        className="border-border bg-surface text-foreground min-h-11 rounded-lg border px-2 text-sm"
      >
        <option value="en">English</option>
        <option value="id">Bahasa Indonesia</option>
      </select>
    </label>
  );
}
