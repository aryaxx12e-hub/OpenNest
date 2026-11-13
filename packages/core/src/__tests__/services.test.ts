import { describe, expect, it } from "vitest";

import { ConflictError, NotFoundError, ValidationError } from "../errors";
import type { IsoDate } from "../ids";
import { createMemoryStorage } from "../testing/memory";
import { idGenerator, tickingClock } from "../testing/fixtures";
import {
  createFileService,
  createFolderService,
  createNoteService,
  createSearchService,
  createTagService,
  createWorkspaceService,
} from "../services";

function setup(clock = tickingClock()) {
  const storage = createMemoryStorage({ idGenerator: idGenerator(7) });
  const hash = async (data: Uint8Array) =>
    Array.from(data, (byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .padEnd(64, "0")
      .slice(0, 64);

  return {
    storage,
    workspaces: createWorkspaceService({
      workspaces: storage.workspaces,
      files: storage.files,
      blobs: storage.blobs,
      clock,
    }),
    folders: createFolderService({
      folders: storage.folders,
      workspaces: storage.workspaces,
      clock,
    }),
    files: createFileService({
      files: storage.files,
      folders: storage.folders,
      workspaces: storage.workspaces,
      blobs: storage.blobs,
      clock,
      hash,
      generateBlobKey: () => "77777777-7777-4777-8777-777777777777",
    }),
    notes: createNoteService({
      notes: storage.notes,
      folders: storage.folders,
      tags: storage.tags,
      workspaces: storage.workspaces,
      clock,
    }),
    tags: createTagService({ tags: storage.tags, workspaces: storage.workspaces, clock }),
    search: createSearchService({ search: storage.search }),
  };
}

describe("clock policy", () => {
  it("the service stamps createdAt from the injected clock, not the adapter", async () => {
    const fixed = (() => "2030-01-01T00:00:00.000Z" as IsoDate) as () => IsoDate;
    const services = setup(fixed);

    const workspace = await services.workspaces.ensure();
    const folder = await services.folders.create({
      workspaceId: workspace.id,
      parentId: null,
      name: "Kerja",
    });

    expect(folder.createdAt).toBe("2030-01-01T00:00:00.000Z");
    expect(folder.createdAt).toBe(workspace.createdAt);
    expect(folder.updatedAt).toBe(folder.createdAt);
  });

  it("each write advances updatedAt by exactly the next clock tick", async () => {
    const clock = tickingClock("2030-01-01T00:00:00.000Z", 1000);
    const services = setup(clock);
    const workspace = await services.workspaces.ensure();
    const folder = await services.folders.create({
      workspaceId: workspace.id,
      parentId: null,
      name: "Kerja",
    });

    const renamed = await services.folders.rename(folder.id, "Kerja Baru");

    expect(workspace.createdAt).toBe("2030-01-01T00:00:00.000Z");
    expect(folder.createdAt).toBe("2030-01-01T00:00:01.000Z");
    expect(renamed.updatedAt).toBe("2030-01-01T00:00:02.000Z");
    expect(renamed.name).toBe("Kerja Baru");
  });

  it("a fixed clock is accepted and never produces an earlier updatedAt", async () => {
    const clock = (() => "2030-01-01T00:00:00.000Z" as IsoDate) as () => IsoDate;
    const services = setup(clock);
    const workspace = await services.workspaces.ensure();
    const tag = await services.tags.create({ workspaceId: workspace.id, name: "Kerja" });
    const renamed = await services.tags.update(tag.id, { name: "Kerja 2" });

    expect(renamed.createdAt).toBe("2030-01-01T00:00:00.000Z");
    expect(renamed.name).toBe("Kerja 2");
  });

  it("an adapter call without a timestamp is refused, proving adapters never read the clock", async () => {
    const storage = createMemoryStorage({ idGenerator: idGenerator(3) });

    await expect(
      storage.folders.create({
        workspaceId: "ws" as never,
        parentId: null,
        name: "Kerja",
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("workspace service", () => {
  it("ensure creates one workspace and then returns it unchanged", async () => {
    const services = setup();

    const first = await services.workspaces.ensure("Rumah");
    const second = await services.workspaces.ensure("Nama Lain");

    expect(second.id).toBe(first.id);
    expect(second.name).toBe("Rumah");
  });

  it("rename rejects an empty name", async () => {
    const services = setup();
    const workspace = await services.workspaces.ensure();

    await expect(services.workspaces.rename(workspace.id, "   ")).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it("rename on an unknown workspace is a NotFoundError", async () => {
    const services = setup();

    await expect(
      services.workspaces.rename("missing" as never, "Baru")
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("folder service", () => {
  it("creates nested folders and rejects a cycle on move", async () => {
    const services = setup();
    const workspace = await services.workspaces.ensure();
    const root = await services.folders.create({
      workspaceId: workspace.id,
      parentId: null,
      name: "Root",
    });
    const child = await services.folders.create({
      workspaceId: workspace.id,
      parentId: root.id,
      name: "Child",
    });

    await expect(services.folders.move(root.id, child.id)).rejects.toMatchObject({
      code: "folder_cycle",
    });
    await expect(services.folders.move(root.id, root.id)).rejects.toMatchObject({
      code: "folder_cycle",
    });
    await expect(services.folders.move(child.id, null)).resolves.toMatchObject({
      parentId: null,
    });
  });

  it("rejects a parent in another workspace", async () => {
    const services = setup();
    const first = await services.workspaces.ensure();
    const second = await services.workspaces.create("Kedua");
    const parent = await services.folders.create({
      workspaceId: first.id,
      parentId: null,
      name: "Root",
    });

    await expect(
      services.folders.create({
        workspaceId: second.id,
        parentId: parent.id,
        name: "Anak",
      })
    ).rejects.toMatchObject({ code: "cross_workspace" });
  });

  it("rejects an invalid display name", async () => {
    const services = setup();
    const workspace = await services.workspaces.ensure();

    await expect(
      services.folders.create({
        workspaceId: workspace.id,
        parentId: null,
        name: "a/b",
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("descendants lists the whole subtree", async () => {
    const services = setup();
    const workspace = await services.workspaces.ensure();
    const root = await services.folders.create({
      workspaceId: workspace.id,
      parentId: null,
      name: "Root",
    });
    const child = await services.folders.create({
      workspaceId: workspace.id,
      parentId: root.id,
      name: "Child",
    });
    await services.folders.create({
      workspaceId: workspace.id,
      parentId: child.id,
      name: "Grandchild",
    });

    const descendants = await services.folders.descendants(root.id);

    expect(descendants.map((folder) => folder.name).sort()).toEqual([
      "Child",
      "Grandchild",
    ]);
  });
});

describe("tag service", () => {
  it("rejects a case-insensitive duplicate", async () => {
    const services = setup();
    const workspace = await services.workspaces.ensure();
    await services.tags.create({ workspaceId: workspace.id, name: "Kerja" });

    await expect(
      services.tags.create({ workspaceId: workspace.id, name: "  kerja  " })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("allows the same tag name in a different workspace", async () => {
    const services = setup();
    const first = await services.workspaces.create("Satu");
    const second = await services.workspaces.create("Dua");
    await services.tags.create({ workspaceId: first.id, name: "Kerja" });

    await expect(
      services.tags.create({ workspaceId: second.id, name: "Kerja" })
    ).resolves.toMatchObject({ name: "Kerja" });
  });

  it("renaming onto an existing name is a conflict, renaming to itself is not", async () => {
    const services = setup();
    const workspace = await services.workspaces.ensure();
    const first = await services.tags.create({
      workspaceId: workspace.id,
      name: "Kerja",
    });
    await services.tags.create({ workspaceId: workspace.id, name: "Pribadi" });

    await expect(
      services.tags.update(first.id, { name: "pribadi" })
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      services.tags.update(first.id, { name: "KERJA" })
    ).resolves.toMatchObject({
      name: "KERJA",
    });
  });

  it("validates the colour and lowercases it", async () => {
    const services = setup();
    const workspace = await services.workspaces.ensure();
    const tag = await services.tags.create({
      workspaceId: workspace.id,
      name: "Kerja",
      color: "#A1B2C3",
    });

    expect(tag.color).toBe("#a1b2c3");
    await expect(services.tags.update(tag.id, { color: "red" })).rejects.toBeInstanceOf(
      ValidationError
    );
  });
});

describe("note service", () => {
  it("validates the title and keeps content verbatim", async () => {
    const services = setup();
    const workspace = await services.workspaces.ensure();

    const note = await services.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "  Rencana  ",
      content: "baris 1\n\nbaris 2  ",
    });

    expect(note.title).toBe("Rencana");
    expect(note.content).toBe("baris 1\n\nbaris 2  ");
    expect(note.pinned).toBe(false);
  });

  it("rejects an empty title and a folder from another workspace", async () => {
    const services = setup();
    const first = await services.workspaces.ensure();
    const other = await services.workspaces.create("Lain");
    const otherFolder = await services.folders.create({
      workspaceId: other.id,
      parentId: null,
      name: "Root Lain",
    });

    await expect(
      services.notes.create({ workspaceId: first.id, folderId: null, title: " " })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      services.notes.create({
        workspaceId: first.id,
        folderId: otherFolder.id,
        title: "Catatan",
      })
    ).rejects.toMatchObject({ code: "cross_workspace" });
  });

  it("links replace the set, de-duplicate, and reject a self link", async () => {
    const services = setup();
    const workspace = await services.workspaces.ensure();
    const first = await services.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Satu",
    });
    const second = await services.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Dua",
    });

    await services.notes.setLinks(first.id, [second.id, second.id]);
    expect(await services.notes.links(first.id)).toEqual([
      { sourceNoteId: first.id, targetNoteId: second.id },
    ]);

    await expect(services.notes.setLinks(first.id, [first.id])).rejects.toMatchObject({
      code: "self_link",
    });
    expect(await services.notes.links(first.id)).toEqual([
      { sourceNoteId: first.id, targetNoteId: second.id },
    ]);
  });

  it("setTags rejects a tag from another workspace and de-duplicates", async () => {
    const services = setup();
    const workspace = await services.workspaces.ensure();
    const other = await services.workspaces.create("Lain");
    const note = await services.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Catatan",
    });
    const tag = await services.tags.create({ workspaceId: workspace.id, name: "Kerja" });
    const foreign = await services.tags.create({ workspaceId: other.id, name: "Lain" });

    await services.notes.setTags(note.id, [tag.id, tag.id]);
    expect((await services.notes.tags(note.id)).map((row) => row.id)).toEqual([tag.id]);

    await expect(
      services.notes.setTags(note.id, [tag.id, foreign.id])
    ).rejects.toMatchObject({ code: "cross_workspace" });
  });
});

describe("file service", () => {
  const blobKey = "77777777-7777-4777-8777-777777777777";

  it("validates upload limits before writing metadata", async () => {
    const services = setup();
    const workspace = await services.workspaces.ensure();

    await expect(
      services.files.create({
        workspaceId: workspace.id,
        folderId: null,
        name: "laporan.pdf",
        mimeType: "application/zip",
        sizeBytes: 10,
        blobKey,
        checksum: null,
      })
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      services.files.create({
        workspaceId: workspace.id,
        folderId: null,
        name: "laporan.pdf",
        mimeType: "application/pdf",
        sizeBytes: 26_214_401,
        blobKey,
        checksum: null,
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects an unsafe blob key and a bad display name", async () => {
    const services = setup();
    const workspace = await services.workspaces.ensure();
    const base = {
      workspaceId: workspace.id,
      folderId: null,
      name: "laporan.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
    };

    await expect(
      services.files.create({ ...base, blobKey: "../etc/passwd", checksum: null })
    ).rejects.toMatchObject({ code: "unsafe_key" });
    await expect(
      services.files.create({ ...base, name: "..", blobKey, checksum: null })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("normalizes a checksum to lowercase and accepts null", async () => {
    const services = setup();
    const workspace = await services.workspaces.ensure();
    const base = {
      workspaceId: workspace.id,
      folderId: null,
      name: "laporan.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      blobKey,
    };

    const withSum = await services.files.create({
      ...base,
      checksum: "A".repeat(64),
    });
    const withoutSum = await services.files.create({
      ...base,
      checksum: null,
      name: "b.pdf",
    });

    expect(withSum.checksum).toBe("a".repeat(64));
    expect(withoutSum.checksum).toBeNull();
    await expect(
      services.files.create({ ...base, name: "c.pdf", checksum: "xyz" })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("upload hashes, writes the blob first, then the row", async () => {
    const services = setup();
    const workspace = await services.workspaces.ensure();
    const data = new Uint8Array([1, 2, 3, 4]);

    const file = await services.files.upload({
      workspaceId: workspace.id,
      folderId: null,
      name: "catatan.txt",
      mimeType: "text/plain",
      data,
    });

    expect(file.sizeBytes).toBe(4);
    expect(file.checksum).toBe(
      "0102030400000000000000000000000000000000000000000000000000000000"
    );
    expect(await services.storage.blobs.has(file.blobKey)).toBe(true);
  });

  it("upload removes the blob it wrote when the row insert fails", async () => {
    const services = setup();
    const workspace = await services.workspaces.ensure();
    const failing = {
      ...services.storage.files,
      async create() {
        throw new Error("row insert failed");
      },
    };

    const service = createFileService({
      files: failing,
      folders: services.storage.folders,
      workspaces: services.storage.workspaces,
      blobs: services.storage.blobs,
      clock: () => "2030-01-01T00:00:00.000Z" as IsoDate,
      hash: async () => "0".repeat(64),
      generateBlobKey: () => "99999999-9999-4999-8999-999999999999",
    });

    await expect(
      service.upload({
        workspaceId: workspace.id,
        folderId: null,
        name: "gagal.txt",
        mimeType: "text/plain",
        data: new Uint8Array([9]),
      })
    ).rejects.toThrow("row insert failed");

    expect(
      await services.storage.blobs.has("99999999-9999-4999-8999-999999999999" as never)
    ).toBe(false);
  });
});

describe("workspace service", () => {
  it("delete removes rows and purges the blobs those rows pointed at", async () => {
    const services = setup();
    const workspace = await services.workspaces.ensure();
    const file = await services.files.upload({
      workspaceId: workspace.id,
      folderId: null,
      name: "catatan.txt",
      mimeType: "text/plain",
      data: new Uint8Array([1, 2, 3]),
    });

    expect((await services.storage.blobs.usage()).items).toBe(1);

    await services.workspaces.delete(workspace.id);

    expect((await services.storage.blobs.usage()).items).toBe(0);
    expect(await services.storage.files.get(file.id)).toBeNull();
  });

  it("delete keeps a blob that another workspace still references", async () => {
    const services = setup();
    const first = await services.workspaces.ensure();
    const second = await services.workspaces.create("Kedua");
    const blobKey = "55555555-5555-4555-8555-555555555555";

    await services.files.create({
      workspaceId: first.id,
      folderId: null,
      name: "a.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
      blobKey,
      checksum: null,
    });
    await services.files.create({
      workspaceId: second.id,
      folderId: null,
      name: "b.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
      blobKey,
      checksum: null,
    });
    await services.storage.blobs.put(blobKey as never, new Uint8Array([7]));

    await services.workspaces.delete(first.id);

    expect((await services.storage.blobs.usage()).items).toBe(1);
  });
});

describe("search service", () => {
  it("returns hits in tier order and de-duplicates whitespace", async () => {
    const services = setup();
    const workspace = await services.workspaces.ensure();
    await services.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Belanja bulanan",
    });
    await services.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Belanja",
    });
    await services.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Catatan",
      content: "daftar belanja",
    });

    const hits = await services.search.search({
      workspaceId: workspace.id,
      text: "  belanja  ",
    });

    expect(hits.map((hit) => hit.title)).toEqual([
      "Belanja",
      "Belanja bulanan",
      "Catatan",
    ]);
  });

  it("returns an empty list for punctuation-only input instead of throwing", async () => {
    const services = setup();
    const workspace = await services.workspaces.ensure();

    await expect(
      services.search.search({ workspaceId: workspace.id, text: ' *()-"' })
    ).resolves.toEqual([]);
  });

  it("filters by kind and preserves the parity contract shape", async () => {
    const services = setup();
    const workspace = await services.workspaces.ensure();
    await services.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Belanja",
    });

    const notesOnly = await services.search.search({
      workspaceId: workspace.id,
      text: "belanja",
      kinds: ["note"],
    });
    const filesOnly = await services.search.search({
      workspaceId: workspace.id,
      text: "belanja",
      kinds: ["file"],
    });

    expect(notesOnly).toHaveLength(1);
    expect(filesOnly).toEqual([]);
  });
});
