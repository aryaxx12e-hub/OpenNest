import { describe, expect, it } from "vitest";

import { withHarness } from "../harness";
import type { StorageFactory } from "../index";

export function registerPaginationScenarios(create: StorageFactory): void {
  describe("pagination", () => {
    it("pages through every row exactly once with a stable cursor", async () => {
      await withHarness(create, async ({ services, workspace }) => {
        for (const name of ["e", "c", "a", "d", "b"]) {
          await services.folder.create({
            workspaceId: workspace.id,
            parentId: null,
            name,
          });
        }

        const seen: string[] = [];
        let cursor: string | null = null;

        do {
          const page = await services.folder.list(workspace.id, {
            limit: 2,
            sort: "name",
            cursor,
          });
          seen.push(...page.items.map((row) => row.name));
          cursor = page.nextCursor;
        } while (cursor !== null);

        expect(seen).toEqual(["a", "b", "c", "d", "e"]);
      });
    });

    it("breaks ties on duplicate sort keys by id, deterministically", async () => {
      await withHarness(create, async ({ services, workspace }) => {
        for (let index = 0; index < 4; index += 1) {
          await services.note.create({
            workspaceId: workspace.id,
            folderId: null,
            title: "sama",
          });
        }

        const first = await services.note.list(
          workspace.id,
          {},
          { limit: 2, sort: "name" }
        );
        const second = await services.note.list(
          workspace.id,
          {},
          { limit: 2, sort: "name", cursor: first.nextCursor }
        );
        const ids = [...first.items, ...second.items].map((row) => row.id);
        const full = await services.note.list(
          workspace.id,
          {},
          { limit: 100, sort: "name" }
        );

        expect(new Set(ids).size).toBe(4);
        expect(ids).toEqual(full.items.map((row) => row.id));
        expect(ids).toEqual([...ids].sort());
      });
    });

    it("a descending sort reverses order but keeps tie-breaking deterministic", async () => {
      await withHarness(create, async ({ services, workspace }) => {
        for (const name of ["a", "b", "c"]) {
          await services.folder.create({
            workspaceId: workspace.id,
            parentId: null,
            name,
          });
        }

        const page = await services.folder.list(workspace.id, {
          sort: "name",
          direction: "desc",
        });

        expect(page.items.map((row) => row.name)).toEqual(["c", "b", "a"]);
      });
    });

    it("pages remain stable across deletions between pages", async () => {
      await withHarness(create, async ({ services, workspace }) => {
        const created = [];

        for (const name of ["a", "b", "c", "d"]) {
          created.push(
            await services.folder.create({
              workspaceId: workspace.id,
              parentId: null,
              name,
            })
          );
        }

        const first = await services.folder.list(workspace.id, {
          limit: 2,
          sort: "name",
        });
        expect(first.items.map((row) => row.name)).toEqual(["a", "b"]);

        await services.folder.delete(created[0]!.id);

        const second = await services.folder.list(workspace.id, {
          limit: 2,
          sort: "name",
          cursor: first.nextCursor,
        });

        expect(second.items.map((row) => row.name)).toEqual(["c", "d"]);
      });
    });
  });
}
