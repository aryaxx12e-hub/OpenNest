import { describe, expect, it } from "vitest";

import {
  compareFieldCandidates,
  mergeFieldCandidate,
  type FieldCandidate,
} from "../merge";

const BASE = {
  workspaceId: "ws-1",
  entityType: "note" as const,
  entityId: "note-1",
  fieldRevision: 1,
  originDeviceId: "device-a",
  opId: "op-a",
  updatedAt: "2026-11-15T10:00:00.000Z",
};

function candidate(overrides: Partial<FieldCandidate> = {}): FieldCandidate {
  return {
    ...BASE,
    fieldPath: "content",
    value: "local",
    ...overrides,
  };
}

describe("sync merge", () => {
  it("keeps a merge-safe field conflict-free alongside content conflicts", () => {
    const title = mergeFieldCandidate(
      "note",
      "title",
      candidate({ fieldPath: "title", value: "Local title" }),
      candidate({
        fieldPath: "title",
        value: "Remote title",
        originDeviceId: "device-b",
        updatedAt: "2026-11-15T10:01:00.000Z",
      })
    );
    const pinned = mergeFieldCandidate(
      "note",
      "pinned",
      candidate({ fieldPath: "pinned", value: false }),
      candidate({
        fieldPath: "pinned",
        value: true,
        originDeviceId: "device-b",
        updatedAt: "2026-11-15T10:01:00.000Z",
      })
    );

    expect(title.conflict).not.toBeNull();
    expect(pinned.conflict).toBeNull();
    expect(pinned.winner).toBe("remote");
  });

  it("picks a merge-safe winner by updatedAt then originDeviceId then opId", () => {
    const later = mergeFieldCandidate(
      "note",
      "pinned",
      candidate({ fieldPath: "pinned", value: false }),
      candidate({
        fieldPath: "pinned",
        value: true,
        originDeviceId: "device-b",
        updatedAt: "2026-11-15T10:01:00.000Z",
      })
    );
    expect(later).toMatchObject({ winner: "remote", conflict: null });

    const deviceTie = mergeFieldCandidate(
      "tag",
      "color",
      candidate({
        entityType: "tag",
        fieldPath: "color",
        value: "#111111",
        originDeviceId: "device-b",
      }),
      candidate({
        entityType: "tag",
        fieldPath: "color",
        value: "#222222",
        originDeviceId: "device-a",
      })
    );
    expect(deviceTie).toMatchObject({ winner: "local", conflict: null });

    const opTie = mergeFieldCandidate(
      "tag",
      "color",
      candidate({
        entityType: "tag",
        fieldPath: "color",
        value: "#111111",
        opId: "op-b",
      }),
      candidate({
        entityType: "tag",
        fieldPath: "color",
        value: "#222222",
        opId: "op-a",
      })
    );
    expect(opTie).toMatchObject({ winner: "local", conflict: null });
  });

  it("creates a conflict for a content-bearing field and preserves the loser", () => {
    const outcome = mergeFieldCandidate(
      "note",
      "content",
      candidate({ value: "local body" }),
      candidate({
        value: "remote body",
        originDeviceId: "device-b",
        updatedAt: "2026-11-15T10:01:00.000Z",
      })
    );

    expect(outcome.winner).toBe("remote");
    expect(outcome.conflict).toMatchObject({
      workspaceId: "ws-1",
      entityId: "note-1",
      fieldPath: "content",
      localValue: "local body",
      remoteValue: "remote body",
      localDeviceId: "device-a",
      remoteDeviceId: "device-b",
      state: "open",
      resolution: "remote",
      resolvedAt: null,
      resolvedByDeviceId: null,
    });
    expect(outcome.losingValue).toBe("local body");
  });

  it("preserves both content values under clock skew", () => {
    const outcome = mergeFieldCandidate(
      "note",
      "content",
      candidate({
        value: "local body",
        updatedAt: "2026-11-15T12:00:00.000Z",
      }),
      candidate({
        value: "remote body",
        originDeviceId: "device-b",
        updatedAt: "2026-11-15T09:00:00.000Z",
      })
    );

    expect(outcome.winner).toBe("local");
    expect(outcome.conflict).toMatchObject({
      localValue: "local body",
      remoteValue: "remote body",
    });
  });

  it("does not treat an unknown field as merge-safe", () => {
    const outcome = mergeFieldCandidate(
      "note",
      "futureField",
      candidate({ fieldPath: "futureField", value: "local" }),
      candidate({
        fieldPath: "futureField",
        value: "remote",
        originDeviceId: "device-b",
        updatedAt: "2026-11-15T10:01:00.000Z",
      })
    );

    expect(outcome.conflict).not.toBeNull();
  });

  it("canonicalizes relation arrays before comparing", () => {
    const outcome = mergeFieldCandidate(
      "tag",
      "tagIds",
      candidate({
        entityType: "tag",
        fieldPath: "tagIds",
        value: ["b", "a"],
      }),
      candidate({
        entityType: "tag",
        fieldPath: "tagIds",
        value: ["a", "b"],
        originDeviceId: "device-b",
        updatedAt: "2026-11-15T10:01:00.000Z",
      })
    );

    expect(outcome.conflict).toBeNull();
    expect(outcome.value).toEqual(["a", "b"]);
  });

  it("compares candidates deterministically", () => {
    const local = candidate({ updatedAt: "2026-11-15T10:00:00.000Z" });
    const remote = candidate({
      updatedAt: "2026-11-15T10:01:00.000Z",
      originDeviceId: "device-b",
    });

    expect(compareFieldCandidates(remote, local)).toBeGreaterThan(0);
    expect(compareFieldCandidates(local, remote)).toBeLessThan(0);
    expect(compareFieldCandidates(local, { ...local })).toBe(0);
  });
});
