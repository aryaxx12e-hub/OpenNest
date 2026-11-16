import { generateId } from "@opennest/core";

import { canonicalJson } from "./hash";
import { canonicalIdList, fieldClass } from "./policy";
import type { SyncConflictRow, SyncEntityType } from "./types";

export interface FieldCandidate {
  workspaceId: string;
  entityType: SyncEntityType;
  entityId: string;
  fieldPath: string;
  value: unknown;
  fieldRevision: number;
  originDeviceId: string;
  opId: string;
  updatedAt: string;
}

export interface MergeOutcome {
  winner: "local" | "remote";
  value: unknown;
  losingValue: unknown;
  conflict: SyncConflictRow | null;
}

const RELATION_FIELDS = new Set(["tagIds", "targetNoteIds"]);

function canonicalValue(fieldPath: string, value: unknown): unknown {
  if (
    RELATION_FIELDS.has(fieldPath) &&
    Array.isArray(value) &&
    value.every((item): item is string => typeof item === "string")
  ) {
    return canonicalIdList(value);
  }
  return value;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return Object.is(left, right);
  }
}

export function compareFieldCandidates(
  local: FieldCandidate,
  remote: FieldCandidate
): number {
  if (local.updatedAt !== remote.updatedAt) {
    return local.updatedAt > remote.updatedAt ? 1 : -1;
  }
  if (local.originDeviceId !== remote.originDeviceId) {
    return local.originDeviceId > remote.originDeviceId ? 1 : -1;
  }
  if (local.opId !== remote.opId) {
    return local.opId > remote.opId ? 1 : -1;
  }
  return 0;
}

export function mergeFieldCandidate(
  entityType: SyncEntityType,
  fieldPath: string,
  local: FieldCandidate,
  remote: FieldCandidate
): MergeOutcome {
  const localValue = canonicalValue(fieldPath, local.value);
  const remoteValue = canonicalValue(fieldPath, remote.value);
  const winner = compareFieldCandidates(local, remote) >= 0 ? "local" : "remote";
  const value = winner === "local" ? localValue : remoteValue;
  const losingValue = winner === "local" ? remoteValue : localValue;

  if (valuesEqual(localValue, remoteValue)) {
    return {
      winner: "local",
      value: localValue,
      losingValue: remoteValue,
      conflict: null,
    };
  }

  if (fieldClass(entityType, fieldPath) === "merge-safe") {
    return { winner, value, losingValue, conflict: null };
  }

  return {
    winner,
    value,
    losingValue,
    conflict: {
      conflictId: generateId(),
      workspaceId: local.workspaceId,
      entityType,
      entityId: local.entityId,
      fieldPath,
      localFieldRevision: local.fieldRevision,
      remoteFieldRevision: remote.fieldRevision,
      localOpId: local.opId,
      remoteOpId: remote.opId,
      localValue,
      remoteValue,
      localDeviceId: local.originDeviceId,
      remoteDeviceId: remote.originDeviceId,
      createdAt: local.updatedAt >= remote.updatedAt ? local.updatedAt : remote.updatedAt,
      state: "open",
      resolution: winner,
      resolvedAt: null,
      resolvedByDeviceId: null,
    },
  };
}
