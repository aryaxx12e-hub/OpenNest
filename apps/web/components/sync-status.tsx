"use client";

import { useTranslations } from "@opennest/localization";
import { cn } from "@opennest/ui";

import type { SyncStatus as SyncStatusValue } from "@/lib/sync/client";

export interface SyncStatusProps {
  status: SyncStatusValue;
  pendingCount?: number;
  className?: string;
}

const dotClasses: Record<SyncStatusValue, string> = {
  connecting: "bg-amber-600 dark:bg-amber-400",
  online: "bg-emerald-600 dark:bg-emerald-400",
  offline: "bg-amber-600 dark:bg-amber-400",
  syncing: "bg-primary",
  error: "bg-red-600 dark:bg-red-400",
  disabled: "bg-muted",
};

export function SyncStatus({ status, pendingCount = 0, className }: SyncStatusProps) {
  const t = useTranslations();

  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "border-border bg-surface text-muted inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium",
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-2 rounded-full", dotClasses[status])}
      />
      <span>{t(`sync.status.${status}`)}</span>
      {pendingCount > 0 ? (
        <span className="text-muted tabular-nums">
          <span aria-hidden="true">·</span> {pendingCount} {t("sync.pending")}
        </span>
      ) : null}
    </span>
  );
}
