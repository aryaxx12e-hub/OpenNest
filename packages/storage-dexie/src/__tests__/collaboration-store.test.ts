import "fake-indexeddb/auto";

import type { IsoDate } from "@opennest/core";
import { afterEach, describe, expect, it } from "vitest";

import { createDexieStorage } from "../index";

const AT = "2026-11-19T12:00:00.000Z" as IsoDate;
const AT_LATER = "2026-11-19T12:00:02.000Z" as IsoDate;
const open: Array<Awaited<ReturnType<typeof createDexieStorage>>> = [];

function databaseName(): string {
  return `opennest-collaboration-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function makeStorage(): Promise<Awaited<ReturnType<typeof createDexieStorage>>> {
  const storage = createDexieStorage({ databaseName: databaseName() });
  await storage.init();
  open.push(storage);

  return storage;
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((storage) => storage.close()));
});

describe("Dexie collaboration store", () => {
  it("writes note content and sync metadata without an outbox row", async () => {
    const storage = await makeStorage();
    const workspace = await storage.workspaces.ensureWorkspace({ at: AT });
    const note = await storage.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Live note",
      content: "Before",
      at: AT,
    });

    await storage.collaboration.writeSnapshot(
      note.id,
      { content: "After", updatedAt: AT_LATER },
      { workspaceId: workspace.id, at: AT_LATER }
    );

    await expect(storage.notes.get(note.id)).resolves.toMatchObject({
      content: "After",
      updatedAt: AT_LATER,
    });
    expect(await storage.sync.listOutbox(workspace.id)).toEqual([]);
    expect(
      await storage.sync.getFieldMeta(workspace.id, "note", note.id, "content")
    ).toMatchObject({
      fieldRevision: 2,
      updatedAt: AT_LATER,
    });
  });
});
