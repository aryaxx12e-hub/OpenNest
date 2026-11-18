const BACKUP_RECORD_KEY = "opennest:backup:last-export";
const BACKUP_RECORD_EVENT = "opennest:backup:record-changed";
const DAY_MS = 24 * 60 * 60 * 1000;

export const BACKUP_REMINDER_DAYS = 14;

export interface BackupReminderStatus {
  lastBackupAt: string | null;
  daysSince: number | null;
  due: boolean;
  never: boolean;
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readLastBackupAt(
  storage: Pick<Storage, "getItem"> | null = browserStorage()
): string | null {
  if (storage === null) {
    return null;
  }

  try {
    const value = storage.getItem(BACKUP_RECORD_KEY);

    return value !== null && !Number.isNaN(Date.parse(value)) ? value : null;
  } catch {
    return null;
  }
}

export function recordBackupExported(
  at: Date = new Date(),
  storage: Pick<Storage, "setItem"> | null = browserStorage()
): string | null {
  if (storage === null) {
    return null;
  }

  try {
    const value = at.toISOString();
    storage.setItem(BACKUP_RECORD_KEY, value);
    notifyBackupRecordChanged();

    return value;
  } catch {
    return null;
  }
}

export function clearBackupRecord(
  storage: Pick<Storage, "removeItem"> | null = browserStorage()
): void {
  if (storage === null) {
    return;
  }

  try {
    storage.removeItem(BACKUP_RECORD_KEY);
    notifyBackupRecordChanged();
  } catch {
    return;
  }
}

function notifyBackupRecordChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(BACKUP_RECORD_EVENT));
  }
}

export function subscribeBackupRecord(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === BACKUP_RECORD_KEY || event.key === null) {
      onChange();
    }
  };

  window.addEventListener("storage", onStorage);
  window.addEventListener(BACKUP_RECORD_EVENT, onChange);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(BACKUP_RECORD_EVENT, onChange);
  };
}

export function backupReminderStatus(
  lastBackupAt: string | null,
  now: Date = new Date()
): BackupReminderStatus {
  if (lastBackupAt === null || Number.isNaN(Date.parse(lastBackupAt))) {
    return {
      lastBackupAt: null,
      daysSince: null,
      due: true,
      never: true,
    };
  }

  const daysSince = Math.max(
    0,
    Math.floor((now.getTime() - Date.parse(lastBackupAt)) / DAY_MS)
  );

  return {
    lastBackupAt,
    daysSince,
    due: daysSince >= BACKUP_REMINDER_DAYS,
    never: false,
  };
}
