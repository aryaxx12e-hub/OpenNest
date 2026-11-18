import { describe, expect, it } from "vitest";

import { dataInventory, flowMatrix, inventoryByClass } from "../inventory";

describe("data inventory", () => {
  it("covers each data class and the local derived artifacts", () => {
    const ids = dataInventory.map((entry) => entry.id);

    expect(ids).toEqual(
      expect.arrayContaining([
        "workspace",
        "folders",
        "tags",
        "files",
        "blobs",
        "notes",
        "drafts",
        "grants",
        "audit",
        "search",
        "backups",
      ])
    );
    expect(Object.keys(inventoryByClass())).toEqual(["D0", "D1", "D2", "D3", "D4", "D5"]);
  });

  it("marks drafts, grants, audit, and search results as excluded from backup v1", () => {
    const ids = dataInventory
      .filter((entry) => !entry.includedInBackup)
      .map((entry) => entry.id);

    expect(ids).toEqual(expect.arrayContaining(["drafts", "grants", "audit", "search"]));
  });

  it("lists every sync sidecar exactly once and excludes it from backup", () => {
    const ids = [
      "sync-meta",
      "sync-field-meta",
      "sync-outbox",
      "sync-devices",
      "sync-state",
      "sync-tombstones",
      "sync-conflicts",
    ];
    const sidecars = dataInventory.filter((entry) => ids.includes(entry.id));

    expect(sidecars.map((entry) => entry.id)).toEqual(ids);
    expect(sidecars.map((entry) => entry.id)).toEqual([
      ...new Set(sidecars.map((entry) => entry.id)),
    ]);

    for (const entry of sidecars) {
      expect(entry.storage).toBe("indexeddb");
      expect(entry.includedInBackup).toBe(false);
      expect(entry.deletedWithSource).toBe(false);
      expect(entry.retention).toBe("until-delete");
    }

    expect(sidecars.find((entry) => entry.id === "sync-outbox")?.dataClass).toBe("D2");
    expect(sidecars.find((entry) => entry.id === "sync-conflicts")?.dataClass).toBe("D2");
  });

  it("marks the AI provider flow available with explicit consent and a revocation limit", () => {
    const ai = flowMatrix.find((flow) => flow.id === "ai-provider");

    expect(ai?.available).toBe(true);
    expect(ai?.consent).toBe("explicit");
    expect(ai?.revocationLimitKey).toBe("privacy.flows.revocationLimit");
  });
});
