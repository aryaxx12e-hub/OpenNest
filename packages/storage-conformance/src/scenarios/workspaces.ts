import { describe, expect, it } from "vitest";

import { ConstraintError, NotFoundError } from "@opennest/core";

import { withHarness } from "../harness";
import type { StorageFactory } from "../index";

const AT = "2026-11-12T00:00:00.000Z" as never;

export function registerWorkspaceScenarios(create: StorageFactory): void {
  describe("workspaces", () => {
    it("ensureWorkspace creates once and returns the same row afterwards", async () => {
      await withHarness(create, async ({ storage, workspace }) => {
        const again = await storage.workspaces.ensureWorkspace({
          name: "Lain",
          at: AT,
        });

        expect(again.id).toBe(workspace.id);
        expect(again.name).toBe(workspace.name);
        expect((await storage.workspaces.list()).length).toBe(1);
      });
    });

    it("concurrent ensureWorkspace calls across connections create exactly one workspace", async () => {
      const name = `workspace-race-${Date.now().toString(36)}`;
      const first = await create(name);
      const second = await create(name);

      try {
        await first.init();
        await second.init();

        const results = await Promise.all([
          first.workspaces.ensureWorkspace({ name: "Satu", at: AT }),
          first.workspaces.ensureWorkspace({ name: "Dua", at: AT }),
          second.workspaces.ensureWorkspace({ name: "Tiga", at: AT }),
          second.workspaces.ensureWorkspace({ name: "Empat", at: AT }),
        ]);

        expect(new Set(results.map((workspace) => workspace.id)).size).toBe(1);
        expect(await first.workspaces.list()).toHaveLength(1);
        expect(await second.workspaces.list()).toHaveLength(1);
      } finally {
        await first.close();
        await second.close();
      }
    });

    it("ensureWorkspace refuses to guess when two workspaces exist", async () => {
      await withHarness(create, async ({ storage }) => {
        await storage.workspaces.create({ name: "Satu", at: AT });
        await storage.workspaces.create({ name: "Dua", at: AT });

        await expect(
          storage.workspaces.ensureWorkspace({ at: AT })
        ).rejects.toBeInstanceOf(ConstraintError);
        await expect(
          storage.workspaces.ensureWorkspace({ at: AT })
        ).rejects.toMatchObject({
          code: "multiple_workspaces",
        });
      });
    });

    it("update and delete on an unknown id throw NotFoundError", async () => {
      await withHarness(create, async ({ storage }) => {
        await expect(
          storage.workspaces.update("missing" as never, { name: "x", at: AT })
        ).rejects.toBeInstanceOf(NotFoundError);
        await expect(
          storage.workspaces.delete("missing" as never)
        ).rejects.toBeInstanceOf(NotFoundError);
      });
    });

    it("deleting a workspace cascades to all of its rows and both join tables", async () => {
      await withHarness(create, async ({ storage, services, workspace }) => {
        const folder = await services.folder.create({
          workspaceId: workspace.id,
          parentId: null,
          name: "Berkas",
        });
        const tag = await services.tag.create({
          workspaceId: workspace.id,
          name: "Kerja",
        });
        const note = await services.note.create({
          workspaceId: workspace.id,
          folderId: folder.id,
          title: "Catatan",
        });
        const linked = await services.note.create({
          workspaceId: workspace.id,
          folderId: null,
          title: "Tautan",
        });
        await services.note.setTags(note.id, [tag.id]);
        await services.note.setLinks(note.id, [linked.id]);
        await services.file.upload({
          workspaceId: workspace.id,
          folderId: folder.id,
          name: "a.pdf",
          mimeType: "application/pdf",
          data: new Uint8Array([1]),
        });

        await services.workspace.delete(workspace.id);

        expect(await storage.workspaces.get(workspace.id)).toBeNull();
        expect(await storage.folders.get(folder.id)).toBeNull();
        expect(await storage.tags.get(tag.id)).toBeNull();
        expect(await storage.notes.get(note.id)).toBeNull();
        expect(await storage.notes.get(linked.id)).toBeNull();
        expect(await storage.notes.tags(note.id)).toEqual([]);
        expect(await storage.notes.links(note.id)).toEqual([]);
      });
    });
  });
}
