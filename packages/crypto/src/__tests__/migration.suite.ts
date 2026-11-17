import { describe, expect, it } from "vitest";

import type {
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
import { generateId } from "@opennest/core";

import {
  createEncryptedStorage,
  createKeyring,
  createMemoryKeyringStore,
  type MigrationDraftRecord,
  type MigrationDraftStore,
  type WorkspaceCryptoContext,
} from "../index";
import {
  cancelEncryptionBeforeCommit,
  enableEncryption,
  resumeEncryption,
} from "../migration";

const AT = "2026-11-17T00:00:00.000Z" as IsoDate;
const PASSPHRASE = "a long migration passphrase";

export interface MigrationHarness {
  base: StorageAdapter;
  workspace: Workspace;
  cleanup(): Promise<void>;
}

export type CreateMigrationHarness = () => Promise<MigrationHarness>;

interface TestDraft extends MigrationDraftRecord {
  version: 1;
  title: string;
  content: string;
  baseTitle?: string;
  baseContent?: string;
  baseUpdatedAt: string;
  savedAt: number;
}

interface DraftFaults {
  failPutAfter: number | null;
  failRemoveAfter: number | null;
}

interface TestDraftStore {
  store: MigrationDraftStore<TestDraft>;
  records: Map<string, TestDraft>;
  faults: DraftFaults;
}

interface SeedResult {
  folderId: FolderId;
  tagId: TagId;
  fileId: FileId;
  blobKey: BlobKey;
  noteId: NoteId;
  linkedNoteId: NoteId;
  drafts: TestDraft[];
}

function draftKey(workspaceId: string, noteId: string): string {
  return `${workspaceId}:${noteId}`;
}

function cloneDraft(draft: TestDraft): TestDraft {
  return JSON.parse(JSON.stringify(draft)) as TestDraft;
}

function createTestDraftStore(initial: TestDraft[] = []): TestDraftStore {
  const records = new Map(
    initial.map((draft) => [draftKey(draft.workspaceId, draft.noteId), cloneDraft(draft)])
  );
  const faults: DraftFaults = { failPutAfter: null, failRemoveAfter: null };
  let puts = 0;
  let removes = 0;

  const store: MigrationDraftStore<TestDraft> = {
    async list() {
      return [...records.values()].map(cloneDraft);
    },
    async get(workspaceId, noteId) {
      const draft = records.get(draftKey(workspaceId, noteId));
      return draft === undefined ? null : cloneDraft(draft);
    },
    async put(draft) {
      if (faults.failPutAfter !== null && puts >= faults.failPutAfter) {
        throw new Error("draft copy failed");
      }

      puts += 1;
      records.set(draftKey(draft.workspaceId, draft.noteId), cloneDraft(draft));
    },
    async remove(workspaceId, noteId) {
      if (faults.failRemoveAfter !== null && removes >= faults.failRemoveAfter) {
        throw new Error("draft cleanup failed");
      }

      removes += 1;
      records.delete(draftKey(workspaceId, noteId));
    },
  };

  return { store, records, faults };
}

function proxyBase(
  base: StorageAdapter,
  hooks: {
    failNotesListOnce?: () => boolean;
    failRestoreOnce?: () => boolean;
    failPurgeOnce?: () => boolean;
  }
): StorageAdapter {
  return new Proxy(base, {
    get(target, property, receiver) {
      if (property === "restore") {
        return async (snapshot: Parameters<StorageAdapter["restore"]>[0]) => {
          if (hooks.failRestoreOnce?.() === true) {
            throw new Error("restore failed");
          }

          return target.restore(snapshot);
        };
      }

      if (property === "notes") {
        const notes = target.notes;

        return new Proxy(notes, {
          get(noteTarget, noteProperty) {
            if (noteProperty === "list") {
              return async (...args: Parameters<typeof notes.list>) => {
                if (hooks.failNotesListOnce?.() === true) {
                  throw new Error("snapshot build failed");
                }

                return notes.list(...args);
              };
            }

            const value = Reflect.get(noteTarget, noteProperty, noteTarget);

            return typeof value === "function" ? value.bind(noteTarget) : value;
          },
        });
      }

      if (property === "blobs") {
        const blobs = target.blobs;

        return new Proxy(blobs, {
          get(blobTarget, blobProperty) {
            if (blobProperty === "purgeOrphans") {
              return async (knownKeys: BlobKey[]) => {
                if (hooks.failPurgeOnce?.() === true) {
                  throw new Error("blob purge failed");
                }

                return blobs.purgeOrphans(knownKeys);
              };
            }

            const value = Reflect.get(blobTarget, blobProperty, blobTarget);

            return typeof value === "function" ? value.bind(blobTarget) : value;
          },
        });
      }

      const value = Reflect.get(target, property, receiver);

      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function once(): () => boolean {
  let fired = false;

  return () => {
    if (fired) {
      return false;
    }

    fired = true;
    return true;
  };
}

async function seed(base: StorageAdapter, workspace: Workspace): Promise<SeedResult> {
  const folder = await base.folders.create({
    workspaceId: workspace.id,
    parentId: null,
    name: "Arsip",
    at: AT,
  });
  const tag = await base.tags.create({
    workspaceId: workspace.id,
    name: "Penting",
    color: "#336699",
    at: AT,
  });
  const blobKey = generateId() as BlobKey;
  await base.blobs.put(
    blobKey,
    new Blob([new TextEncoder().encode("isi lampiran rahasia")], {
      type: "text/plain",
    })
  );
  const file = await base.files.create({
    workspaceId: workspace.id,
    folderId: folder.id,
    name: "lampiran.txt",
    mimeType: "text/plain",
    sizeBytes: 20,
    blobKey,
    checksum: "a".repeat(64),
    at: AT,
  });
  const note = await base.notes.create({
    workspaceId: workspace.id,
    folderId: folder.id,
    title: "Catatan utama",
    content: "isi catatan rahasia",
    pinned: true,
    at: AT,
  });
  const linkedNote = await base.notes.create({
    workspaceId: workspace.id,
    folderId: null,
    title: "Catatan tautan",
    content: "isi tautan",
    at: AT,
  });
  await base.notes.setTags(note.id, [tag.id]);
  await base.files.setTags(file.id, [tag.id]);
  await base.notes.setLinks(note.id, [linkedNote.id]);

  return {
    folderId: folder.id,
    tagId: tag.id,
    fileId: file.id,
    blobKey,
    noteId: note.id,
    linkedNoteId: linkedNote.id,
    drafts: [
      {
        version: 1,
        workspaceId: workspace.id,
        noteId: note.id,
        title: "Draf utama",
        content: "isi draf utama",
        baseTitle: "Catatan utama",
        baseContent: "isi catatan rahasia",
        baseUpdatedAt: AT,
        savedAt: 1_700_000_000_000,
      },
      {
        version: 1,
        workspaceId: workspace.id,
        noteId: linkedNote.id,
        title: "Draf tautan",
        content: "isi draf tautan",
        baseUpdatedAt: AT,
        savedAt: 1_700_000_000_001,
      },
    ],
  };
}

function setupKeyring(workspaceId: WorkspaceId) {
  return createKeyring({
    store: createMemoryKeyringStore(),
    workspaceId,
    now: () => 1_700_000_000_000,
  });
}

async function blobBytes(blob: Blob | null): Promise<Uint8Array> {
  if (blob === null) {
    throw new Error("Blob is missing");
  }

  return new Uint8Array(await blob.arrayBuffer());
}

async function assertEncryptedWorkspace(
  base: StorageAdapter,
  seeded: SeedResult,
  context: WorkspaceCryptoContext
): Promise<void> {
  const rawNote = await base.notes.get(seeded.noteId);
  const rawFile = await base.files.get(seeded.fileId);

  expect(rawNote?.content.startsWith("enc1:")).toBe(true);
  expect(rawNote?.title).toBe("Catatan utama");
  expect(rawFile?.blobKey).not.toBe(seeded.blobKey);
  expect(await base.blobs.has(seeded.blobKey)).toBe(false);

  const rawBlob = await blobBytes(
    rawFile === null ? null : await base.blobs.get(rawFile.blobKey)
  );
  expect([...rawBlob.slice(0, 4)]).toEqual([0x4f, 0x4e, 0x42, 0x31]);

  const storage = createEncryptedStorage({ base, context });
  const note = await storage.notes.get(seeded.noteId);
  const linked = await storage.notes.get(seeded.linkedNoteId);

  expect(note?.content).toBe("isi catatan rahasia");
  expect(linked?.content).toBe("isi tautan");
  expect(
    (await storage.notes.links(seeded.noteId)).map((link) => link.targetNoteId)
  ).toEqual([seeded.linkedNoteId]);
  expect((await storage.notes.tags(seeded.noteId)).map((tag) => tag.id)).toEqual([
    seeded.tagId,
  ]);
  expect((await storage.files.tags(seeded.fileId)).map((tag) => tag.id)).toEqual([
    seeded.tagId,
  ]);
  expect((await storage.folders.get(seeded.folderId))?.name).toBe("Arsip");

  const file = await storage.files.get(seeded.fileId);
  const bytes = await blobBytes(
    file === null ? null : await storage.blobs.get(file.blobKey)
  );

  expect(new TextDecoder().decode(bytes)).toBe("isi lampiran rahasia");
}

async function assertPlaintextWorkspace(
  base: StorageAdapter,
  seeded: SeedResult
): Promise<void> {
  const note = await base.notes.get(seeded.noteId);
  const file = await base.files.get(seeded.fileId);

  expect(note?.content).toBe("isi catatan rahasia");
  expect(file?.blobKey).toBe(seeded.blobKey);
  const bytes = await blobBytes(
    file === null ? null : await base.blobs.get(file.blobKey)
  );
  expect(new TextDecoder().decode(bytes)).toBe("isi lampiran rahasia");
}

export function runMigrationSuite(
  label: string,
  createHarness: CreateMigrationHarness
): void {
  describe(`plaintext migration (${label})`, () => {
    it("encrypts notes, blobs, relations, and drafts into an active keyring", async () => {
      const harness = await createHarness();

      try {
        const seeded = await seed(harness.base, harness.workspace);
        const drafts = {
          plaintext: createTestDraftStore(seeded.drafts),
          encrypted: createTestDraftStore(),
        };
        const keyring = setupKeyring(harness.workspace.id);
        let recoveryKey = "";

        const result = await enableEncryption({
          base: harness.base,
          keyring,
          passphrase: PASSPHRASE,
          drafts: {
            plaintext: drafts.plaintext.store,
            encrypted: drafts.encrypted.store,
          },
          onRecoveryKey: (key) => {
            recoveryKey = key;
          },
        });

        expect(result.recoveryKey).toMatch(/^ONRK1-/);
        expect(recoveryKey).toBe(result.recoveryKey);
        expect(result.record.state).toBe("active");
        expect(await keyring.get()).toMatchObject({ state: "active" });
        await expect(keyring.unlock(PASSPHRASE)).resolves.toBeDefined();
        await expect(
          keyring.unlockWithRecoveryKey(result.recoveryKey)
        ).resolves.toBeDefined();

        await assertEncryptedWorkspace(harness.base, seeded, result.context);
        expect(await drafts.plaintext.store.list()).toEqual([]);
        expect(
          (await drafts.encrypted.store.list()).sort((left, right) =>
            left.noteId.localeCompare(right.noteId)
          )
        ).toEqual(
          [...seeded.drafts].sort((left, right) =>
            left.noteId.localeCompare(right.noteId)
          )
        );
        expect(drafts.plaintext.records.size).toBe(0);
      } finally {
        await harness.cleanup();
      }
    });

    it("resumes a preparing migration after snapshot build fails", async () => {
      const harness = await createHarness();

      try {
        const seeded = await seed(harness.base, harness.workspace);
        const drafts = {
          plaintext: createTestDraftStore(seeded.drafts),
          encrypted: createTestDraftStore(),
        };
        const keyring = setupKeyring(harness.workspace.id);
        let noteListCalls = 0;
        const base = proxyBase(harness.base, {
          failNotesListOnce: () => {
            noteListCalls += 1;
            return noteListCalls === 2;
          },
        });

        await expect(
          enableEncryption({
            base,
            keyring,
            passphrase: PASSPHRASE,
            drafts: {
              plaintext: drafts.plaintext.store,
              encrypted: drafts.encrypted.store,
            },
          })
        ).rejects.toMatchObject({ code: "migration_failed" });

        expect((await keyring.get())?.state).toBe("preparing");
        await assertPlaintextWorkspace(harness.base, seeded);
        expect(await drafts.plaintext.store.list()).toHaveLength(2);
        expect(await drafts.encrypted.store.list()).toHaveLength(2);

        const context = await keyring.unlock(PASSPHRASE);
        const record = await resumeEncryption({
          base,
          keyring,
          context,
          drafts: {
            plaintext: drafts.plaintext.store,
            encrypted: drafts.encrypted.store,
          },
        });

        expect(record.state).toBe("active");
        await assertEncryptedWorkspace(harness.base, seeded, context);
        expect(await drafts.plaintext.store.list()).toEqual([]);
        expect(await drafts.encrypted.store.list()).toHaveLength(2);
      } finally {
        await harness.cleanup();
      }
    });

    it("cancels before commit and removes partial encrypted drafts", async () => {
      const harness = await createHarness();

      try {
        const seeded = await seed(harness.base, harness.workspace);
        const drafts = {
          plaintext: createTestDraftStore(seeded.drafts),
          encrypted: createTestDraftStore(),
        };
        drafts.encrypted.faults.failPutAfter = 1;
        const keyring = setupKeyring(harness.workspace.id);

        await expect(
          enableEncryption({
            base: harness.base,
            keyring,
            passphrase: PASSPHRASE,
            drafts: {
              plaintext: drafts.plaintext.store,
              encrypted: drafts.encrypted.store,
            },
          })
        ).rejects.toMatchObject({ code: "migration_failed" });

        expect((await keyring.get())?.state).toBe("preparing");
        expect(await drafts.encrypted.store.list()).toHaveLength(1);
        await assertPlaintextWorkspace(harness.base, seeded);

        await cancelEncryptionBeforeCommit({
          base: harness.base,
          keyring,
          context: await keyring.unlock(PASSPHRASE),
          drafts: {
            plaintext: drafts.plaintext.store,
            encrypted: drafts.encrypted.store,
          },
        });

        expect(await keyring.get()).toBeNull();
        expect(await drafts.encrypted.store.list()).toEqual([]);
        expect(await drafts.plaintext.store.list()).toHaveLength(2);
        await assertPlaintextWorkspace(harness.base, seeded);
      } finally {
        await harness.cleanup();
      }
    });

    it("resumes a committing migration after restore fails", async () => {
      const harness = await createHarness();

      try {
        const seeded = await seed(harness.base, harness.workspace);
        const drafts = {
          plaintext: createTestDraftStore(seeded.drafts),
          encrypted: createTestDraftStore(),
        };
        const keyring = setupKeyring(harness.workspace.id);
        const base = proxyBase(harness.base, { failRestoreOnce: once() });

        await expect(
          enableEncryption({
            base,
            keyring,
            passphrase: PASSPHRASE,
            drafts: {
              plaintext: drafts.plaintext.store,
              encrypted: drafts.encrypted.store,
            },
          })
        ).rejects.toMatchObject({ code: "migration_failed" });

        expect((await keyring.get())?.state).toBe("committing");
        await assertPlaintextWorkspace(harness.base, seeded);
        expect(await drafts.plaintext.store.list()).toHaveLength(2);
        expect(await drafts.encrypted.store.list()).toHaveLength(2);

        const context = await keyring.unlock(PASSPHRASE);
        const record = await resumeEncryption({
          base,
          keyring,
          context,
          drafts: {
            plaintext: drafts.plaintext.store,
            encrypted: drafts.encrypted.store,
          },
        });

        expect(record.state).toBe("active");
        await assertEncryptedWorkspace(harness.base, seeded, context);
        expect(await drafts.plaintext.store.list()).toEqual([]);
      } finally {
        await harness.cleanup();
      }
    });

    it("cancels a committing migration when the plaintext base is unchanged", async () => {
      const harness = await createHarness();

      try {
        const seeded = await seed(harness.base, harness.workspace);
        const drafts = {
          plaintext: createTestDraftStore(seeded.drafts),
          encrypted: createTestDraftStore(),
        };
        const keyring = setupKeyring(harness.workspace.id);
        const base = proxyBase(harness.base, { failRestoreOnce: once() });

        await expect(
          enableEncryption({
            base,
            keyring,
            passphrase: PASSPHRASE,
            drafts: {
              plaintext: drafts.plaintext.store,
              encrypted: drafts.encrypted.store,
            },
          })
        ).rejects.toMatchObject({ code: "migration_failed" });

        await cancelEncryptionBeforeCommit({
          base,
          keyring,
          context: await keyring.unlock(PASSPHRASE),
          drafts: {
            plaintext: drafts.plaintext.store,
            encrypted: drafts.encrypted.store,
          },
        });

        expect(await keyring.get()).toBeNull();
        expect(await drafts.encrypted.store.list()).toEqual([]);
        await assertPlaintextWorkspace(harness.base, seeded);
      } finally {
        await harness.cleanup();
      }
    });

    it("resumes cleanup after removing a plaintext draft fails", async () => {
      const harness = await createHarness();

      try {
        const seeded = await seed(harness.base, harness.workspace);
        const drafts = {
          plaintext: createTestDraftStore(seeded.drafts),
          encrypted: createTestDraftStore(),
        };
        drafts.plaintext.faults.failRemoveAfter = 1;
        const keyring = setupKeyring(harness.workspace.id);

        await expect(
          enableEncryption({
            base: harness.base,
            keyring,
            passphrase: PASSPHRASE,
            drafts: {
              plaintext: drafts.plaintext.store,
              encrypted: drafts.encrypted.store,
            },
          })
        ).rejects.toMatchObject({ code: "migration_failed" });

        expect((await keyring.get())?.state).toBe("cleanup");
        expect(await drafts.plaintext.store.list()).toHaveLength(1);
        const context = await keyring.unlock(PASSPHRASE);
        await assertEncryptedWorkspace(harness.base, seeded, context);

        drafts.plaintext.faults.failRemoveAfter = null;
        const record = await resumeEncryption({
          base: harness.base,
          keyring,
          context,
          drafts: {
            plaintext: drafts.plaintext.store,
            encrypted: drafts.encrypted.store,
          },
        });

        expect(record.state).toBe("active");
        expect(await drafts.plaintext.store.list()).toEqual([]);
      } finally {
        await harness.cleanup();
      }
    });

    it("resumes cleanup after purging old blobs fails", async () => {
      const harness = await createHarness();

      try {
        const seeded = await seed(harness.base, harness.workspace);
        const keyring = setupKeyring(harness.workspace.id);
        const base = proxyBase(harness.base, { failPurgeOnce: once() });

        await expect(
          enableEncryption({
            base,
            keyring,
            passphrase: PASSPHRASE,
          })
        ).rejects.toMatchObject({ code: "migration_failed" });

        expect((await keyring.get())?.state).toBe("cleanup");
        const context = await keyring.unlock(PASSPHRASE);
        await assertEncryptedWorkspace(harness.base, seeded, context);

        const record = await resumeEncryption({ base, keyring, context });
        expect(record.state).toBe("active");
      } finally {
        await harness.cleanup();
      }
    });

    it("resumes a committing keyring whose base is already encrypted", async () => {
      const harness = await createHarness();

      try {
        const seeded = await seed(harness.base, harness.workspace);
        const keyring = setupKeyring(harness.workspace.id);
        const result = await enableEncryption({
          base: harness.base,
          keyring,
          passphrase: PASSPHRASE,
        });

        await keyring.setState("committing");
        const record = await resumeEncryption({
          base: harness.base,
          keyring,
          context: result.context,
        });

        expect(record.state).toBe("active");
        await assertEncryptedWorkspace(harness.base, seeded, result.context);
        await expect(
          cancelEncryptionBeforeCommit({
            base: harness.base,
            keyring,
            context: result.context,
          })
        ).rejects.toMatchObject({ code: "migration_state" });
      } finally {
        await harness.cleanup();
      }
    });
  });
}
