import { describe, expect, it } from "vitest";

import { ConstraintError, NotFoundError, ValidationError } from "../errors";
import type { IsoDate, NoteId, WorkspaceId } from "../ids";
import { createMemoryStorage } from "../testing/memory";
import { idGenerator } from "../testing/fixtures";

const AT = "2026-11-12T00:00:00.000Z" as IsoDate;

function setup() {
  return createMemoryStorage({ idGenerator: idGenerator(11) });
}

describe("memory adapter: workspaces", () => {
  it("ensureWorkspace creates once, then returns the same row", async () => {
    const storage = setup();

    const first = await storage.workspaces.ensureWorkspace({ name: "Rumah", at: AT });
    const second = await storage.workspaces.ensureWorkspace({ name: "Lain", at: AT });

    expect(second.id).toBe(first.id);
    expect(second.name).toBe("Rumah");
  });

  it("ensureWorkspace refuses to guess when two workspaces exist", async () => {
    const storage = setup();
    await storage.workspaces.create({ name: "Satu", at: AT });
    await storage.workspaces.create({ name: "Dua", at: AT });

    await expect(storage.workspaces.ensureWorkspace({ at: AT })).rejects.toBeInstanceOf(
      ConstraintError
    );
  });

  it("update and delete on an unknown id are NotFoundError", async () => {
    const storage = setup();

    await expect(
      storage.workspaces.update("missing" as WorkspaceId, { name: "x", at: AT })
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      storage.workspaces.delete("missing" as WorkspaceId)
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("deleting a workspace removes its rows and join tables", async () => {
    const storage = setup();
    const workspace = await storage.workspaces.create({ name: "Satu", at: AT });
    const folder = await storage.folders.create({
      workspaceId: workspace.id,
      parentId: null,
      name: "Root",
      at: AT,
    });
    const tag = await storage.tags.create({
      workspaceId: workspace.id,
      name: "Kerja",
      at: AT,
    });
    const note = await storage.notes.create({
      workspaceId: workspace.id,
      folderId: folder.id,
      title: "Catatan",
      at: AT,
    });
    await storage.notes.setTags(note.id, [tag.id]);

    await storage.workspaces.delete(workspace.id);

    expect(await storage.folders.get(folder.id)).toBeNull();
    expect(await storage.tags.get(tag.id)).toBeNull();
    expect(await storage.notes.get(note.id)).toBeNull();
    expect(await storage.notes.tags(note.id)).toEqual([]);
  });
});

describe("memory adapter: notes", () => {
  it("uses a caller-provided id and rejects a duplicate id", async () => {
    const storage = setup();
    const workspace = await storage.workspaces.create({ name: "Satu", at: AT });
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as NoteId;
    const note = await storage.notes.create({
      id,
      workspaceId: workspace.id,
      folderId: null,
      title: "Catatan tetap",
      at: AT,
    });

    expect(note.id).toBe(id);
    expect(await storage.notes.get(id)).toMatchObject({ id, title: "Catatan tetap" });

    await expect(
      storage.notes.create({
        id,
        workspaceId: workspace.id,
        folderId: null,
        title: "Duplikat",
        at: AT,
      })
    ).rejects.toMatchObject({ code: "duplicate_id" });
  });
});

describe("memory adapter: folders", () => {
  it("deleting a folder moves children and contained items to the root", async () => {
    const storage = setup();
    const workspace = await storage.workspaces.create({ name: "Satu", at: AT });
    const root = await storage.folders.create({
      workspaceId: workspace.id,
      parentId: null,
      name: "Root",
      at: AT,
    });
    const child = await storage.folders.create({
      workspaceId: workspace.id,
      parentId: root.id,
      name: "Child",
      at: AT,
    });
    const note = await storage.notes.create({
      workspaceId: workspace.id,
      folderId: root.id,
      title: "Catatan",
      at: AT,
    });
    const file = await storage.files.create({
      workspaceId: workspace.id,
      folderId: root.id,
      name: "a.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1,
      blobKey: "88888888-8888-4888-8888-888888888888" as never,
      checksum: null,
      at: AT,
    });

    await storage.folders.delete(root.id);

    expect((await storage.folders.get(child.id))?.parentId).toBeNull();
    expect((await storage.notes.get(note.id))?.folderId).toBeNull();
    expect((await storage.files.get(file.id))?.folderId).toBeNull();
  });

  it("ancestors are root first and descendants exclude the folder itself", async () => {
    const storage = setup();
    const workspace = await storage.workspaces.create({ name: "Satu", at: AT });
    const root = await storage.folders.create({
      workspaceId: workspace.id,
      parentId: null,
      name: "Root",
      at: AT,
    });
    const mid = await storage.folders.create({
      workspaceId: workspace.id,
      parentId: root.id,
      name: "Mid",
      at: AT,
    });
    const leaf = await storage.folders.create({
      workspaceId: workspace.id,
      parentId: mid.id,
      name: "Leaf",
      at: AT,
    });

    expect((await storage.folders.ancestors(leaf.id)).map((row) => row.name)).toEqual([
      "Root",
      "Mid",
    ]);
    expect(
      (await storage.folders.descendants(root.id)).map((row) => row.name).sort()
    ).toEqual(["Leaf", "Mid"]);
  });

  it("a folderId filter includes the subtree, and null means the root only", async () => {
    const storage = setup();
    const workspace = await storage.workspaces.create({ name: "Satu", at: AT });
    const root = await storage.folders.create({
      workspaceId: workspace.id,
      parentId: null,
      name: "Root",
      at: AT,
    });
    const child = await storage.folders.create({
      workspaceId: workspace.id,
      parentId: root.id,
      name: "Child",
      at: AT,
    });
    await storage.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "At root",
      at: AT,
    });
    await storage.notes.create({
      workspaceId: workspace.id,
      folderId: root.id,
      title: "In root",
      at: AT,
    });
    await storage.notes.create({
      workspaceId: workspace.id,
      folderId: child.id,
      title: "In child",
      at: AT,
    });

    const subtree = await storage.notes.list(workspace.id, { folderId: root.id });
    const rootOnly = await storage.notes.list(workspace.id, { folderId: null });
    const everything = await storage.notes.list(workspace.id, {});

    expect(subtree.items.map((row) => row.title).sort()).toEqual(["In child", "In root"]);
    expect(rootOnly.items.map((row) => row.title)).toEqual(["At root"]);
    expect(everything.total).toBe(3);
  });
});

describe("memory adapter: pagination", () => {
  it("pages through every row exactly once with a stable cursor", async () => {
    const storage = setup();
    const workspace = await storage.workspaces.create({ name: "Satu", at: AT });
    for (const name of ["d", "b", "a", "c", "e"]) {
      await storage.folders.create({
        workspaceId: workspace.id,
        parentId: null,
        name,
        at: AT,
      });
    }

    const seen: string[] = [];
    let cursor: string | null = null;

    do {
      const page = await storage.folders.list(workspace.id, {
        limit: 2,
        sort: "name",
        cursor,
      });
      seen.push(...page.items.map((row) => row.name));
      cursor = page.nextCursor;
    } while (cursor !== null);

    expect(seen).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("breaks ties on identical names by id so pagination is stable", async () => {
    const storage = setup();
    const workspace = await storage.workspaces.create({ name: "Satu", at: AT });
    for (let index = 0; index < 4; index += 1) {
      await storage.folders.create({
        workspaceId: workspace.id,
        parentId: null,
        name: "same",
        at: AT,
      });
    }

    const first = await storage.folders.list(workspace.id, { limit: 2, sort: "name" });
    const second = await storage.folders.list(workspace.id, {
      limit: 2,
      sort: "name",
      cursor: first.nextCursor,
    });

    const ids = [...first.items, ...second.items].map((row) => row.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids).toEqual([...ids].sort());
  });

  it("a descending sort reverses order but keeps tie-breaking deterministic", async () => {
    const storage = setup();
    const workspace = await storage.workspaces.create({ name: "Satu", at: AT });
    for (const name of ["a", "b", "c"]) {
      await storage.folders.create({
        workspaceId: workspace.id,
        parentId: null,
        name,
        at: AT,
      });
    }

    const page = await storage.folders.list(workspace.id, {
      sort: "name",
      direction: "desc",
    });

    expect(page.items.map((row) => row.name)).toEqual(["c", "b", "a"]);
  });

  it("rejects a malformed cursor", async () => {
    const storage = setup();
    const workspace = await storage.workspaces.create({ name: "Satu", at: AT });

    await expect(
      storage.folders.list(workspace.id, { cursor: "not-a-cursor!" })
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("memory adapter: transactions and lifecycle", () => {
  it("rolls back every write in a failed transaction", async () => {
    const storage = setup();
    const workspace = await storage.workspaces.create({ name: "Satu", at: AT });

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

  it("commits writes when the transaction succeeds", async () => {
    const storage = setup();
    const workspace = await storage.workspaces.create({ name: "Satu", at: AT });

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

  it("using the adapter after close is refused", async () => {
    const storage = setup();
    await storage.close();

    await expect(storage.folders.list("x" as WorkspaceId)).rejects.toMatchObject({
      code: "closed",
    });
  });

  it("reset empties rows and blobs", async () => {
    const storage = setup();
    const workspace = await storage.workspaces.create({ name: "Satu", at: AT });
    await storage.folders.create({
      workspaceId: workspace.id,
      parentId: null,
      name: "Root",
      at: AT,
    });
    await storage.blobs.put(
      "99999999-9999-4999-8999-999999999999" as never,
      new Uint8Array([1])
    );

    await storage.reset();

    expect(await storage.workspaces.list()).toEqual([]);
    expect((await storage.blobs.usage()).items).toBe(0);
  });
});

describe("memory adapter: tags, links, and search", () => {
  it("setTags replaces and de-duplicates the set", async () => {
    const storage = setup();
    const workspace = await storage.workspaces.create({ name: "Satu", at: AT });
    const note = await storage.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Catatan",
      at: AT,
    });
    const one = await storage.tags.create({
      workspaceId: workspace.id,
      name: "Satu",
      at: AT,
    });
    const two = await storage.tags.create({
      workspaceId: workspace.id,
      name: "Dua",
      at: AT,
    });

    await storage.notes.setTags(note.id, [one.id, two.id, one.id]);
    expect((await storage.notes.tags(note.id)).map((row) => row.name).sort()).toEqual([
      "Dua",
      "Satu",
    ]);

    await storage.notes.setTags(note.id, [two.id]);
    expect((await storage.notes.tags(note.id)).map((row) => row.name)).toEqual(["Dua"]);

    await storage.notes.setTags(note.id, []);
    expect(await storage.notes.tags(note.id)).toEqual([]);
  });

  it("deleting a tag removes it from both join tables", async () => {
    const storage = setup();
    const workspace = await storage.workspaces.create({ name: "Satu", at: AT });
    const note = await storage.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Catatan",
      at: AT,
    });
    const tag = await storage.tags.create({
      workspaceId: workspace.id,
      name: "Kerja",
      at: AT,
    });
    await storage.notes.setTags(note.id, [tag.id]);

    await storage.tags.delete(tag.id);

    expect(await storage.notes.tags(note.id)).toEqual([]);
  });

  it("setLinks rejects a self link and replaces the outgoing set", async () => {
    const storage = setup();
    const workspace = await storage.workspaces.create({ name: "Satu", at: AT });
    const first = await storage.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Satu",
      at: AT,
    });
    const second = await storage.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Dua",
      at: AT,
    });

    await storage.notes.setLinks(first.id, [second.id]);
    await expect(storage.notes.setLinks(first.id, [first.id])).rejects.toMatchObject({
      code: "self_link",
    });
    expect(await storage.notes.links(first.id)).toEqual([
      { sourceNoteId: first.id, targetNoteId: second.id },
    ]);

    await storage.notes.setLinks(first.id, []);
    expect(await storage.notes.links(first.id)).toEqual([]);
  });

  it("search is token-prefix, not substring", async () => {
    const storage = setup();
    const workspace = await storage.workspaces.create({ name: "Satu", at: AT });
    await storage.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Belanja bulanan",
      at: AT,
    });

    expect(
      (await storage.search.search({ workspaceId: workspace.id, text: "belanja" })).length
    ).toBe(1);
    expect(
      (await storage.search.search({ workspaceId: workspace.id, text: "oat" })).length
    ).toBe(0);
  });

  it("search orders by tier then folded title then id", async () => {
    const storage = setup();
    const workspace = await storage.workspaces.create({ name: "Satu", at: AT });
    for (const title of ["Belanja", "belanja bulanan", "Catatan belanja", "Belanja"]) {
      await storage.notes.create({
        workspaceId: workspace.id,
        folderId: null,
        title,
        at: AT,
      });
    }

    const hits = await storage.search.search({
      workspaceId: workspace.id,
      text: "Belanja",
    });
    const titles = hits.map((hit) => hit.title);

    expect(titles.slice(0, 2).every((title) => title === "Belanja")).toBe(true);
    expect(titles[2]).toBe("belanja bulanan");
    expect(titles[3]).toBe("Catatan belanja");
  });

  it("a punctuation-only search returns an empty list", async () => {
    const storage = setup();
    const workspace = await storage.workspaces.create({ name: "Satu", at: AT });

    await expect(
      storage.search.search({ workspaceId: workspace.id, text: ' *()-"' })
    ).resolves.toEqual([]);
  });
});
