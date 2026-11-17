import type {
  BackupSnapshot,
  BlobKey,
  FileId,
  FolderId,
  IsoDate,
  NoteId,
  StorageAdapter,
  TagId,
  Workspace,
  WorkspaceId,
} from "@opennest/core";
import { describe, expect, it } from "vitest";

import {
  createEncryptedStorage,
  importAesGcmKey,
  randomBytes,
  type WorkspaceCryptoContext,
} from "../index";

export interface EncryptedHarness {
  base: StorageAdapter;
  storage: StorageAdapter;
  context: WorkspaceCryptoContext;
  workspace: Workspace;
  cleanup(): Promise<void>;
}

export type CreateEncryptedHarness = (options?: {
  outbox?: boolean;
}) => Promise<EncryptedHarness>;

interface SyncOutboxLike {
  entityType: string;
  entityId: string;
  operation: string;
  fieldPatches: Record<string, unknown>;
}

interface SyncHarness {
  sync: {
    listOutbox(workspaceId: string): Promise<SyncOutboxLike[]>;
  };
}

const AT = "2026-11-17T00:00:00.000Z" as IsoDate;
const SOURCE_WORKSPACE = "11111111-1111-4111-8111-111111111111" as WorkspaceId;
const SOURCE_FOLDER = "22222222-2222-4222-8222-222222222222" as FolderId;
const SOURCE_FILE = "33333333-3333-4333-8333-333333333333" as FileId;
const SOURCE_NOTE = "44444444-4444-4444-8444-444444444444" as NoteId;
const SOURCE_TAG = "55555555-5555-4555-8555-555555555555" as TagId;
const SOURCE_BLOB = "66666666-6666-4666-8666-666666666666" as BlobKey;

async function contextFor(
  workspaceId: string,
  keyId = "key-1"
): Promise<WorkspaceCryptoContext> {
  return {
    workspaceId,
    keyId,
    dek: await importAesGcmKey(randomBytes(32)),
  };
}

function bytesOf(data: Blob | Uint8Array): Promise<Uint8Array> {
  return data instanceof Uint8Array
    ? Promise.resolve(data)
    : data.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(data));

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function expectCiphertext(value: string, plaintext: string): void {
  expect(value.startsWith("enc1:")).toBe(true);
  expect(value).not.toBe(plaintext);
  expect(value).not.toContain(plaintext);
}

async function withHarness(
  create: CreateEncryptedHarness,
  run: (harness: EncryptedHarness) => Promise<void>,
  options?: { outbox?: boolean }
): Promise<void> {
  const harness = await create(options);

  try {
    await run(harness);
  } finally {
    await harness.cleanup();
  }
}

function snapshot(): BackupSnapshot {
  return {
    snapshotVersion: 1,
    schemaVersion: 4,
    kind: "dexie",
    createdAt: AT,
    workspace: {
      id: SOURCE_WORKSPACE,
      name: "Sumber",
      createdAt: AT,
      updatedAt: AT,
    },
    folders: [
      {
        id: SOURCE_FOLDER,
        workspaceId: SOURCE_WORKSPACE,
        parentId: null,
        name: "Arsip",
        createdAt: AT,
        updatedAt: AT,
      },
    ],
    files: [
      {
        id: SOURCE_FILE,
        workspaceId: SOURCE_WORKSPACE,
        folderId: SOURCE_FOLDER,
        name: "lampiran.txt",
        mimeType: "text/plain",
        sizeBytes: 8,
        blobKey: SOURCE_BLOB,
        checksum: "a".repeat(64),
        createdAt: AT,
        updatedAt: AT,
      },
    ],
    notes: [
      {
        id: SOURCE_NOTE,
        workspaceId: SOURCE_WORKSPACE,
        folderId: SOURCE_FOLDER,
        title: "Catatan pulih",
        content: "isi rahasia cadangan",
        pinned: false,
        createdAt: AT,
        updatedAt: AT,
      },
    ],
    tags: [
      {
        id: SOURCE_TAG,
        workspaceId: SOURCE_WORKSPACE,
        name: "Arsip",
        color: null,
        createdAt: AT,
      },
    ],
    fileTags: [{ fileId: SOURCE_FILE, tagId: SOURCE_TAG }],
    noteTags: [{ noteId: SOURCE_NOTE, tagId: SOURCE_TAG }],
    noteLinks: [],
    blobs: [
      {
        key: SOURCE_BLOB,
        mimeType: "text/plain",
        data: new TextEncoder().encode("isi blob"),
      },
    ],
  };
}

export function runEncryptedStorageSuite(
  label: string,
  create: CreateEncryptedHarness
): void {
  describe(`encrypted ${label} storage`, () => {
    it("encrypts note content, keeps titles plaintext, and round-trips updates and deletes", async () => {
      await withHarness(create, async ({ base, storage, workspace }) => {
        const note = await storage.notes.create({
          workspaceId: workspace.id,
          folderId: null,
          title: "Rencana Liburan",
          content: "rahasia pantai",
          at: AT,
        });
        const raw = await base.notes.get(note.id);
        expect(raw?.title).toBe("Rencana Liburan");
        expect(raw?.content).toBeDefined();
        expectCiphertext(raw?.content ?? "", "rahasia pantai");
        expect(note.content).toBe("rahasia pantai");

        const updated = await storage.notes.update(note.id, {
          content: "isi baru pantai",
          at: AT,
        });
        const rawUpdated = await base.notes.get(note.id);
        expectCiphertext(rawUpdated?.content ?? "", "isi baru pantai");
        expect(rawUpdated?.content).not.toBe(raw?.content);
        expect(rawUpdated?.title).toBe("Rencana Liburan");
        expect(updated.content).toBe("isi baru pantai");

        const listed = await storage.notes.list(workspace.id, { text: "baru" });
        expect(listed.items.map((row) => row.id)).toEqual([note.id]);
        expect(listed.items[0]?.content).toBe("isi baru pantai");
        expect(
          (await storage.notes.list(workspace.id, { text: "pantai" })).items
        ).toHaveLength(1);
        expect(
          (await storage.notes.list(workspace.id, { text: "tidak-ada" })).items
        ).toHaveLength(0);
        expect((await storage.notes.get(note.id))?.content).toBe("isi baru pantai");

        await storage.notes.delete(note.id);
        expect(await storage.notes.get(note.id)).toBeNull();
        expect(await base.notes.get(note.id)).toBeNull();
      });
    });

    it("decrypts lists while tags, links, and folders keep working", async () => {
      await withHarness(create, async ({ base, storage, workspace }) => {
        const root = await storage.folders.create({
          workspaceId: workspace.id,
          parentId: null,
          name: "Akar",
          at: AT,
        });
        const child = await storage.folders.create({
          workspaceId: workspace.id,
          parentId: root.id,
          name: "Anak",
          at: AT,
        });
        const first = await storage.notes.create({
          workspaceId: workspace.id,
          folderId: child.id,
          title: "Pertama",
          content: "isi pertama rahasia",
          at: AT,
        });
        const second = await storage.notes.create({
          workspaceId: workspace.id,
          folderId: null,
          title: "Kedua",
          content: "isi kedua",
          at: AT,
        });
        const tag = await storage.tags.create({
          workspaceId: workspace.id,
          name: "Penting",
          at: AT,
        });

        const byFolder = await storage.notes.list(workspace.id, {
          folderId: child.id,
        });
        expect(byFolder.items.map((row) => row.id)).toEqual([first.id]);
        expect(byFolder.items[0]?.content).toBe("isi pertama rahasia");

        await storage.notes.setTags(first.id, [tag.id]);
        expect((await storage.notes.tags(first.id)).map((row) => row.id)).toEqual([
          tag.id,
        ]);
        expect(
          (await storage.notes.list(workspace.id, { tagIds: [tag.id] })).items.map(
            (row) => row.id
          )
        ).toEqual([first.id]);

        await storage.notes.setLinks(first.id, [second.id]);
        expect(await storage.notes.links(first.id)).toEqual([
          { sourceNoteId: first.id, targetNoteId: second.id },
        ]);
        expect((await storage.folders.list(workspace.id)).items).toHaveLength(2);

        const raw = await base.notes.get(first.id);
        expect(raw?.title).toBe("Pertama");
        expectCiphertext(raw?.content ?? "", "isi pertama rahasia");
      });
    });

    it("encrypts blobs, decrypts previews, and checksums ciphertext", async () => {
      await withHarness(create, async ({ base, storage, workspace }) => {
        const plaintext = new TextEncoder().encode("lampiran rahasia");
        const blobKey = "77777777-7777-4777-8777-777777777777" as BlobKey;
        await storage.blobs.put(blobKey, new Blob([plaintext], { type: "text/plain" }));

        const rawBlob = await base.blobs.get(blobKey);
        expect(rawBlob).not.toBeNull();
        const rawBytes = await bytesOf(rawBlob as Blob);
        expect(rawBytes).not.toEqual(plaintext);
        expect(new TextDecoder().decode(rawBytes)).not.toContain("lampiran");

        const preview = await storage.blobs.get(blobKey);
        expect(preview?.type).toBe("text/plain");
        expect(await bytesOf(preview as Blob)).toEqual(plaintext);

        const file = await storage.files.create({
          workspaceId: workspace.id,
          folderId: null,
          name: "lampiran.txt",
          mimeType: "text/plain",
          sizeBytes: plaintext.byteLength,
          blobKey,
          checksum: "a".repeat(64),
          at: AT,
        });
        const expectedChecksum = await sha256Hex(rawBytes);
        expect(file.checksum).toBe(expectedChecksum);
        expect(file.checksum).not.toBe("a".repeat(64));
        expect((await base.files.get(file.id))?.checksum).toBe(expectedChecksum);

        const missing = await storage.files.create({
          workspaceId: workspace.id,
          folderId: null,
          name: "hilang.txt",
          mimeType: "text/plain",
          sizeBytes: 0,
          blobKey: "88888888-8888-4888-8888-888888888888" as BlobKey,
          checksum: "b".repeat(64),
          at: AT,
        });
        expect(missing.checksum).toBeNull();
      });
    });

    it("searches decrypted note bodies and titles without ciphertext false positives", async () => {
      await withHarness(create, async ({ storage, workspace }) => {
        const note = await storage.notes.create({
          workspaceId: workspace.id,
          folderId: null,
          title: "Catatan",
          content: "rahasia bulanan",
          at: AT,
        });
        const blobKey = "99999999-9999-4999-8999-999999999999" as BlobKey;
        await storage.blobs.put(blobKey, new TextEncoder().encode("berkas"));
        const file = await storage.files.create({
          workspaceId: workspace.id,
          folderId: null,
          name: "laporan bulanan.pdf",
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
        ).toEqual([note.id, file.id].sort());
        expect(
          (
            await storage.search.search({ workspaceId: workspace.id, text: "rahasia" })
          ).map((hit) => hit.id)
        ).toEqual([note.id]);
        expect(
          (
            await storage.search.search({
              workspaceId: workspace.id,
              text: "laporan",
              kinds: ["file"],
            })
          ).map((hit) => hit.id)
        ).toEqual([file.id]);
        expect(
          (
            await storage.search.search({ workspaceId: workspace.id, text: "Catatan" })
          ).map((hit) => hit.id)
        ).toEqual([note.id]);
        expect(
          await storage.search.search({ workspaceId: workspace.id, text: "enc1" })
        ).toEqual([]);
        expect(
          await storage.search.search({ workspaceId: workspace.id, text: "ONB1" })
        ).toEqual([]);
      });
    });

    it("rejects swapped AAD, wrong keys, and truncated envelopes", async () => {
      await withHarness(create, async ({ base, storage, workspace }) => {
        const first = await storage.notes.create({
          workspaceId: workspace.id,
          folderId: null,
          title: "Satu",
          content: "isi pertama",
          at: AT,
        });
        const second = await storage.notes.create({
          workspaceId: workspace.id,
          folderId: null,
          title: "Dua",
          content: "isi kedua",
          at: AT,
        });
        const rawSecond = await base.notes.get(second.id);
        await base.notes.update(first.id, {
          content: rawSecond?.content,
          at: AT,
        });
        await expect(storage.notes.get(first.id)).rejects.toMatchObject({
          name: "CryptoError",
        });

        const wrongContext = await contextFor(workspace.id);
        const wrongStorage = createEncryptedStorage({
          base,
          context: wrongContext,
        });
        await expect(wrongStorage.notes.get(second.id)).rejects.toMatchObject({
          name: "CryptoError",
        });

        const truncated = await storage.notes.create({
          workspaceId: workspace.id,
          folderId: null,
          title: "Pendek",
          content: "akan dipotong",
          at: AT,
        });
        const rawTruncated = await base.notes.get(truncated.id);
        await base.notes.update(truncated.id, {
          content: (rawTruncated?.content ?? "").slice(0, -4),
          at: AT,
        });
        await expect(storage.notes.get(truncated.id)).rejects.toMatchObject({
          name: "CryptoError",
        });
      });
    });

    it("refuses transactions instead of writing encrypted data non-atomically", async () => {
      await withHarness(create, async ({ storage }) => {
        await expect(storage.transaction(async () => undefined)).rejects.toMatchObject({
          code: "encrypted_transaction",
        });
      });
    });

    it("gives sync sidecars ciphertext content and a plaintext title", async () => {
      await withHarness(
        create,
        async ({ storage, workspace }) => {
          const note = await storage.notes.create({
            workspaceId: workspace.id,
            folderId: null,
            title: "Judul publik",
            content: "isi sangat rahasia",
            at: AT,
          });
          const outbox = await (storage as unknown as SyncHarness).sync.listOutbox(
            workspace.id
          );
          const created = outbox.find(
            (row) =>
              row.entityType === "note" &&
              row.entityId === note.id &&
              row.operation === "create"
          );

          expect(created?.fieldPatches.title).toBe("Judul publik");
          expect(created?.fieldPatches.content).toBeDefined();
          expectCiphertext(created?.fieldPatches.content as string, "isi sangat rahasia");
        },
        { outbox: true }
      );
    });

    it("encrypts a plaintext restore snapshot and maps it to the current workspace", async () => {
      await withHarness(create, async ({ base, storage, workspace }) => {
        await storage.restore(snapshot());

        const note = await storage.notes.get(SOURCE_NOTE);
        expect(note?.workspaceId).toBe(workspace.id);
        expect(note?.content).toBe("isi rahasia cadangan");
        expect(note?.title).toBe("Catatan pulih");

        const rawNote = await base.notes.get(SOURCE_NOTE);
        expect(rawNote?.workspaceId).toBe(workspace.id);
        expect(rawNote?.title).toBe("Catatan pulih");
        expectCiphertext(rawNote?.content ?? "", "isi rahasia cadangan");

        const rawBlob = await base.blobs.get(SOURCE_BLOB);
        expect(rawBlob).not.toBeNull();
        const rawBlobBytes = await bytesOf(rawBlob as Blob);
        expect(new TextDecoder().decode(rawBlobBytes)).not.toContain("isi blob");
        expect(await bytesOf((await storage.blobs.get(SOURCE_BLOB)) as Blob)).toEqual(
          new TextEncoder().encode("isi blob")
        );

        const rawFile = await base.files.get(SOURCE_FILE);
        expect(rawFile?.workspaceId).toBe(workspace.id);
        expect(rawFile?.sizeBytes).toBe(8);
        expect(rawFile?.checksum).toBe(await sha256Hex(rawBlobBytes));
        expect((await base.folders.get(SOURCE_FOLDER))?.workspaceId).toBe(workspace.id);
        expect((await base.tags.get(SOURCE_TAG))?.workspaceId).toBe(workspace.id);
        expect((await storage.workspaces.get(workspace.id))?.name).toBe("Sumber");
      });
    });
  });
}
