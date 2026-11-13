import { describe, expect, it } from "vitest";

import { withHarness } from "../harness";
import type { StorageFactory } from "../index";

const HOSTILE = [
  "*",
  "()",
  "-",
  "NEAR",
  "OR",
  "AND",
  "NOT",
  '"',
  "a:b",
  "a(b)",
  "belanja - bulanan",
];

export function registerSearchScenarios(create: StorageFactory): void {
  describe("search", () => {
    it("matches a title, a body, and a token prefix, but not a substring", async () => {
      await withHarness(create, async ({ services, workspace }) => {
        await services.note.create({
          workspaceId: workspace.id,
          folderId: null,
          title: "Belanja bulanan",
          content: "susu dan roti",
        });
        await services.file.upload({
          workspaceId: workspace.id,
          folderId: null,
          name: "laporan tahunan.pdf",
          mimeType: "application/pdf",
          data: new Uint8Array([1]),
        });

        expect(
          (await services.search.search({ workspaceId: workspace.id, text: "bulanan" }))
            .length
        ).toBe(1);
        expect(
          (await services.search.search({ workspaceId: workspace.id, text: "roti" }))
            .length
        ).toBe(1);
        expect(
          (await services.search.search({ workspaceId: workspace.id, text: "belan" }))
            .length
        ).toBe(1);
        expect(
          (await services.search.search({ workspaceId: workspace.id, text: "oat" }))
            .length
        ).toBe(0);
      });
    });

    it("filters by folder subtree, by tag, and by kind", async () => {
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
        const tagNote = await services.note.create({
          workspaceId: workspace.id,
          folderId: child.id,
          title: "laporan bulanan",
        });
        await services.note.create({
          workspaceId: workspace.id,
          folderId: null,
          title: "laporan tahunan",
        });
        await services.file.upload({
          workspaceId: workspace.id,
          folderId: root.id,
          name: "laporan.pdf",
          mimeType: "application/pdf",
          data: new Uint8Array([1]),
        });
        await services.note.setTags(tagNote.id, [tag.id]);

        expect(
          (
            await services.search.search({
              workspaceId: workspace.id,
              text: "laporan",
              folderId: child.id,
            })
          ).map((hit) => hit.id)
        ).toEqual([tagNote.id]);
        expect(
          (
            await services.search.search({
              workspaceId: workspace.id,
              text: "laporan",
              tagIds: [tag.id],
            })
          ).map((hit) => hit.id)
        ).toEqual([tagNote.id]);
        expect(
          (
            await services.search.search({
              workspaceId: workspace.id,
              text: "laporan",
              kinds: ["file"],
            })
          ).map((hit) => hit.kind)
        ).toEqual(["file"]);
      });
    });

    it("orders hits by tier, then folded title, then id", async () => {
      await withHarness(create, async ({ services, workspace }) => {
        for (const title of [
          "belanja bulanan",
          "Belanja",
          "Catatan belanja",
          "Belanja",
        ]) {
          await services.note.create({
            workspaceId: workspace.id,
            folderId: null,
            title,
          });
        }

        const hits = await services.search.search({
          workspaceId: workspace.id,
          text: "Belanja",
        });

        expect(hits.slice(0, 2).every((hit) => hit.title === "Belanja")).toBe(true);
        expect(hits[2]?.title).toBe("belanja bulanan");
        expect(hits[3]?.title).toBe("Catatan belanja");
      });
    });

    it("never throws on a hostile query and returns hits or an empty list", async () => {
      await withHarness(create, async ({ services, workspace }) => {
        await services.note.create({
          workspaceId: workspace.id,
          folderId: null,
          title: "belanja bulanan",
        });

        for (const text of HOSTILE) {
          await expect(
            services.search.search({ workspaceId: workspace.id, text })
          ).resolves.toBeInstanceOf(Array);
        }
      });
    });

    it("does not leak hits across workspaces", async () => {
      await withHarness(create, async ({ services, workspace }) => {
        const other = await services.workspace.create("Lain");
        await services.note.create({
          workspaceId: other.id,
          folderId: null,
          title: "belanja bulanan",
        });

        expect(
          (await services.search.search({ workspaceId: workspace.id, text: "belanja" }))
            .length
        ).toBe(0);
      });
    });

    it("reindexAll is callable and search keeps working after it", async () => {
      await withHarness(create, async ({ services, storage, workspace }) => {
        await services.note.create({
          workspaceId: workspace.id,
          folderId: null,
          title: "belanja bulanan",
        });

        await expect(storage.search.reindexAll(workspace.id)).resolves.toBeUndefined();
        expect(
          (await services.search.search({ workspaceId: workspace.id, text: "belanja" }))
            .length
        ).toBe(1);
      });
    });

    it("requires every token to match a word prefix", async () => {
      await withHarness(create, async ({ services, workspace }) => {
        await services.note.create({
          workspaceId: workspace.id,
          folderId: null,
          title: "belanja bulanan",
          content: "susu dan roti",
        });

        expect(
          (
            await services.search.search({
              workspaceId: workspace.id,
              text: "belan bulan",
            })
          ).length
        ).toBe(1);
        expect(
          (
            await services.search.search({
              workspaceId: workspace.id,
              text: "belanja bawang",
            })
          ).length
        ).toBe(0);
      });
    });

    it("folds case and diacritics with the core normalization", async () => {
      await withHarness(create, async ({ services, workspace }) => {
        for (const title of ["Café résumé", "Ünïcode", "İstanbul"]) {
          await services.note.create({
            workspaceId: workspace.id,
            folderId: null,
            title,
          });
        }

        for (const text of ["CAFÉ", "unicode", "istanbul"]) {
          expect(
            (
              await services.search.search({
                workspaceId: workspace.id,
                text,
              })
            ).length,
            text
          ).toBe(1);
        }
      });
    });

    it("matches tokens with attached punctuation and apostrophes", async () => {
      await withHarness(create, async ({ services, workspace }) => {
        for (const title of ["belanja, bulanan", "foo-bar", "don't stop"]) {
          await services.note.create({
            workspaceId: workspace.id,
            folderId: null,
            title,
          });
        }

        for (const text of ["belanja,", "foo-bar", "don't"]) {
          expect(
            (
              await services.search.search({
                workspaceId: workspace.id,
                text,
              })
            ).length,
            text
          ).toBe(1);
        }
      });
    });

    it("breaks title ties by id, not insertion order", async () => {
      await withHarness(create, async ({ services, workspace }) => {
        const first = await services.note.create({
          workspaceId: workspace.id,
          folderId: null,
          title: "Belanja",
        });
        const second = await services.note.create({
          workspaceId: workspace.id,
          folderId: null,
          title: "Belanja",
        });

        const ids = (
          await services.search.search({
            workspaceId: workspace.id,
            text: "belanja",
          })
        ).map((hit) => hit.id);

        expect(ids).toEqual([first.id, second.id].sort());
      });
    });

    it("reindexAll does not make another workspace unsearchable", async () => {
      await withHarness(create, async ({ services, storage, workspace }) => {
        const other = await services.workspace.create("Lain");
        await services.note.create({
          workspaceId: other.id,
          folderId: null,
          title: "belanja bulanan",
        });
        await services.note.create({
          workspaceId: workspace.id,
          folderId: null,
          title: "belanja bulanan",
        });

        await storage.search.reindexAll(workspace.id);

        expect(
          (
            await services.search.search({
              workspaceId: other.id,
              text: "belanja",
            })
          ).length
        ).toBe(1);
        expect(
          (
            await services.search.search({
              workspaceId: workspace.id,
              text: "belanja",
            })
          ).length
        ).toBe(1);
      });
    });
  });
}
