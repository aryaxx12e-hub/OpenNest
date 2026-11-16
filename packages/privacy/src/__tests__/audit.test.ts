import { describe, expect, it } from "vitest";

import { createAuditLog } from "../audit";
import { createMemoryAuditStore, createSequenceIds } from "../testing";

const NOW = Date.parse("2026-11-15T08:00:00.000Z");

function createLog(store = createMemoryAuditStore()) {
  return {
    log: createAuditLog({
      store,
      now: () => NOW,
      generateId: createSequenceIds("audit"),
    }),
    store,
  };
}

describe("audit log", () => {
  it("chains entries and detects tampering", async () => {
    const { log, store } = createLog();

    await log.append({
      event: "grant.created",
      outcome: "allowed",
      principalId: "builtin:local",
    });
    await log.append({
      event: "data.exported",
      outcome: "completed",
      itemCount: 3,
    });

    expect(await log.verify()).toEqual({ valid: true, entries: 2, brokenAt: null });

    const rows = await store.list();
    const first = rows[0];

    if (first === undefined) {
      throw new Error("Expected the first audit entry");
    }

    await store.clear();
    await store.append({ ...first, reason: "tampered" });

    expect(await log.verify()).toEqual({ valid: false, entries: 1, brokenAt: 0 });
  });

  it("serializes concurrent appends and keeps sequence order", async () => {
    const { log } = createLog();

    await Promise.all([
      log.append({ event: "data.exported", outcome: "completed" }),
      log.append({ event: "data.restored", outcome: "completed" }),
      log.append({ event: "data.deleted", outcome: "completed" }),
    ]);

    const rows = await log.list();

    expect(rows.map((entry) => entry.sequence)).toEqual([0, 1, 2]);
    expect(await log.verify()).toEqual({ valid: true, entries: 3, brokenAt: null });
  });

  it("does not store content-like fields", async () => {
    const { log } = createLog();
    const entry = await log.append({
      event: "data.exported",
      outcome: "completed",
      principalId: "builtin:local",
      itemCount: 3,
    });

    expect(Object.keys(entry)).not.toContain("content");
    expect(Object.keys(entry)).not.toContain("title");
    expect(Object.keys(entry)).not.toContain("filename");
  });
});
