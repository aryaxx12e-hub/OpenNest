"use client";

import { useCallback, useSyncExternalStore } from "react";

import { useTranslations } from "@opennest/localization";

import { isDarkTheme, setTheme, subscribeToTheme } from "@/lib/theme";

function getServerSnapshot(): boolean {
  return false;
}

export function ThemeToggle() {
  const t = useTranslations();
  const dark = useSyncExternalStore(subscribeToTheme, isDarkTheme, getServerSnapshot);

  const toggle = useCallback(() => {
    setTheme(!isDarkTheme());
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={dark}
      aria-label={t("common.toggleTheme")}
      className="text-foreground hover:bg-border/40 min-h-11 rounded-lg px-3 text-sm font-medium"
    >
      {dark ? t("common.light") : t("common.dark")}
    </button>
  );
}
