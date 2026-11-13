import { describe, expect, it } from "vitest";

import { ConstraintError, NotFoundError } from "@opennest/core";

import { withHarness } from "../harness";
import type { StorageFactory } from "../index";

export function registerFolderScenarios(create: StorageFactory): void {
  describe("folders", () => {
    it("creates, renames, moves and reparents a folder", async () => {
      await withHarness(create, async ({ storage, services, workspace }) => {
        const root = await services.folder.create({
          workspaceId: workspace.id,
          parentId: null,
          name: "Akar",
        });
        const child = await services.folder.create({
          workspaceId: workspace.id,
          parentId: root.id,
          name: "Anak",
        });

        const renamed = await services.folder.rename(child.id, "Anak Baru");
        expect(renamed.name).toBe("Anak Baru");

        const moved = await services.folder.move(child.id, null);
        expect(moved.parentId).toBeNull();

        const reparented = await services.folder.move(child.id, root.id);
        expect(reparented.parentId).toBe(root.id);
        expect((await storage.folders.get(child.id))?.parentId).toBe(root.id);
      });
    });

    it("unknown ids give NotFoundError", async () => {
      await withHarness(create, async ({ services }) => {
        await expect(
          services.folder.rename("missing" as never, "x")
        ).rejects.toBeInstanceOf(NotFoundError);
        await expect(
          services.folder.move("missing" as never, null)
        ).rejects.toBeInstanceOf(NotFoundError);
        await expect(services.folder.delete("missing" as never)).rejects.toBeInstanceOf(
          NotFoundError
        );
      });
    });

    it("deleting a folder moves child folders, files and notes to the root", async () => {
      await withHarness(create, async ({ storage, services, workspace }) => {
        const root = await services.folder.create({
          workspaceId: workspace.id,
          parentId: null,
          name: "Akar",
        });
        const child = await services.folder.create({
          workspaceId: workspace.id,
          parentId: root.id,
          name: "Anak",
        });
        const note = await services.note.create({
          workspaceId: workspace.id,
          folderId: root.id,
          title: "Catatan",
        });
        const file = await services.file.upload({
          workspaceId: workspace.id,
          folderId: root.id,
          name: "a.pdf",
          mimeType: "application/pdf",
          data: new Uint8Array([1]),
        });

        await services.folder.delete(root.id);

        expect((await storage.folders.get(child.id))?.parentId).toBeNull();
        expect((await storage.notes.get(note.id))?.folderId).toBeNull();
        expect((await storage.files.get(file.id))?.folderId).toBeNull();
      });
    });

    it("rejects a self parent and a cycle with folder_cycle", async () => {
      await withHarness(create, async ({ services, workspace }) => {
        const root = await services.folder.create({
          workspaceId: workspace.id,
          parentId: null,
          name: "Akar",
        });
        const child = await services.folder.create({
          workspaceId: workspace.id,
          parentId: root.id,
          name: "Anak",
        });
        const grandchild = await services.folder.create({
          workspaceId: workspace.id,
          parentId: child.id,
          name: "Cucu",
        });

        await expect(services.folder.move(root.id, root.id)).rejects.toBeInstanceOf(
          ConstraintError
        );
        await expect(services.folder.move(root.id, grandchild.id)).rejects.toMatchObject({
          code: "folder_cycle",
        });
      });
    });

    it("rejects moving into another workspace's folder with cross_workspace", async () => {
      await withHarness(create, async ({ services, workspace }) => {
        const other = await services.workspace.create("Lain");
        const otherFolder = await services.folder.create({
          workspaceId: other.id,
          parentId: null,
          name: "Asing",
        });
        const mine = await services.folder.create({
          workspaceId: workspace.id,
          parentId: null,
          name: "Punyaku",
        });

        await expect(services.folder.move(mine.id, otherFolder.id)).rejects.toMatchObject(
          {
            code: "cross_workspace",
          }
        );
      });
    });

    it("ancestors come root first and descendants exclude the folder itself", async () => {
      await withHarness(create, async ({ services, workspace }) => {
        const root = await services.folder.create({
          workspaceId: workspace.id,
          parentId: null,
          name: "Akar",
        });
        const mid = await services.folder.create({
          workspaceId: workspace.id,
          parentId: root.id,
          name: "Tengah",
        });
        const leaf = await services.folder.create({
          workspaceId: workspace.id,
          parentId: mid.id,
          name: "Daun",
        });

        expect((await services.folder.ancestors(leaf.id)).map((row) => row.name)).toEqual(
          ["Akar", "Tengah"]
        );
        expect(
          (await services.folder.descendants(root.id)).map((row) => row.name).sort()
        ).toEqual(["Daun", "Tengah"]);
        expect(
          (await services.folder.children(workspace.id, null)).map((row) => row.name)
        ).toEqual(["Akar"]);
        expect(
          (await services.folder.children(workspace.id, root.id)).map((row) => row.name)
        ).toEqual(["Tengah"]);
      });
    });
  });
}
