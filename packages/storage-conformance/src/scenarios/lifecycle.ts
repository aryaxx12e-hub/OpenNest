import { describe, expect, it } from "vitest";

import { createWorkspaceService, StorageError } from "@opennest/core";

import { withHarness } from "../harness";
import type { StorageFactory } from "../index";

export function registerLifecycleScenarios(create: StorageFactory): void {
  describe("lifecycle", () => {
    it("exposes the adapter kind and a positive schema version", async () => {
      await withHarness(create, async ({ storage }) => {
        expect(["dexie", "sqlite"]).toContain(storage.kind);
        expect(Number.isInteger(storage.schemaVersion)).toBe(true);
        expect(storage.schemaVersion).toBeGreaterThan(0);
      });
    });

    it("init() twice is idempotent", async () => {
      await withHarness(create, async ({ storage, workspace }) => {
        await expect(storage.init()).resolves.toBeUndefined();
        expect(await storage.workspaces.get(workspace.id)).not.toBeNull();
      });
    });

    it("using the adapter after close throws storage_error with code closed", async () => {
      const storage = await create();
      await storage.init();
      await storage.close();

      await expect(storage.workspaces.list()).rejects.toMatchObject({
        code: "closed",
      });
      await expect(storage.workspaces.list()).rejects.toBeInstanceOf(StorageError);
    });

    it("close() twice is safe", async () => {
      const storage = await create();
      await storage.init();
      await storage.close();
      await expect(storage.close()).resolves.toBeUndefined();
    });

    it("reset() empties every row and every blob, then usage() reports zero", async () => {
      await withHarness(create, async ({ storage, services, workspace }) => {
        const folder = await services.folder.create({
          workspaceId: workspace.id,
          parentId: null,
          name: "Berkas",
        });
        const note = await services.note.create({
          workspaceId: workspace.id,
          folderId: folder.id,
          title: "Catatan",
        });
        await services.tag.create({ workspaceId: workspace.id, name: "Kerja" });
        await services.file.upload({
          workspaceId: workspace.id,
          folderId: null,
          name: "a.pdf",
          mimeType: "application/pdf",
          data: new Uint8Array([1, 2, 3]),
        });
        expect((await storage.blobs.usage()).items).toBe(1);

        await storage.reset();

        expect((await storage.workspaces.list()).length).toBe(0);
        expect(await storage.notes.get(note.id)).toBeNull();
        expect(await storage.folders.get(folder.id)).toBeNull();
        expect(await storage.blobs.usage()).toEqual({ bytes: 0, items: 0 });
        expect(
          (await storage.search.search({ workspaceId: workspace.id, text: "catatan" }))
            .length
        ).toBe(0);
      });
    });

    it("a second adapter instance on the same database sees the first one's data", async () => {
      const databaseName = "opennest-conformance-shared";
      const first = await create(databaseName);
      await first.init();
      const workspaceService = createWorkspaceService({
        workspaces: first.workspaces,
        clock: () => "2026-11-12T00:00:00.000Z" as never,
      });
      const workspace = await workspaceService.ensure("Rumah");
      await first.close();

      const second = await create(databaseName);
      await second.init();
      const reloaded = await second.workspaces.get(workspace.id);
      await second.close();

      expect(reloaded?.name).toBe("Rumah");
    });
  });
}
