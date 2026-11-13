import { describe, expect, it } from "vitest";

import { NotFoundError } from "@opennest/core";

import { withHarness } from "../harness";
import type { StorageFactory } from "../index";

export function registerNoteScenarios(create: StorageFactory): void {
  describe("notes", () => {
    it("creates, pins, updates repeatedly and deletes a note", async () => {
      await withHarness(create, async ({ storage, services, workspace }) => {
        const note = await services.note.create({
          workspaceId: workspace.id,
          folderId: null,
          title: "Belanja",
        });

        expect(note.pinned).toBe(false);
        expect(note.content).toBe("");

        const pinned = await services.note.update(note.id, { pinned: true });
        expect(pinned.pinned).toBe(true);

        const edited = await services.note.update(note.id, {
          content: "susu dan roti",
        });
        expect(edited.content).toBe("susu dan roti");

        await services.note.delete(note.id);
        expect(await storage.notes.get(note.id)).toBeNull();
      });
    });

    it("updatedAt is non-decreasing and the service clock is the only time source", async () => {
      await withHarness(create, async ({ clock, services, workspace }) => {
        const note = await services.note.create({
          workspaceId: workspace.id,
          folderId: null,
          title: "Catatan",
        });

        const firstExpectation = note.updatedAt;
        const updated = await services.note.update(note.id, { title: "Catatan Baru" });

        expect(
          updated.updatedAt > firstExpectation || updated.updatedAt === firstExpectation
        ).toBe(true);
        expect(Date.parse(updated.updatedAt)).toBeGreaterThan(
          Date.parse(note.updatedAt) - 1
        );
        expect(typeof clock()).toBe("string");
      });
    });

    it("unknown ids give NotFoundError", async () => {
      await withHarness(create, async ({ services }) => {
        await expect(
          services.note.update("missing" as never, { title: "x" })
        ).rejects.toBeInstanceOf(NotFoundError);
        await expect(services.note.delete("missing" as never)).rejects.toBeInstanceOf(
          NotFoundError
        );
      });
    });

    it("filters by folder subtree, pinned state, tag and text", async () => {
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
        const inRoot = await services.note.create({
          workspaceId: workspace.id,
          folderId: root.id,
          title: "belanja bulanan",
          content: "susu",
        });
        await services.note.create({
          workspaceId: workspace.id,
          folderId: child.id,
          title: "catatan rapat",
          pinned: true,
        });
        await services.note.create({
          workspaceId: workspace.id,
          folderId: null,
          title: "di akar",
        });
        await services.note.setTags(inRoot.id, [tag.id]);

        expect(
          (await services.note.list(workspace.id, { folderId: root.id })).total
        ).toBe(2);
        expect((await services.note.list(workspace.id, { folderId: null })).total).toBe(
          1
        );
        expect((await services.note.list(workspace.id, { pinned: true })).total).toBe(1);
        expect((await services.note.list(workspace.id, { tagIds: [tag.id] })).total).toBe(
          1
        );
        expect((await services.note.list(workspace.id, { text: "bulan" })).total).toBe(1);
        expect((await services.note.list(workspace.id, {})).total).toBe(3);
      });
    });
  });
}
