import type { SyncEntityType } from "./types";

export interface SyncPolicy {
  outbox: {
    enabled: boolean;
    maxRows: number;
    retentionMs: number;
  };
}

export const DEFAULT_SYNC_POLICY: SyncPolicy = {
  outbox: {
    enabled: false,
    maxRows: 1000,
    retentionMs: 30 * 24 * 60 * 60 * 1000,
  },
};

export const MERGE_SAFE_FIELDS = ["note.pinned", "tag.color"] as const;

const mergeSafeFields = new Set<string>(MERGE_SAFE_FIELDS);

export function fieldClass(
  entityType: SyncEntityType,
  fieldPath: string
): "merge-safe" | "content-bearing" {
  return mergeSafeFields.has(`${entityType}.${fieldPath}`)
    ? "merge-safe"
    : "content-bearing";
}

export function canonicalIdList(ids: readonly string[]): string[] {
  return Array.from(new Set(ids)).sort();
}
