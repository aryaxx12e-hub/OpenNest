// @vitest-environment node

import { createMemoryStorage, type BlobKey, type IsoDate } from "@opennest/core";
import { describe, expect, it } from "vitest";

import { createEncryptedStorage, importAesGcmKey, randomBytes } from "../index";

const AT = "2026-11-17T00:00:00.000Z" as IsoDate;

async function setup() {
  const base = createMemoryStorage();
  await base.init();
  const workspace = await base.workspaces.ensureWorkspace({ at: AT });
  const context = {
    workspaceId: workspace.id,
    keyId: "key-1",
    dek: await importAesGcmKey(randomBytes(32)),
  };
  const storage = createEncryptedStorage({ base, context });

  return { base, storage, workspace };
}

describe("encrypted search", () => {
  it("matches decrypted titles and bodies, and file names", async () => {
    const { storage, workspace } = await setup();
    const body = await storage.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Catatan",
      content: "rahasia bulanan",
      at: AT,
    });
    const titled = await storage.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Laporan khusus",
      content: "",
      at: AT,
    });
    const blobKey = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as BlobKey;
    await storage.blobs.put(blobKey, new TextEncoder().encode("berkas"));
    const file = await storage.files.create({
      workspaceId: workspace.id,
      folderId: null,
      name: "ringkasan bulanan.pdf",
      mimeType: "application/pdf",
      sizeBytes: 6,
      blobKey,
      checksum: null,
      at: AT,
    });

    expect(
      (await storage.search.search({ workspaceId: workspace.id, text: "bulanan" }))
        .map((hit) => hit.id)
        .sort()
    ).toEqual([body.id, file.id].sort());
    expect(
      (await storage.search.search({ workspaceId: workspace.id, text: "rahasia" })).map(
        (hit) => hit.id
      )
    ).toEqual([body.id]);
    expect(
      (await storage.search.search({ workspaceId: workspace.id, text: "Laporan" })).map(
        (hit) => hit.id
      )
    ).toEqual([titled.id]);
    expect(
      (
        await storage.search.search({
          workspaceId: workspace.id,
          text: "ringkasan",
          kinds: ["file"],
        })
      ).map((hit) => hit.id)
    ).toEqual([file.id]);
  });

  it("does not truncate file hits at the base search page size", async () => {
    const { storage, workspace } = await setup();
    const blobKey = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as BlobKey;

    for (let index = 0; index < 55; index += 1) {
      await storage.files.create({
        workspaceId: workspace.id,
        folderId: null,
        name: `laporan ${index}.txt`,
        mimeType: "text/plain",
        sizeBytes: 0,
        blobKey,
        checksum: null,
        at: AT,
      });
    }

    const hits = await storage.search.search({
      workspaceId: workspace.id,
      text: "laporan",
      kinds: ["file"],
      limit: 100,
    });

    expect(hits).toHaveLength(55);
  });

  it("does not turn envelope prefixes into search hits", async () => {
    const { storage, workspace } = await setup();
    await storage.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Catatan",
      content: "isi biasa",
      at: AT,
    });

    expect(
      await storage.search.search({ workspaceId: workspace.id, text: "enc1" })
    ).toEqual([]);
    expect(
      await storage.search.search({ workspaceId: workspace.id, text: "ONB1" })
    ).toEqual([]);
  });

  it("applies limits and offsets across encrypted note hits", async () => {
    const { storage, workspace } = await setup();
    const first = await storage.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Belanja",
      content: "bulanan",
      at: AT,
    });
    const second = await storage.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Belanja bulanan",
      content: "",
      at: AT,
    });

    const all = await storage.search.search({
      workspaceId: workspace.id,
      text: "belanja",
    });
    expect(all.map((hit) => hit.id)).toEqual([first.id, second.id]);

    const page = await storage.search.search({
      workspaceId: workspace.id,
      text: "belanja",
      limit: 1,
      offset: 1,
    });
    expect(page.map((hit) => hit.id)).toEqual([second.id]);
  });
});
