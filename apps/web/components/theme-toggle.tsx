"use client";

import { useCallback, useSyncExternalStore } from "react";

import { useTranslations } from "@opennest/localization";
import { MoonIcon, SunIcon } from "@opennest/ui";

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
      className="text-foreground hover:bg-border/40 rounded-control inline-flex min-h-11 min-w-11 items-center justify-center gap-2 px-0 text-sm font-medium sm:px-3"
    >
      {dark ? <SunIcon className="size-5" /> : <MoonIcon className="size-5" />}
      <span className="hidden sm:inline">
        {dark ? t("common.light") : t("common.dark")}
      </span>
    </button>
  );
}
