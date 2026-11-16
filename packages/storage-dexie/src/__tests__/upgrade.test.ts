import "fake-indexeddb/auto";

import Dexie from "dexie";
import { describe, expect, it } from "vitest";

import { createDexieStorage } from "../index";
import { OpenNestDexie } from "../schema";

const AT = "2026-11-12T00:00:00.000Z";

function databaseName(label: string): string {
  return `opennest-upgrade-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const V1_SCHEMA = {
  workspaces: "id",
  folders: "id",
  files: "id",
  notes: "id",
  tags: "id",
  fileTags: "[fileId+tagId]",
  noteTags: "[noteId+tagId]",
  noteLinks: "[sourceNoteId+targetNoteId]",
  blobs: "key",
};

async function seedVersionOne(name: string): Promise<void> {
  const legacy = new Dexie(name);
  legacy.version(1).stores(V1_SCHEMA);
  await legacy.open();

  await legacy.table("workspaces").put({
    id: "workspace-1",
    name: "Rumah",
    createdAt: AT,
    updatedAt: AT,
  });
  await legacy.table("folders").put({
    id: "folder-1",
    workspaceId: "workspace-1",
    parentId: null,
    name: "Akar",
    createdAt: AT,
    updatedAt: AT,
  });
  await legacy.table("blobs").put({
    key: "blob-1",
    type: "application/pdf",
    size: 2,
    data: new Uint8Array([1, 2]),
  });

  legacy.close();
}

describe("schema upgrade", () => {
  it("keeps rows written under version 1 when the adapter opens version 4", async () => {
    const name = databaseName("preserve");
    await seedVersionOne(name);

    const storage = createDexieStorage({ databaseName: name });
    await storage.init();

    expect(storage.schemaVersion).toBe(3);
    expect((await storage.workspaces.list()).map((row) => row.name)).toEqual(["Rumah"]);
    expect((await storage.folders.get("folder-1" as never))?.name).toBe("Akar");
    expect(await storage.blobs.has("blob-1" as never)).toBe(true);

    await storage.close();
  });

  it("upgrades the store in place and adds the v2 indexes", async () => {
    const name = databaseName("indexes");
    await seedVersionOne(name);

    const storage = createDexieStorage({ databaseName: name });
    await storage.init();
    await storage.close();

    const reopened = new OpenNestDexie(name);
    await reopened.open();

    const folder = reopened.table("folders");
    const indexes = folder.schema.indexes.map((index) => index.name);

    expect(folder.schema.primKey.keyPath).toBe("id");
    expect(indexes).toContain("workspaceId");
    expect(indexes).toContain("[workspaceId+parentId]");
    expect(reopened.verno).toBe(4);

    reopened.close();
  });
});
