import { describe, expect, it } from "vitest";

import { UnsupportedError } from "@opennest/core";

import { withHarness } from "../harness";
import type { StorageFactory } from "../index";

const AT = "2026-11-12T00:00:00.000Z" as never;

export function registerTransactionScenarios(create: StorageFactory): void {
  describe("transactions", () => {
    it("rolls back every write when the work throws", async () => {
      await withHarness(create, async ({ storage, workspace }) => {
        await expect(
          storage.transaction(async (repos) => {
            await repos.folders.create({
              workspaceId: workspace.id,
              parentId: null,
              name: "Sementara",
              at: AT,
            });

            throw new Error("boom");
          })
        ).rejects.toThrow("boom");

        expect((await storage.folders.list(workspace.id)).total).toBe(0);
      });
    });

    it("commits writes when the transaction succeeds", async () => {
      await withHarness(create, async ({ storage, workspace }) => {
        await storage.transaction(async (repos) => {
          await repos.folders.create({
            workspaceId: workspace.id,
            parentId: null,
            name: "Tetap",
            at: AT,
          });
        });

        expect((await storage.folders.list(workspace.id)).total).toBe(1);
      });
    });

    it("returns the work's value", async () => {
      await withHarness(create, async ({ storage, workspace }) => {
        const value = await storage.transaction(async () => 42);

        expect(value).toBe(42);
        expect(await storage.workspaces.get(workspace.id)).not.toBeNull();
      });
    });

    it("a nested transaction throws nested_transaction", async () => {
      await withHarness(create, async ({ storage }) => {
        await expect(
          storage.transaction(async () => {
            await storage.transaction(async () => undefined);
          })
        ).rejects.toBeInstanceOf(UnsupportedError);
      });
    });

    it("rolls back a multi-table write as a unit", async () => {
      await withHarness(create, async ({ storage, services, workspace }) => {
        const tag = await services.tag.create({
          workspaceId: workspace.id,
          name: "Kerja",
        });

        await expect(
          storage.transaction(async (repos) => {
            const note = await repos.notes.create({
              workspaceId: workspace.id,
              folderId: null,
              title: "Sementara",
              at: AT,
            });
            await repos.notes.setTags(note.id, [tag.id]);

            throw new Error("batalkan");
          })
        ).rejects.toThrow("batalkan");

        expect((await storage.notes.list(workspace.id, {})).total).toBe(0);
        expect((await storage.workspaces.list()).length).toBeGreaterThan(0);
      });
    });
  });
}
