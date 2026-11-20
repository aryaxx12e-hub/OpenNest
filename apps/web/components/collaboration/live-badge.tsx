"use client";

import { useTranslations } from "@opennest/localization";
import { cn } from "@opennest/ui";

import type { CollaborationStatus } from "@/lib/collaboration/provider";

export interface LiveBadgeProps {
  status: CollaborationStatus;
  readOnly?: boolean;
  className?: string;
}

const dotClasses: Record<CollaborationStatus, string> = {
  disabled: "bg-muted",
  connecting: "bg-amber-600 dark:bg-amber-400",
  connected: "bg-emerald-600 dark:bg-emerald-400",
  reconnecting: "bg-amber-600 dark:bg-amber-400",
  offline: "bg-amber-600 dark:bg-amber-400",
  error: "bg-red-600 dark:bg-red-400",
};

export function LiveBadge({ status, readOnly = false, className }: LiveBadgeProps) {
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
      <span>{t(`collaboration.status.${status}`)}</span>
      {readOnly ? (
        <span>
          <span aria-hidden="true">·</span> {t("collaboration.readOnly")}
        </span>
      ) : null}
    </span>
  );
}
