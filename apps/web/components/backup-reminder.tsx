"use client";

import Link from "next/link";

import { useLocale, useTranslations } from "@opennest/localization";
import { Card } from "@opennest/ui";

import { backupReminderStatus } from "@/lib/data/backup-reminder";
import { formatCalendarDate } from "@/lib/format";

export interface BackupReminderProps {
  lastBackupAt: string | null;
  now?: Date;
}

export function BackupReminder({ lastBackupAt, now }: BackupReminderProps) {
  const t = useTranslations();
  const { locale } = useLocale();
  const status = backupReminderStatus(lastBackupAt, now);

  if (!status.due) {
    return null;
  }

  return (
    <Card className="space-y-2 p-4">
      <h2 className="text-sm font-semibold">
        {status.never ? t("backup.reminder.neverTitle") : t("backup.reminder.dueTitle")}
      </h2>
      <p className="text-muted text-sm leading-5">
        {status.never ? t("backup.reminder.neverBody") : t("backup.reminder.dueBody")}
      </p>
      {status.lastBackupAt === null ? null : (
        <p className="text-muted text-xs">
          {t("backup.lastBackup")}: {formatCalendarDate(locale, status.lastBackupAt)}
        </p>
      )}
      <Link
        href="/settings#backup"
        className="text-primary inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline"
      >
        {t("backup.reminder.action")}
      </Link>
    </Card>
  );
}
