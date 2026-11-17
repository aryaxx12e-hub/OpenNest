import { describe, expect, it } from "vitest";

import {
  NotFoundError,
  createNoteService,
  type NoteId,
  type NoteRepository,
} from "@opennest/core";

import { withHarness } from "../harness";
import type { StorageFactory } from "../index";

function withReadBarrier(notes: NoteRepository): NoteRepository {
  let arrived = 0;
  let release = (): void => undefined;
  const bothArrived = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    ...notes,
    async get(id) {
      const note = await notes.get(id);
      arrived += 1;

      if (arrived === 2) {
        release();
      }

      await bothArrived;

      return note;
    },
  };
}

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

    it("uses a caller-provided note id and rejects a duplicate id", async () => {
      await withHarness(create, async ({ clock, storage, workspace }) => {
        const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as NoteId;
        const note = await storage.notes.create({
          id,
          workspaceId: workspace.id,
          folderId: null,
          title: "Catatan tetap",
          at: clock(),
        });

        expect(note.id).toBe(id);
        expect(await storage.notes.get(id)).toMatchObject({ id, title: "Catatan tetap" });

        await expect(
          storage.notes.create({
            id,
            workspaceId: workspace.id,
            folderId: null,
            title: "Duplikat",
            at: clock(),
          })
        ).rejects.toMatchObject({ code: "duplicate_id" });
      });
    });

    it("merges concurrent title and content updates after both reads see the same row", async () => {
      await withHarness(create, async ({ clock, storage, workspace }) => {
        const noteService = createNoteService({
          notes: withReadBarrier(storage.notes),
          folders: storage.folders,
          tags: storage.tags,
          workspaces: storage.workspaces,
          clock,
        });
        const note = await noteService.create({
          workspaceId: workspace.id,
          folderId: null,
          title: "Awal",
          content: "Isi awal",
        });

        await Promise.all([
          noteService.update(note.id, { title: "Judul baru" }),
          noteService.update(note.id, { content: "Isi baru" }),
        ]);

        expect(await storage.notes.get(note.id)).toMatchObject({
          title: "Judul baru",
          content: "Isi baru",
        });
      });
    });

    it("merges a concurrent pin with a title update after both reads see the same row", async () => {
      await withHarness(create, async ({ clock, storage, workspace }) => {
        const noteService = createNoteService({
          notes: withReadBarrier(storage.notes),
          folders: storage.folders,
          tags: storage.tags,
          workspaces: storage.workspaces,
          clock,
        });
        const note = await noteService.create({
          workspaceId: workspace.id,
          folderId: null,
          title: "Awal",
        });

        await Promise.all([
          noteService.update(note.id, { pinned: true }),
          noteService.update(note.id, { title: "Disematkan" }),
        ]);

        expect(await storage.notes.get(note.id)).toMatchObject({
          title: "Disematkan",
          pinned: true,
        });
      });
    });

    it("merges a concurrent folder move with a content update in one transaction", async () => {
      await withHarness(create, async ({ clock, services, storage, workspace }) => {
        const folder = await services.folder.create({
          workspaceId: workspace.id,
          parentId: null,
          name: "Tujuan",
        });
        const note = await services.note.create({
          workspaceId: workspace.id,
          folderId: null,
          title: "Awal",
        });

        await storage.transaction(async () => {
          await Promise.all([
            storage.notes.update(note.id, { folderId: folder.id, at: clock() }),
            storage.notes.update(note.id, { content: "Isi baru", at: clock() }),
          ]);
        });

        expect(await storage.notes.get(note.id)).toMatchObject({
          folderId: folder.id,
          content: "Isi baru",
        });
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
