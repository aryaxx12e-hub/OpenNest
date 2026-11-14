import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import type { BlobKey, Folder, IsoDate } from "@opennest/core";
import { createDexieStorage } from "@opennest/storage-dexie";

const FILE_COUNT = 2_000;
const NOTE_COUNT = 2_000;

function now(): IsoDate {
  return new Date().toISOString() as IsoDate;
}

describe("large library benchmark", () => {
  it("keeps list and search latency usable with 2000 files and notes", async () => {
    const storage = createDexieStorage({ databaseName: `opennest-bench-${Date.now()}` });
    await storage.init();

    const at = now();
    const workspace = await storage.workspaces.ensureWorkspace({ name: "Benchmark", at });
    const folders: Folder[] = [];

    for (let index = 0; index < 20; index += 1) {
      folders.push(
        await storage.folders.create({
          workspaceId: workspace.id,
          parentId: null,
          name: `Folder ${String(index).padStart(2, "0")}`,
          at,
        })
      );
    }

    const nested = await storage.folders.create({
      workspaceId: workspace.id,
      parentId: folders[0]!.id,
      name: "Nested",
      at,
    });

    const seedStart = performance.now();

    for (let index = 0; index < FILE_COUNT; index += 1) {
      const folder = index % 50 === 0 ? nested : index % 10 === 0 ? folders[0]! : null;

      await storage.files.create({
        workspaceId: workspace.id,
        folderId: folder?.id ?? null,
        name: `File ${String(index).padStart(4, "0")}.txt`,
        mimeType: "text/plain",
        sizeBytes: 128,
        blobKey: `bench-blob-${index}` as BlobKey,
        checksum: null,
        at,
      });
    }

    for (let index = 0; index < NOTE_COUNT; index += 1) {
      await storage.notes.create({
        workspaceId: workspace.id,
        folderId: index % 25 === 0 ? folders[1]!.id : null,
        title: `Note ${String(index).padStart(4, "0")}`,
        content: `Body for note ${index}. The quick brown fox jumps over the lazy dog.`,
        pinned: index % 100 === 0,
        at,
      });
    }

    const seedMs = performance.now() - seedStart;
    const timings: Record<string, number> = {};

    async function measure<T>(name: string, work: () => Promise<T>): Promise<T> {
      const start = performance.now();
      const result = await work();
      timings[name] = Math.round(performance.now() - start);

      return result;
    }

    const firstFiles = await measure("filesFirstPageMs", () =>
      storage.files.list(
        workspace.id,
        {},
        { limit: 50, sort: "updatedAt", direction: "desc" }
      )
    );
    const folderFiles = await measure("filesFolderPageMs", () =>
      storage.files.list(
        workspace.id,
        { folderId: folders[0]!.id },
        { limit: 50, sort: "name" }
      )
    );
    const firstNotes = await measure("notesFirstPageMs", () =>
      storage.notes.list(
        workspace.id,
        {},
        { limit: 50, sort: "updatedAt", direction: "desc" }
      )
    );
    const allFolders = await measure("folders500Ms", () =>
      storage.folders.list(workspace.id, { limit: 500, sort: "name" })
    );
    await measure("reindexMs", () => storage.search.reindexAll(workspace.id));
    const hits = await measure("searchMs", () =>
      storage.search.search({ workspaceId: workspace.id, text: "note 1999", limit: 20 })
    );

    const summary = {
      counts: { files: FILE_COUNT, notes: NOTE_COUNT, folders: folders.length + 1 },
      hits: hits.length,
      seedMs: Math.round(seedMs),
      timings,
    };

    console.log(JSON.stringify(summary, null, 2));

    expect(firstFiles.total).toBe(FILE_COUNT);
    expect(firstFiles.items).toHaveLength(50);
    expect(folderFiles.total).toBe(200);
    expect(firstNotes.total).toBe(NOTE_COUNT);
    expect(allFolders.items).toHaveLength(21);
    expect(hits.length).toBeGreaterThan(0);

    for (const [name, value] of Object.entries(timings)) {
      expect(value, `${name} should stay under 10 seconds`).toBeLessThan(10_000);
    }

    await storage.close();
  });
});
