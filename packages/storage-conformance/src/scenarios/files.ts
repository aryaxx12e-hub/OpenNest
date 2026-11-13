import { describe, expect, it } from "vitest";

import { NotFoundError } from "@opennest/core";

import { withHarness } from "../harness";
import type { StorageFactory } from "../index";

const PDF = "application/pdf";

export function registerFileScenarios(create: StorageFactory): void {
  describe("files", () => {
    it("creates, renames, moves and deletes a file", async () => {
      await withHarness(create, async ({ storage, services, workspace }) => {
        const folder = await services.folder.create({
          workspaceId: workspace.id,
          parentId: null,
          name: "Berkas",
        });
        const file = await services.file.upload({
          workspaceId: workspace.id,
          folderId: null,
          name: "a.pdf",
          mimeType: PDF,
          data: new Uint8Array([1, 2, 3]),
        });

        expect(file.sizeBytes).toBe(3);
        expect(await storage.blobs.has(file.blobKey)).toBe(true);

        const renamed = await services.file.update(file.id, { name: "b.pdf" });
        expect(renamed.name).toBe("b.pdf");

        const moved = await services.file.update(file.id, { folderId: folder.id });
        expect(moved.folderId).toBe(folder.id);

        await services.file.delete(file.id);
        expect(await storage.files.get(file.id)).toBeNull();
      });
    });

    it("preserves metadata and round-trips a null MIME type and null checksum", async () => {
      await withHarness(create, async ({ storage, services, workspace }) => {
        const file = await services.file.create({
          workspaceId: workspace.id,
          folderId: null,
          name: "tanpa-tipe",
          mimeType: null,
          sizeBytes: 0,
          blobKey: "44444444-4444-4444-8444-444444444444",
          checksum: null,
        });

        expect(file.mimeType).toBeNull();
        expect(file.checksum).toBeNull();
        expect(file.sizeBytes).toBe(0);

        const roundTrip = await storage.files.list(workspace.id, {});
        expect(roundTrip.items).toHaveLength(1);
        expect(roundTrip.items[0]?.mimeType).toBeNull();
        expect(roundTrip.items[0]?.checksum).toBeNull();
      });
    });

    it("unknown ids give NotFoundError", async () => {
      await withHarness(create, async ({ services }) => {
        await expect(
          services.file.update("missing" as never, { name: "x" })
        ).rejects.toBeInstanceOf(NotFoundError);
        await expect(services.file.delete("missing" as never)).rejects.toBeInstanceOf(
          NotFoundError
        );
      });
    });

    it("filters by folder subtree, by mime type, by tag and by text", async () => {
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
        const tag = await services.tag.create({
          workspaceId: workspace.id,
          name: "Kerja",
        });
        const inRoot = await services.file.upload({
          workspaceId: workspace.id,
          folderId: root.id,
          name: "laporan.pdf",
          mimeType: PDF,
          data: new Uint8Array([1]),
        });
        await services.file.upload({
          workspaceId: workspace.id,
          folderId: child.id,
          name: "catatan.txt",
          mimeType: "text/plain",
          data: new Uint8Array([2]),
        });
        await services.file.setTags(inRoot.id, [tag.id]);

        expect(
          (await services.file.list(workspace.id, { folderId: root.id })).total
        ).toBe(2);
        expect(
          (await services.file.list(workspace.id, { folderId: child.id })).total
        ).toBe(1);
        expect(
          (await services.file.list(workspace.id, { mimeTypes: [PDF] })).items.map(
            (row) => row.name
          )
        ).toEqual(["laporan.pdf"]);
        expect((await services.file.list(workspace.id, { tagIds: [tag.id] })).total).toBe(
          1
        );
        expect((await services.file.list(workspace.id, { text: "lapor" })).total).toBe(1);
        expect((await services.file.list(workspace.id, { text: "oat" })).total).toBe(0);
      });
    });
  });
}
