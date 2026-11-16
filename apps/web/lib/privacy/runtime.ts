import type { AppServices } from "../data/services";
import type {
  CapabilityBroker,
  GrantRegistry,
  PrivacyStore,
  Principal,
  ResourceScope,
  WorkspaceCapability,
} from "@opennest/privacy";
import {
  createAuditLog,
  createCapabilityBroker,
  createGrantRegistry,
} from "@opennest/privacy";
import type { StorageAdapter, Workspace } from "@opennest/core";

import type { DraftStorage } from "../autosave/draft-journal";
import { createDexiePrivacyStore } from "./dexie-store";
import { createDataControls, type DataControls } from "./data-controls";

export type BrokeredAppServices = AppServices;

export interface PrivacyRuntime {
  sessionId: string;
  principal: Principal;
  store: PrivacyStore;
  broker: CapabilityBroker;
  grants: GrantRegistry;
  audit: ReturnType<typeof createAuditLog>;
  data: DataControls;
  services: BrokeredAppServices;
  dispose(): Promise<void>;
}

export interface CreatePrivacyRuntimeInput {
  storage: StorageAdapter;
  services: AppServices;
  workspace: Workspace;
  drafts: DraftStorage;
  openPrivacyStore?: () => Promise<PrivacyStore>;
  now?: () => number;
  generateId?: () => string;
}

const BUILT_IN_PRINCIPAL: Principal = {
  id: "built-in:local",
  type: "built-in",
  label: "OpenNest",
};

function defaultGenerateId(): string {
  return crypto.randomUUID();
}

export async function createPrivacyRuntime(
  input: CreatePrivacyRuntimeInput
): Promise<PrivacyRuntime> {
  const now = input.now ?? (() => Date.now());
  const generateId = input.generateId ?? defaultGenerateId;
  const openPrivacyStore =
    input.openPrivacyStore ?? (() => Promise.resolve(createDexiePrivacyStore()));
  const store = await openPrivacyStore();

  await store.init();

  const sessionId = generateId();
  const grants = createGrantRegistry({
    store: store.grants,
    now,
    generateId,
  });
  const audit = createAuditLog({
    store: store.audit,
    now,
    generateId,
  });
  const broker = createCapabilityBroker({
    principal: BUILT_IN_PRINCIPAL,
    sessionId,
    grants,
    audit,
    now,
    generateId,
  });

  let currentWorkspace = input.workspace;

  async function reconcileBuiltIns(
    workspaceId: string,
    auditNewGrants: boolean
  ): Promise<void> {
    const before = new Set((await grants.list()).map((grant) => grant.id));
    const rows = await grants.ensureBuiltIns(workspaceId);

    if (!auditNewGrants) {
      return;
    }

    for (const grant of rows) {
      if (!before.has(grant.id)) {
        await audit.append({
          event: "grant.created",
          outcome: "info",
          principalId: grant.principalId,
          capability: grant.capability,
          reason: "built_in",
        });
      }
    }
  }

  await reconcileBuiltIns(currentWorkspace.id, true);

  const services = createBrokeredServices({
    services: input.services,
    broker,
    getWorkspace: () => currentWorkspace,
  });
  const data = createDataControls({
    storage: input.storage,
    drafts: input.drafts,
    workspaceName: currentWorkspace.name,
    broker,
    grants,
    audit,
    now,
    getWorkspace: () => currentWorkspace,
    setWorkspace: (workspace) => {
      currentWorkspace = workspace;
    },
    resetPrivacy: () => store.reset(),
    reconcileBuiltIns,
  });

  let disposed = false;

  return {
    sessionId,
    principal: BUILT_IN_PRINCIPAL,
    store,
    broker,
    grants,
    audit,
    data,
    services,
    async dispose() {
      if (disposed) {
        return;
      }

      disposed = true;

      try {
        await broker.endSession();
      } finally {
        await store.close();
      }
    },
  };
}

function workspaceScope(workspaceId: string): ResourceScope {
  return { kind: "workspace", workspaceId };
}

function folderScope(
  workspaceId: string,
  folderId: string,
  includeDescendants: boolean
): ResourceScope {
  return { kind: "folder", workspaceId, folderId, includeDescendants };
}

function notesScope(workspaceId: string, noteIds: readonly string[]): ResourceScope {
  return { kind: "notes", workspaceId, noteIds };
}

function filesScope(workspaceId: string, fileIds: readonly string[]): ResourceScope {
  return { kind: "files", workspaceId, fileIds };
}

function createBrokeredServices(input: {
  services: AppServices;
  broker: CapabilityBroker;
  getWorkspace: () => Workspace;
}): BrokeredAppServices {
  const { services, broker, getWorkspace } = input;

  async function run<T>(
    capability: WorkspaceCapability,
    scope: ResourceScope,
    purpose: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const handle = await broker.request({ capability, scope, purpose });

    return broker.invoke(handle, () => operation());
  }

  const workspaceId = () => getWorkspace().id;

  return {
    workspace: {
      ensure: (name) =>
        run(
          "workspace.write",
          workspaceScope(workspaceId()),
          "Ensure the local workspace",
          () => services.workspace.ensure(name)
        ),
      create: (name) =>
        run(
          "workspace.write",
          workspaceScope(workspaceId()),
          "Create a local workspace",
          () => services.workspace.create(name)
        ),
      rename: (id, name) =>
        run("workspace.write", workspaceScope(id), "Rename the local workspace", () =>
          services.workspace.rename(id, name)
        ),
      get: (id) =>
        run(
          "workspace.read.metadata",
          workspaceScope(id),
          "Read workspace metadata",
          () => services.workspace.get(id)
        ),
      list: () =>
        run(
          "workspace.read.metadata",
          workspaceScope(workspaceId()),
          "List local workspaces",
          () => services.workspace.list()
        ),
      delete: (id) =>
        run("workspace.delete", workspaceScope(id), "Delete a local workspace", () =>
          services.workspace.delete(id)
        ),
    },
    folder: {
      create: (folder) =>
        run(
          "workspace.write",
          workspaceScope(folder.workspaceId),
          "Create a local folder",
          () => services.folder.create(folder)
        ),
      rename: (id, name) =>
        run(
          "workspace.write",
          folderScope(workspaceId(), id, true),
          "Rename a local folder",
          () => services.folder.rename(id, name)
        ),
      move: (id, parentId) =>
        run(
          "workspace.write",
          folderScope(workspaceId(), id, true),
          "Move a local folder",
          () => services.folder.move(id, parentId)
        ),
      get: (id) =>
        run(
          "workspace.read.metadata",
          folderScope(workspaceId(), id, false),
          "Read folder metadata",
          () => services.folder.get(id)
        ),
      list: (workspace, options) =>
        run(
          "workspace.read.metadata",
          workspaceScope(workspace),
          "List local folders",
          () => services.folder.list(workspace, options)
        ),
      children: (workspace, parentId) =>
        run(
          "workspace.read.metadata",
          workspaceScope(workspace),
          "List folder children",
          () => services.folder.children(workspace, parentId)
        ),
      ancestors: (id) =>
        run(
          "workspace.read.metadata",
          folderScope(workspaceId(), id, false),
          "Read folder ancestors",
          () => services.folder.ancestors(id)
        ),
      descendants: (id) =>
        run(
          "workspace.read.metadata",
          folderScope(workspaceId(), id, true),
          "Read folder descendants",
          () => services.folder.descendants(id)
        ),
      delete: (id) =>
        run(
          "workspace.delete",
          folderScope(workspaceId(), id, true),
          "Delete a local folder",
          () => services.folder.delete(id)
        ),
    },
    file: {
      create: (file) =>
        run(
          "workspace.write",
          workspaceScope(file.workspaceId),
          "Create a local file record",
          () => services.file.create(file)
        ),
      upload: (file) =>
        run(
          "workspace.write",
          workspaceScope(file.workspaceId),
          "Upload a local file",
          () => services.file.upload(file)
        ),
      update: (id, patch) =>
        run(
          "workspace.write",
          filesScope(workspaceId(), [id]),
          "Update a local file",
          () => services.file.update(id, patch)
        ),
      get: (id) =>
        run(
          "workspace.read.metadata",
          filesScope(workspaceId(), [id]),
          "Read file metadata",
          () => services.file.get(id)
        ),
      list: (workspace, filter, options) =>
        run(
          "workspace.read.metadata",
          workspaceScope(workspace),
          "List local files",
          () => services.file.list(workspace, filter, options)
        ),
      setTags: (id, tagIds) =>
        run("workspace.write", filesScope(workspaceId(), [id]), "Update file tags", () =>
          services.file.setTags(id, tagIds)
        ),
      tags: (id) =>
        run(
          "workspace.read.metadata",
          filesScope(workspaceId(), [id]),
          "Read file tags",
          () => services.file.tags(id)
        ),
      delete: (id) =>
        run(
          "workspace.delete",
          filesScope(workspaceId(), [id]),
          "Delete a local file",
          () => services.file.delete(id)
        ),
    },
    note: {
      create: (note) =>
        run(
          "workspace.write",
          workspaceScope(note.workspaceId),
          "Create a local note",
          () => services.note.create(note)
        ),
      update: (id, patch) =>
        run(
          "workspace.write",
          notesScope(workspaceId(), [id]),
          "Update a local note",
          () => services.note.update(id, patch)
        ),
      get: (id) =>
        run(
          "workspace.read.content",
          notesScope(workspaceId(), [id]),
          "Read a local note",
          () => services.note.get(id)
        ),
      list: (workspace, filter, options) =>
        run("workspace.read.content", workspaceScope(workspace), "List local notes", () =>
          services.note.list(workspace, filter, options)
        ),
      setTags: (id, tagIds) =>
        run("workspace.write", notesScope(workspaceId(), [id]), "Update note tags", () =>
          services.note.setTags(id, tagIds)
        ),
      tags: (id) =>
        run(
          "workspace.read.metadata",
          notesScope(workspaceId(), [id]),
          "Read note tags",
          () => services.note.tags(id)
        ),
      setLinks: (id, targetIds) =>
        run("workspace.write", notesScope(workspaceId(), [id]), "Update note links", () =>
          services.note.setLinks(id, targetIds)
        ),
      links: (id) =>
        run(
          "workspace.read.metadata",
          notesScope(workspaceId(), [id]),
          "Read note links",
          () => services.note.links(id)
        ),
      delete: (id) =>
        run(
          "workspace.delete",
          notesScope(workspaceId(), [id]),
          "Delete a local note",
          () => services.note.delete(id)
        ),
    },
    tag: {
      create: (tag) =>
        run(
          "workspace.write",
          workspaceScope(tag.workspaceId),
          "Create a local tag",
          () => services.tag.create(tag)
        ),
      update: (id, patch) =>
        run("workspace.write", workspaceScope(workspaceId()), "Update a local tag", () =>
          services.tag.update(id, patch)
        ),
      get: (id) =>
        run(
          "workspace.read.metadata",
          workspaceScope(workspaceId()),
          "Read tag metadata",
          () => services.tag.get(id)
        ),
      list: (workspace, options) =>
        run("workspace.read.metadata", workspaceScope(workspace), "List local tags", () =>
          services.tag.list(workspace, options)
        ),
      findByName: (workspace, name) =>
        run(
          "workspace.read.metadata",
          workspaceScope(workspace),
          "Find a local tag",
          () => services.tag.findByName(workspace, name)
        ),
      delete: (id) =>
        run("workspace.delete", workspaceScope(workspaceId()), "Delete a local tag", () =>
          services.tag.delete(id)
        ),
    },
    search: {
      search: (query) =>
        run(
          "workspace.read.content",
          workspaceScope(query.workspaceId),
          "Search local content",
          () => services.search.search(query)
        ),
      reindexAll: (workspace) =>
        run("workspace.write", workspaceScope(workspace), "Reindex local content", () =>
          services.search.reindexAll(workspace)
        ),
    },
  };
}
