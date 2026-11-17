import { describe, expect, it } from "vitest";

import {
  createMemoryStorage,
  generateId,
  type BlobKey,
  type FileId,
  type IsoDate,
  type NoteId,
  type StorageAdapter,
  type Workspace,
} from "@opennest/core";

import {
  createEncryptedStorage,
  createKeyring,
  createMemoryKeyringStore,
  enableEncryption,
  parseTextEnvelope,
  rotateWorkspaceKey,
  type Keyring,
} from "../index";

const AT = "2026-11-17T00:00:00.000Z" as IsoDate;
const PASSPHRASE = "a long rotation passphrase";

interface Seed {
  blobKey: BlobKey;
  noteId: NoteId;
  fileId: FileId;
}

function flakyKeyring(keyring: Keyring): Keyring {
  let failCommit = true;

  return new Proxy(keyring, {
    get(target, property) {
      if (property === "commitRotation") {
        return async () => {
          if (failCommit) {
            failCommit = false;
            throw new Error("commit failed");
          }

          return target.commitRotation();
        };
      }

      const value = Reflect.get(target, property, target);

      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function seed(base: StorageAdapter, workspace: Workspace): Promise<Seed> {
  const blobKey = generateId() as BlobKey;
  await base.blobs.put(
    blobKey,
    new Blob([new TextEncoder().encode("rotated attachment bytes")], {
      type: "text/plain",
    })
  );
  const file = await base.files.create({
    workspaceId: workspace.id,
    folderId: null,
    name: "rotasi.txt",
    mimeType: "text/plain",
    sizeBytes: 22,
    blobKey,
    checksum: null,
    at: AT,
  });
  const note = await base.notes.create({
    workspaceId: workspace.id,
    folderId: null,
    title: "Catatan rotasi",
    content: "isi yang harus dienkripsi ulang",
    at: AT,
  });

  return { blobKey, noteId: note.id, fileId: file.id };
}

async function setup() {
  const base = createMemoryStorage();
  await base.init();
  const workspace = await base.workspaces.ensureWorkspace({ at: AT });
  const seeded = await seed(base, workspace);
  const keyring = createKeyring({
    store: createMemoryKeyringStore(),
    workspaceId: workspace.id,
    now: () => 1_700_000_000_000,
  });
  const migrated = await enableEncryption({
    base,
    keyring,
    passphrase: PASSPHRASE,
  });

  return { base, workspace, seeded, keyring, migrated };
}

async function blobText(base: StorageAdapter, blobKey: BlobKey): Promise<string> {
  const blob = await base.blobs.get(blobKey);

  if (blob === null) {
    throw new Error("Blob is missing");
  }

  return new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
}

describe("workspace key rotation", () => {
  it("re-encrypts content, invalidates the old key, and keeps recovery working", async () => {
    const { base, seeded, keyring, migrated } = await setup();

    try {
      const oldNote = await base.notes.get(seeded.noteId);
      const oldFile = await base.files.get(seeded.fileId);
      const oldBlobText = oldFile === null ? "" : await blobText(base, oldFile.blobKey);
      const rotated = await rotateWorkspaceKey({
        base,
        keyring,
        passphrase: PASSPHRASE,
        context: migrated.context,
      });

      expect(rotated.record.state).toBe("active");
      expect(rotated.record.pending).toBeNull();
      expect(rotated.record.activeKid).not.toBe(migrated.record.activeKid);
      expect(rotated.context.keyId).toBe(rotated.record.activeKid);
      expect((await keyring.get())?.activeKid).toBe(rotated.record.activeKid);

      const newNote = await base.notes.get(seeded.noteId);
      const newFile = await base.files.get(seeded.fileId);

      expect(newNote?.content.startsWith("enc1:")).toBe(true);
      expect(newNote?.content).not.toBe(oldNote?.content);
      expect(parseTextEnvelope(newNote?.content ?? "").body.kid).toBe(
        rotated.record.activeKid
      );
      expect(newFile?.blobKey).not.toBe(oldFile?.blobKey);
      expect(newFile?.blobKey).not.toBe(seeded.blobKey);
      expect(await base.blobs.has(seeded.blobKey)).toBe(false);
      expect(await blobText(base, newFile?.blobKey ?? seeded.blobKey)).not.toBe(
        oldBlobText
      );

      const storage = createEncryptedStorage({ base, context: rotated.context });
      expect((await storage.notes.get(seeded.noteId))?.content).toBe(
        "isi yang harus dienkripsi ulang"
      );
      const file = await storage.files.get(seeded.fileId);
      const blob = await storage.blobs.get(file?.blobKey ?? seeded.blobKey);

      if (blob === null) {
        throw new Error("Rotated blob is missing");
      }

      expect(new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()))).toBe(
        "rotated attachment bytes"
      );

      const oldStorage = createEncryptedStorage({ base, context: migrated.context });
      await expect(oldStorage.notes.get(seeded.noteId)).rejects.toMatchObject({
        code: "unknown_key_id",
      });

      const recovered = await keyring.unlockWithRecoveryKey(migrated.recoveryKey);
      expect(recovered.keyId).toBe(rotated.record.activeKid);
      const recoveredStorage = createEncryptedStorage({ base, context: recovered });
      expect((await recoveredStorage.notes.get(seeded.noteId))?.content).toBe(
        "isi yang harus dienkripsi ulang"
      );
    } finally {
      await base.close();
    }
  });

  it("resumes an interrupted rotation without creating another pending key", async () => {
    const { base, seeded, keyring, migrated } = await setup();

    try {
      const interrupted = flakyKeyring(keyring);

      await expect(
        rotateWorkspaceKey({
          base,
          keyring: interrupted,
          passphrase: PASSPHRASE,
          context: migrated.context,
        })
      ).rejects.toMatchObject({ code: "rotation_failed" });

      const pendingRecord = await keyring.get();
      const pendingKid = pendingRecord?.pending?.kid;
      expect(pendingRecord?.state).toBe("active");
      expect(pendingRecord?.activeKid).toBe(migrated.record.activeKid);
      expect(pendingKid).toBeDefined();
      const rawNote = await base.notes.get(seeded.noteId);
      expect(parseTextEnvelope(rawNote?.content ?? "").body.kid).toBe(pendingKid);

      const rotated = await rotateWorkspaceKey({
        base,
        keyring: interrupted,
        passphrase: PASSPHRASE,
        context: migrated.context,
      });

      expect(rotated.record.pending).toBeNull();
      expect(rotated.record.activeKid).toBe(pendingKid);
      expect((await keyring.get())?.activeKid).toBe(pendingKid);

      const storage = createEncryptedStorage({ base, context: rotated.context });
      expect((await storage.notes.get(seeded.noteId))?.content).toBe(
        "isi yang harus dienkripsi ulang"
      );
    } finally {
      await base.close();
    }
  });

  it("runs the before-commit hook with the pending key before committing", async () => {
    const { base, seeded, keyring, migrated } = await setup();

    try {
      const observations: {
        keyId: string;
        pendingKid: string | null;
        activeKid: string;
        noteKid: string;
      }[] = [];

      const rotated = await rotateWorkspaceKey({
        base,
        keyring,
        passphrase: PASSPHRASE,
        context: migrated.context,
        beforeCommit: async (context) => {
          const record = await keyring.get();
          const note = await base.notes.get(seeded.noteId);

          observations.push({
            keyId: context.keyId,
            pendingKid: record?.pending?.kid ?? null,
            activeKid: record?.activeKid ?? "",
            noteKid: parseTextEnvelope(note?.content ?? "").body.kid,
          });
        },
      });

      expect(observations).toEqual([
        {
          keyId: rotated.record.activeKid,
          pendingKid: rotated.record.activeKid,
          activeKid: migrated.record.activeKid,
          noteKid: rotated.record.activeKid,
        },
      ]);
    } finally {
      await base.close();
    }
  });

  it("keeps a pending rotation when the before-commit hook fails and retries", async () => {
    const { base, seeded, keyring, migrated } = await setup();

    try {
      let fail = true;

      await expect(
        rotateWorkspaceKey({
          base,
          keyring,
          passphrase: PASSPHRASE,
          context: migrated.context,
          beforeCommit: async () => {
            if (fail) {
              fail = false;
              throw new Error("draft journal failed");
            }
          },
        })
      ).rejects.toMatchObject({ code: "rotation_failed" });

      const pending = await keyring.get();
      const pendingKid = pending?.pending?.kid;
      expect(pending?.activeKid).toBe(migrated.record.activeKid);
      expect(pendingKid).toBeDefined();

      const rawNote = await base.notes.get(seeded.noteId);
      expect(parseTextEnvelope(rawNote?.content ?? "").body.kid).toBe(pendingKid);

      const rotated = await rotateWorkspaceKey({
        base,
        keyring,
        passphrase: PASSPHRASE,
        context: migrated.context,
        beforeCommit: async () => undefined,
      });

      expect(rotated.record.activeKid).toBe(pendingKid);
      expect(rotated.record.pending).toBeNull();
    } finally {
      await base.close();
    }
  });
});
