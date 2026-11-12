import type { Locale } from "./provider";

const intlLocales: Record<Locale, string> = {
  en: "en-US",
  id: "id-ID",
};

export function formatDate(
  locale: Locale,
  value: Date | number,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }
): string {
  return new Intl.DateTimeFormat(intlLocales[locale], options).format(value);
}

export function formatNumber(
  locale: Locale,
  value: number,
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat(intlLocales[locale], options).format(value);
}

export function formatRelativeTime(
  locale: Locale,
  value: number,
  unit: Intl.RelativeTimeFormatUnit
): string {
  return new Intl.RelativeTimeFormat(intlLocales[locale], { numeric: "auto" }).format(
    value,
    unit
  );
}
