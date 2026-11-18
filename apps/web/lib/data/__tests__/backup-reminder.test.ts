import { describe, expect, it } from "vitest";

import {
  backupReminderStatus,
  clearBackupRecord,
  readLastBackupAt,
  recordBackupExported,
} from "../backup-reminder";

const KEY = "opennest:backup:last-export";
const NOW = new Date("2026-11-18T12:00:00.000Z");
const AT = "2026-11-18T09:30:00.000Z";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));

  return {
    values,
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

describe("readLastBackupAt", () => {
  it("returns a stored ISO timestamp", () => {
    expect(readLastBackupAt(memoryStorage({ [KEY]: AT }))).toBe(AT);
  });

  it("treats an invalid timestamp as missing", () => {
    expect(readLastBackupAt(memoryStorage({ [KEY]: "not a date" }))).toBeNull();
  });

  it("returns null when storage is blocked", () => {
    expect(
      readLastBackupAt({
        getItem() {
          throw new Error("blocked");
        },
      })
    ).toBeNull();
  });
});

describe("recordBackupExported", () => {
  it("stores the export timestamp", () => {
    const storage = memoryStorage();
    const recorded = recordBackupExported(new Date(AT), storage);

    expect(recorded).toBe(AT);
    expect(storage.values.get(KEY)).toBe(AT);
  });

  it("returns null when storage rejects the write", () => {
    expect(
      recordBackupExported(new Date(AT), {
        setItem() {
          throw new Error("blocked");
        },
      })
    ).toBeNull();
  });
});

describe("clearBackupRecord", () => {
  it("removes the stored timestamp", () => {
    const storage = memoryStorage({ [KEY]: AT });

    clearBackupRecord(storage);

    expect(storage.values.has(KEY)).toBe(false);
  });
});

describe("backupReminderStatus", () => {
  it("reports a missing backup as due and never", () => {
    expect(backupReminderStatus(null, NOW)).toEqual({
      lastBackupAt: null,
      daysSince: null,
      due: true,
      never: true,
    });
  });

  it("does not report a backup from 13 days ago as due", () => {
    const status = backupReminderStatus("2026-11-05T12:00:00.000Z", NOW);

    expect(status.daysSince).toBe(13);
    expect(status.due).toBe(false);
    expect(status.never).toBe(false);
  });

  it("reports a backup from 14 days ago as due", () => {
    const status = backupReminderStatus("2026-11-04T12:00:00.000Z", NOW);

    expect(status.daysSince).toBe(14);
    expect(status.due).toBe(true);
  });

  it("clamps a future timestamp to zero days", () => {
    expect(backupReminderStatus("2026-11-19T12:00:00.000Z", NOW).daysSince).toBe(0);
  });
});
