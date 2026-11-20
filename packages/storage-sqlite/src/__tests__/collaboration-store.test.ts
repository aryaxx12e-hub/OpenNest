// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { IsoDate } from "@opennest/core";
import { afterEach, describe, expect, it } from "vitest";

import { createSqliteStorage } from "../index";

const AT = "2026-11-19T12:00:00.000Z" as IsoDate;
const AT_LATER = "2026-11-19T12:00:02.000Z" as IsoDate;
const open: Array<ReturnType<typeof createSqliteStorage>> = [];
const roots: string[] = [];

async function makeStorage(): Promise<ReturnType<typeof createSqliteStorage>> {
  const root = await mkdtemp(path.join(tmpdir(), "opennest-collaboration-store-"));
  roots.push(root);
  const storage = createSqliteStorage({
    databaseFile: path.join(root, "database.sqlite"),
    blobRoot: path.join(root, "blobs"),
  });
  await storage.init();
  open.push(storage);

  return storage;
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((storage) => storage.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("SQLite collaboration store", () => {
  it("loads a note snapshot", async () => {
    const storage = await makeStorage();
    const workspace = await storage.workspaces.ensureWorkspace({ at: AT });
    const note = await storage.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Live note",
      content: "Before",
      at: AT,
    });

    await expect(storage.collaboration.loadSnapshot(note.id)).resolves.toEqual({
      noteId: note.id,
      workspaceId: workspace.id,
      content: "Before",
      updatedAt: AT,
    });
  });

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
    expect(await storage.sync.getEntityMeta(workspace.id, "note", note.id)).toMatchObject(
      {
        entityRevision: 2,
        updatedAt: AT_LATER,
        deletedAt: null,
      }
    );
    expect(
      await storage.sync.getFieldMeta(workspace.id, "note", note.id, "content")
    ).toMatchObject({
      fieldRevision: 2,
      updatedAt: AT_LATER,
    });
  });

  it("does not overwrite a note in another workspace", async () => {
    const storage = await makeStorage();
    const workspace = await storage.workspaces.ensureWorkspace({ at: AT });
    const note = await storage.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Live note",
      content: "Before",
      at: AT,
    });

    await expect(
      storage.collaboration.writeSnapshot(
        note.id,
        { content: "After", updatedAt: AT_LATER },
        {
          workspaceId: "another-workspace" as typeof workspace.id,
          at: AT_LATER,
        }
      )
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
