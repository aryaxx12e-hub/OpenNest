import { describe, expect, it } from "vitest";

import { createAppServices, type AppServices } from "@/lib/data/services";
import { createMemoryStorage, type IsoDate, type Workspace } from "@opennest/core";
import {
  createMemoryExtensionStore,
  type ExtensionHostRequest,
} from "@opennest/extensions";
import {
  createAuditLog,
  createCapabilityBroker,
  createGrantRegistry,
  createMemoryPrivacyStore,
  type CapabilityBroker,
  type GrantRegistry,
  type Principal,
} from "@opennest/privacy";

import {
  createExtensionHostApi,
  type ExtensionFileMetadata,
  type ExtensionHostApi,
  type ExtensionNote,
  type ExtensionNoteMetadata,
  type ExtensionPage,
  type ExtensionWorkspaceInfo,
  type ExtensionWorkspaceSummary,
} from "../host-api";

const NOW = Date.parse("2026-11-18T08:00:00.000Z");
const AT = "2026-11-18T08:00:00.000Z" as IsoDate;
const BLOB_KEY = "0f0f0f0f-1111-4222-8333-444444444444";
const EXTENSION_ID = "com.example.demo";
const PRINCIPAL: Principal = {
  id: `extension:${EXTENSION_ID}`,
  type: "extension",
  label: "Demo extension",
};

interface Fixture {
  api: ExtensionHostApi;
  services: AppServices;
  workspace: Workspace;
  broker: CapabilityBroker;
  grants: GrantRegistry;
  store: ReturnType<typeof createMemoryExtensionStore>;
  sessionId: string;
  noteId: string;
}

async function call<T>(api: ExtensionHostApi, request: ExtensionHostRequest): Promise<T> {
  return (await api.handle(request)) as T;
}

async function setup(): Promise<Fixture> {
  const storage = createMemoryStorage();
  const { services, workspace } = await createAppServices(storage, {
    defaultWorkspaceName: "My Library",
    clock: () => AT,
    generateBlobKey: () => BLOB_KEY,
  });
  const note = await services.note.create({
    workspaceId: workspace.id,
    folderId: null,
    title: "Private note",
    content: "Secret body",
  });
  const privacyStore = createMemoryPrivacyStore();
  const sessionId = "extension-session-1";
  let generated = 0;
  const generateId = () => `id-${++generated}`;
  const grants = createGrantRegistry({
    store: privacyStore.grants,
    now: () => NOW,
    generateId,
  });
  const audit = createAuditLog({
    store: privacyStore.audit,
    now: () => NOW,
    generateId,
  });
  const broker = createCapabilityBroker({
    principal: PRINCIPAL,
    sessionId,
    grants,
    audit,
    now: () => NOW,
    generateId,
  });
  const store = createMemoryExtensionStore();

  await grants.create({
    principalId: PRINCIPAL.id,
    capability: "workspace.read.metadata",
    scope: { kind: "workspace", workspaceId: workspace.id },
    purpose: "Read extension metadata",
    sessionOnly: true,
    sessionId,
  });

  const api = createExtensionHostApi({
    extensionId: EXTENSION_ID,
    extensionName: "Demo extension",
    workspace,
    services,
    broker,
    storage: store.storage,
    now: () => NOW,
  });

  return {
    api,
    services,
    workspace,
    broker,
    grants,
    store,
    sessionId,
    noteId: note.id,
  };
}

async function grantContent(fixture: Fixture): Promise<void> {
  await fixture.grants.create({
    principalId: PRINCIPAL.id,
    capability: "workspace.read.content",
    scope: { kind: "workspace", workspaceId: fixture.workspace.id },
    purpose: "Read extension note content",
    sessionOnly: true,
    sessionId: fixture.sessionId,
  });
}

describe("extension host API workspace", () => {
  it("returns workspace info and aggregate counts", async () => {
    const fixture = await setup();
    const info = await call<ExtensionWorkspaceInfo>(fixture.api, {
      id: "1",
      method: "workspace.getInfo",
      params: {},
    });
    const summary = await call<ExtensionWorkspaceSummary>(fixture.api, {
      id: "2",
      method: "workspace.summary",
      params: {},
    });

    expect(info).toEqual({
      id: fixture.workspace.id,
      name: "My Library",
      createdAt: AT,
      updatedAt: AT,
    });
    expect(summary).toEqual({ notes: 1, files: 0, folders: 0, tags: 0 });
  });

  it("lists note metadata without content and validates pagination", async () => {
    const fixture = await setup();
    const page = await call<ExtensionPage<ExtensionNoteMetadata>>(fixture.api, {
      id: "3",
      method: "workspace.listNotes",
      params: { limit: 5 },
    });

    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      id: fixture.noteId,
      title: "Private note",
      pinned: false,
    });
    expect(page.items[0]).not.toHaveProperty("content");

    await expect(
      fixture.api.handle({
        id: "4",
        method: "workspace.listNotes",
        params: { limit: 51 },
      })
    ).rejects.toMatchObject({ code: "invalid_params" });
    await expect(
      fixture.api.handle({
        id: "5",
        method: "workspace.listNotes",
        params: { limit: 0 },
      })
    ).rejects.toMatchObject({ code: "invalid_params" });
    await expect(
      fixture.api.handle({
        id: "6",
        method: "workspace.listNotes",
        params: { limit: 5, extra: true },
      })
    ).rejects.toMatchObject({ code: "invalid_params" });
  });

  it("lists file metadata without internal storage fields", async () => {
    const fixture = await setup();

    await fixture.services.file.create({
      workspaceId: fixture.workspace.id,
      folderId: null,
      name: "report.txt",
      mimeType: "text/plain",
      sizeBytes: 5,
      blobKey: BLOB_KEY,
      checksum: "a".repeat(64),
    });

    const page = await call<ExtensionPage<ExtensionFileMetadata>>(fixture.api, {
      id: "7",
      method: "workspace.listFiles",
      params: { limit: 50 },
    });

    expect(page.total).toBe(1);
    expect(page.items[0]).toEqual({
      id: expect.any(String),
      folderId: null,
      name: "report.txt",
      mimeType: "text/plain",
      sizeBytes: 5,
      createdAt: AT,
      updatedAt: AT,
    });
    expect(page.items[0]).not.toHaveProperty("blobKey");
    expect(page.items[0]).not.toHaveProperty("checksum");
    expect(page.items[0]).not.toHaveProperty("workspaceId");
  });

  it("requires the content grant and keeps reads inside the active workspace", async () => {
    const fixture = await setup();

    await expect(
      fixture.api.handle({
        id: "8",
        method: "workspace.readNote",
        params: { noteId: fixture.noteId },
      })
    ).rejects.toMatchObject({ code: "unknown_grant" });

    await grantContent(fixture);

    const note = await call<ExtensionNote>(fixture.api, {
      id: "9",
      method: "workspace.readNote",
      params: { noteId: fixture.noteId },
    });

    expect(note).toMatchObject({
      id: fixture.noteId,
      title: "Private note",
      content: "Secret body",
    });

    const other = await fixture.services.workspace.create("Other library");
    const otherNote = await fixture.services.note.create({
      workspaceId: other.id,
      folderId: null,
      title: "Other note",
      content: "Other body",
    });

    await expect(
      fixture.api.handle({
        id: "10",
        method: "workspace.readNote",
        params: { noteId: otherNote.id },
      })
    ).rejects.toMatchObject({ code: "invalid_params" });
  });
});

describe("extension host API storage", () => {
  it("stores values per extension and validates keys", async () => {
    const fixture = await setup();

    await fixture.api.handle({
      id: "11",
      method: "storage.set",
      params: { key: "count", value: "1" },
    });

    expect(
      await call<string | null>(fixture.api, {
        id: "12",
        method: "storage.get",
        params: { key: "count" },
      })
    ).toBe("1");
    expect(
      await call<string[]>(fixture.api, {
        id: "13",
        method: "storage.keys",
        params: {},
      })
    ).toEqual(["count"]);

    const otherApi = createExtensionHostApi({
      extensionId: "com.example.other",
      extensionName: "Other extension",
      workspace: fixture.workspace,
      services: fixture.services,
      broker: fixture.broker,
      storage: fixture.store.storage,
      now: () => NOW,
    });

    expect(
      await call<string | null>(otherApi, {
        id: "14",
        method: "storage.get",
        params: { key: "count" },
      })
    ).toBeNull();

    await otherApi.handle({
      id: "15",
      method: "storage.set",
      params: { key: "count", value: "9" },
    });

    expect(await fixture.store.storage.get(EXTENSION_ID, "count")).toBe("1");
    expect(await fixture.store.storage.get("com.example.other", "count")).toBe("9");

    await fixture.api.handle({
      id: "16",
      method: "storage.delete",
      params: { key: "count" },
    });

    expect(await fixture.store.storage.get(EXTENSION_ID, "count")).toBeNull();
    await expect(
      fixture.api.handle({
        id: "17",
        method: "storage.set",
        params: { key: "bad key", value: "x" },
      })
    ).rejects.toMatchObject({ code: "storage_key" });
  });
});
