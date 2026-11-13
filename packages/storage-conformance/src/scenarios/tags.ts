import { describe, expect, it } from "vitest";

import { ConflictError, NotFoundError } from "@opennest/core";

import { withHarness } from "../harness";
import type { StorageFactory } from "../index";

export function registerTagScenarios(create: StorageFactory): void {
  describe("tags", () => {
    it("creates a tag and reads it back", async () => {
      await withHarness(create, async ({ storage, services, workspace }) => {
        const tag = await services.tag.create({
          workspaceId: workspace.id,
          name: "Kerja",
          color: "#112233",
        });

        expect(tag.name).toBe("Kerja");
        expect(tag.color).toBe("#112233");
        expect(await storage.tags.get(tag.id)).not.toBeNull();
      });
    });

    it("rejects an exact duplicate with duplicate_tag_name", async () => {
      await withHarness(create, async ({ services, workspace }) => {
        await services.tag.create({ workspaceId: workspace.id, name: "Kerja" });

        await expect(
          services.tag.create({ workspaceId: workspace.id, name: "Kerja" })
        ).rejects.toBeInstanceOf(ConflictError);
        await expect(
          services.tag.create({ workspaceId: workspace.id, name: "Kerja" })
        ).rejects.toMatchObject({ code: "duplicate_tag_name" });
      });
    });

    it("rejects a case-insensitive duplicate through the service path", async () => {
      await withHarness(create, async ({ services, workspace }) => {
        await services.tag.create({ workspaceId: workspace.id, name: "Kerja" });

        await expect(
          services.tag.create({ workspaceId: workspace.id, name: "  kerja  " })
        ).rejects.toMatchObject({ code: "duplicate_tag_name" });
      });
    });

    it("rejects a rename onto an existing name", async () => {
      await withHarness(create, async ({ services, workspace }) => {
        await services.tag.create({ workspaceId: workspace.id, name: "Kerja" });
        const second = await services.tag.create({
          workspaceId: workspace.id,
          name: "Pribadi",
        });

        await expect(
          services.tag.update(second.id, { name: "Kerja" })
        ).rejects.toMatchObject({
          code: "duplicate_tag_name",
        });
      });
    });

    it("allows the same tag name in a different workspace", async () => {
      await withHarness(create, async ({ services, workspace }) => {
        const other = await services.workspace.create("Lain");
        await services.tag.create({ workspaceId: workspace.id, name: "Kerja" });

        const foreign = await services.tag.create({
          workspaceId: other.id,
          name: "Kerja",
        });
        expect(foreign.workspaceId).toBe(other.id);
      });
    });

    it("deleting a tag cascades to both join tables", async () => {
      await withHarness(create, async ({ services, workspace }) => {
        const tag = await services.tag.create({
          workspaceId: workspace.id,
          name: "Kerja",
        });
        const note = await services.note.create({
          workspaceId: workspace.id,
          folderId: null,
          title: "Catatan",
        });
        const file = await services.file.upload({
          workspaceId: workspace.id,
          folderId: null,
          name: "a.pdf",
          mimeType: "application/pdf",
          data: new Uint8Array([1]),
        });
        await services.note.setTags(note.id, [tag.id]);
        await services.file.setTags(file.id, [tag.id]);

        await services.tag.delete(tag.id);

        expect(await services.note.tags(note.id)).toEqual([]);
        expect(await services.file.tags(file.id)).toEqual([]);
      });
    });

    it("unknown ids give NotFoundError", async () => {
      await withHarness(create, async ({ services }) => {
        await expect(
          services.tag.update("missing" as never, { name: "x" })
        ).rejects.toBeInstanceOf(NotFoundError);
        await expect(services.tag.delete("missing" as never)).rejects.toBeInstanceOf(
          NotFoundError
        );
      });
    });

    it("findByName matches on the normalized key", async () => {
      await withHarness(create, async ({ services, workspace }) => {
        await services.tag.create({ workspaceId: workspace.id, name: "Kerja" });

        expect(await services.tag.findByName(workspace.id, "  KERJA ")).not.toBeNull();
        expect(await services.tag.findByName(workspace.id, "liburan")).toBeNull();
      });
    });
  });
}
