import { formatDate, formatNumber, type Locale } from "@opennest/localization";

const units = ["B", "KB", "MB", "GB"] as const;

export function formatBytes(locale: Locale, bytes: number): string {
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const maximumFractionDigits = unit === 0 || value >= 10 ? 0 : 1;

  return `${formatNumber(locale, value, { maximumFractionDigits })} ${units[unit]}`;
}

export function formatDateTime(locale: Locale, iso: string): string {
  return formatDate(locale, new Date(iso), {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatCalendarDate(locale: Locale, iso: string): string {
  return formatDate(locale, new Date(iso), { dateStyle: "medium" });
}
