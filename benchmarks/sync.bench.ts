import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import type { SyncPolicy } from "@opennest/sync";
import { createDexieStorage } from "@opennest/storage-dexie";

const OPERATIONS = 500;
const AT = "2026-11-15T10:00:00.000Z" as never;
const AT2 = "2026-11-15T10:01:00.000Z" as never;

async function measure(label: string, policy?: SyncPolicy): Promise<void> {
  const storage = createDexieStorage({
    databaseName: `opennest-sync-bench-${label}-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`,
    ...(policy === undefined ? {} : { syncPolicy: policy }),
  });
  await storage.init();
  const workspace = await storage.workspaces.ensureWorkspace({ at: AT });

  try {
    const notes = [];
    const createStart = performance.now();

    for (let index = 0; index < OPERATIONS; index += 1) {
      notes.push(
        await storage.notes.create({
          workspaceId: workspace.id,
          folderId: null,
          title: `Catatan ${index}`,
          content: "",
          at: AT,
        })
      );
    }

    const createMs = performance.now() - createStart;
    const updateStart = performance.now();

    for (const note of notes) {
      await storage.notes.update(note.id, {
        title: `${note.title} diperbarui`,
        at: AT2,
      });
    }

    const updateMs = performance.now() - updateStart;

    expect(notes).toHaveLength(OPERATIONS);
    console.log(
      `${label}: create ${(createMs / OPERATIONS).toFixed(2)} ms/op, ` +
        `update ${(updateMs / OPERATIONS).toFixed(2)} ms/op`
    );
  } finally {
    await storage.close();
  }
}

describe("sync write cost benchmark", () => {
  it("measures create and update cost with and without the outbox", async () => {
    await measure("default");
    await measure("outbox", {
      outbox: {
        enabled: true,
        maxRows: 10_000,
        retentionMs: 30 * 24 * 60 * 60 * 1000,
      },
    });
  }, 300_000);
});
