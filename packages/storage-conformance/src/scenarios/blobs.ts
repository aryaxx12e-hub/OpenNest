import { describe, expect, it } from "vitest";

import type { BlobKey } from "@opennest/core";

import { withHarness } from "../harness";
import type { StorageFactory } from "../index";

const KEY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as BlobKey;
const KEY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as BlobKey;
const KEY_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc" as BlobKey;

function bytes(length: number, fill: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(length).fill(fill);
}

async function readAll(blob: Blob | null): Promise<Uint8Array> {
  if (blob === null) {
    throw new Error("Blob is missing.");
  }

  return new Uint8Array(await blob.arrayBuffer());
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }

  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

export function registerBlobScenarios(create: StorageFactory): void {
  describe("blobs", () => {
    it("put, get, has and delete round-trip a byte array", async () => {
      await withHarness(create, async ({ storage }) => {
        const data = bytes(4, 7);

        await storage.blobs.put(KEY_A, data);
        expect(await storage.blobs.has(KEY_A)).toBe(true);

        const stored = await storage.blobs.get(KEY_A);
        expect(Array.from(await readAll(stored))).toEqual([7, 7, 7, 7]);

        await storage.blobs.delete(KEY_A);
        expect(await storage.blobs.has(KEY_A)).toBe(false);
        expect(await storage.blobs.get(KEY_A)).toBeNull();
      });
    });

    it("round-trips a Blob input and preserves its MIME type", async () => {
      await withHarness(create, async ({ storage }) => {
        await storage.blobs.put(
          KEY_A,
          new Blob([bytes(3, 9)], { type: "application/pdf" })
        );

        const stored = await storage.blobs.get(KEY_A);
        expect(stored?.type).toBe("application/pdf");
        expect(Array.from(await readAll(stored))).toEqual([9, 9, 9]);
      });
    });

    it("is byte-exact for 0-byte, 1-byte and 1 MiB payloads", async () => {
      await withHarness(create, async ({ storage }) => {
        const payloads: Array<[BlobKey, Uint8Array]> = [
          [KEY_A, new Uint8Array(0)],
          [KEY_B, new Uint8Array([42])],
          [KEY_C, Uint8Array.from({ length: 1024 * 1024 }, (_, index) => index % 251)],
        ];

        for (const [key, payload] of payloads) {
          await storage.blobs.put(key, payload);
          const stored = await readAll(await storage.blobs.get(key));

          expect(stored.byteLength).toBe(payload.byteLength);
          expect(equalBytes(stored, payload)).toBe(true);
        }
      });
    }, 30000);

    it("usage() accounts for bytes and items, then drops to zero after delete", async () => {
      await withHarness(create, async ({ storage }) => {
        await storage.blobs.put(KEY_A, bytes(10, 1));
        await storage.blobs.put(KEY_B, bytes(5, 2));

        expect(await storage.blobs.usage()).toEqual({ bytes: 15, items: 2 });

        await storage.blobs.delete(KEY_A);
        expect(await storage.blobs.usage()).toEqual({ bytes: 5, items: 1 });
      });
    });

    it("overwriting a key replaces the bytes without inflating item count", async () => {
      await withHarness(create, async ({ storage }) => {
        await storage.blobs.put(KEY_A, bytes(10, 1));
        await storage.blobs.put(KEY_A, bytes(3, 2));

        expect(await storage.blobs.usage()).toEqual({ bytes: 3, items: 1 });
        expect(Array.from(await readAll(await storage.blobs.get(KEY_A)))).toEqual([
          2, 2, 2,
        ]);
      });
    });

    it("purgeOrphans removes only keys that are not known", async () => {
      await withHarness(create, async ({ storage }) => {
        await storage.blobs.put(KEY_A, bytes(1, 1));
        await storage.blobs.put(KEY_B, bytes(1, 2));
        await storage.blobs.put(KEY_C, bytes(1, 3));

        const removed = await storage.blobs.purgeOrphans([KEY_A, KEY_C]);

        expect(removed).toBe(1);
        expect(await storage.blobs.has(KEY_A)).toBe(true);
        expect(await storage.blobs.has(KEY_B)).toBe(false);
        expect(await storage.blobs.has(KEY_C)).toBe(true);
      });
    });
  });
}
