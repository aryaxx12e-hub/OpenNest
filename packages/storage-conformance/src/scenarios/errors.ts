import { describe, expect, it } from "vitest";

import { DomainError } from "@opennest/core";

import { withHarness } from "../harness";
import type { StorageFactory } from "../index";

export function registerErrorScenarios(create: StorageFactory): void {
  describe("errors", () => {
    it("unknown ids surface as a DomainError with a stable code", async () => {
      await withHarness(create, async ({ storage }) => {
        await expect(storage.folders.delete("missing" as never)).rejects.toMatchObject({
          code: "not_found",
        });
        await expect(storage.notes.get("missing" as never)).resolves.toBeNull();
      });
    });

    it("a storage failure is a DomainError subclass, never a raw driver error", async () => {
      await withHarness(create, async ({ services }) => {
        let caught: unknown;

        try {
          await services.folder.move("missing" as never, null);
        } catch (error) {
          caught = error;
        }

        expect(caught).toBeInstanceOf(DomainError);
        expect(caught).toHaveProperty("code");
      });
    });

    it("closed usage is a storage_error with code closed", async () => {
      const storage = await create();
      await storage.init();
      await storage.close();

      await expect(storage.notes.list("x" as never, {})).rejects.toMatchObject({
        code: "closed",
      });
    });
  });
}
