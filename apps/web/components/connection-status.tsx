"use client";

import { useSyncExternalStore } from "react";

import { useTranslations } from "@opennest/localization";
import { cn } from "@opennest/ui";

import {
  getConnectionServerSnapshot,
  getConnectionSnapshot,
  subscribeToConnection,
} from "@/lib/pwa";

export function ConnectionStatus() {
  const t = useTranslations();
  const online = useSyncExternalStore(
    subscribeToConnection,
    getConnectionSnapshot,
    getConnectionServerSnapshot
  );

  return (
    <span
      role="status"
      aria-live="polite"
      className="border-border bg-surface text-muted inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium"
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2 rounded-full",
          online ? "bg-emerald-600 dark:bg-emerald-400" : "bg-amber-600 dark:bg-amber-400"
        )}
      />
      <span className="sr-only sm:not-sr-only">
        {online ? t("pwa.online") : t("pwa.offline")}
      </span>
    </span>
  );
}
