import { beforeEach, describe, expect, it } from "vitest";

import {
  createMemoryStorage,
  type BackupSnapshot,
  type IsoDate,
  type Workspace,
  type WorkspaceId,
} from "@opennest/core";
import { createMemoryPrivacyStore, createSequenceIds } from "@opennest/privacy";

import { readDraftJournal, writeNoteDraft } from "@/lib/autosave/draft-journal";
import { createAppServices, sha256Hex } from "@/lib/data/services";

import { createPrivacyRuntime, type PrivacyRuntime } from "../runtime";

const NOW = Date.parse("2026-11-15T08:00:00.000Z");
const AT = "2026-11-15T08:00:00.000Z" as IsoDate;

interface RuntimeFixture {
  runtime: PrivacyRuntime;
  workspace: Workspace;
  storage: ReturnType<typeof createMemoryStorage>;
}

async function setup(): Promise<RuntimeFixture> {
  const storage = createMemoryStorage();
  const { services, workspace } = await createAppServices(storage, {
    defaultWorkspaceName: "My Library",
    clock: () => AT,
    hash: sha256Hex,
    generateBlobKey: () => "22222222-2222-4222-8222-222222222222",
  });
  const openPrivacyStore = async () => {
    const store = createMemoryPrivacyStore();
    await store.init();
    return store;
  };
  const runtime = await createPrivacyRuntime({
    storage,
    services,
    workspace,
    drafts: window.localStorage,
    openPrivacyStore,
    now: () => NOW,
    generateId: createSequenceIds("control"),
  });

  return { runtime, workspace, storage };
}

function snapshotForWorkspace(workspaceId: string): BackupSnapshot {
  return {
    snapshotVersion: 1,
    schemaVersion: 1,
    kind: "dexie",
    createdAt: AT,
    workspace: {
      id: workspaceId as WorkspaceId,
      name: "Restored Library",
      createdAt: AT,
      updatedAt: AT,
    },
    folders: [],
    files: [],
    notes: [],
    tags: [],
    fileTags: [],
    noteTags: [],
    noteLinks: [],
    blobs: [],
  };
}

function seedDraft(workspace: Workspace, noteId: string) {
  writeNoteDraft(window.localStorage, {
    version: 1,
    workspaceId: workspace.id,
    noteId,
    title: "Draft",
    content: "unsaved",
    baseUpdatedAt: AT,
    savedAt: NOW,
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("privacy data controls", () => {
  it("reports storage bytes, item counts, grants, audit, and drafts", async () => {
    const { runtime, workspace } = await setup();
    await runtime.services.note.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Note",
      content: "hello",
    });
    await runtime.services.file.upload({
      workspaceId: workspace.id,
      folderId: null,
      name: "hello.txt",
      mimeType: "text/plain",
      data: new TextEncoder().encode("hello"),
    });
    seedDraft(workspace, "note-1");

    const overview = await runtime.data.overview();

    expect(overview.notes).toBe(1);
    expect(overview.files).toBe(1);
    expect(overview.bytes).toBeGreaterThan(0);
    expect(overview.grants).toBe(5);
    expect(overview.auditEntries).toBeGreaterThan(0);
    expect(overview.drafts).toBe(1);
    await runtime.dispose();
  });

  it("exports through the broker and audits the summary", async () => {
    const { runtime, workspace } = await setup();
    await runtime.services.note.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Export me",
      content: "hello",
    });

    const built = await runtime.data.exportAll();
    const audit = await runtime.audit.list();

    expect(built.text).toContain(workspace.id);
    expect(built.summary.notes).toBe(1);
    expect(audit.some((entry) => entry.event === "data.exported")).toBe(true);
    await runtime.dispose();
  });

  it("clears drafts first and leaves a clean workspace after delete all", async () => {
    const { runtime, workspace, storage } = await setup();
    const note = await runtime.services.note.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Delete me",
    });
    seedDraft(workspace, note.id);

    await runtime.data.deleteAll();

    const journal = readDraftJournal(window.localStorage);
    const workspaces = await storage.workspaces.list();
    const grants = await runtime.grants.list();

    expect(journal.ok && journal.drafts).toEqual([]);
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]?.id).not.toBe(workspace.id);
    expect(grants).toHaveLength(5);
    expect(
      grants.every(
        (grant) =>
          grant.scope.kind === "workspace" &&
          grant.scope.workspaceId === workspaces[0]?.id
      )
    ).toBe(true);
    expect(await runtime.audit.list()).toEqual([]);
    await runtime.dispose();
  });

  it("clears drafts and reconciles grants after restore", async () => {
    const { runtime, workspace } = await setup();
    seedDraft(workspace, "note-1");

    await runtime.data.restore(snapshotForWorkspace("w2"));

    const journal = readDraftJournal(window.localStorage);
    const grants = await runtime.grants.list();
    const audit = await runtime.audit.list();

    expect(journal.ok && journal.drafts).toEqual([]);
    expect(
      grants.every(
        (grant) => grant.scope.kind === "workspace" && grant.scope.workspaceId === "w2"
      )
    ).toBe(true);
    expect(audit.some((entry) => entry.event === "data.restored")).toBe(true);
    await runtime.dispose();
  });
});
