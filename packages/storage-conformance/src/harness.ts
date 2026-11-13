import {
  createFileService,
  createFolderService,
  createNoteService,
  createSearchService,
  createTagService,
  createWorkspaceService,
  idGenerator,
  tickingClock,
  type FileService,
  type FolderService,
  type IsoDate,
  type NoteService,
  type SearchService,
  type StorageAdapter,
  type TagService,
  type Workspace,
  type WorkspaceService,
} from "@opennest/core";

export interface HarnessServices {
  workspace: WorkspaceService;
  folder: FolderService;
  file: FileService;
  note: NoteService;
  tag: TagService;
  search: SearchService;
}

export interface Harness {
  storage: StorageAdapter;
  services: HarnessServices;
  workspace: Workspace;
  clock: () => IsoDate;
}

const hash = async (data: Uint8Array): Promise<string> =>
  data.byteLength.toString(16).padStart(64, "0");

export async function openHarness(
  create: (name?: string) => Promise<StorageAdapter>
): Promise<Harness> {
  const storage = await create();
  await storage.init();

  const clock = tickingClock("2026-11-12T00:00:00.000Z", 1000);
  const nextBlobKey = idGenerator(4242);

  const services: HarnessServices = {
    workspace: createWorkspaceService({
      workspaces: storage.workspaces,
      files: storage.files,
      blobs: storage.blobs,
      clock,
    }),
    folder: createFolderService({
      folders: storage.folders,
      workspaces: storage.workspaces,
      clock,
    }),
    file: createFileService({
      files: storage.files,
      folders: storage.folders,
      workspaces: storage.workspaces,
      blobs: storage.blobs,
      tags: storage.tags,
      clock,
      hash,
      generateBlobKey: nextBlobKey,
    }),
    note: createNoteService({
      notes: storage.notes,
      folders: storage.folders,
      tags: storage.tags,
      workspaces: storage.workspaces,
      clock,
    }),
    tag: createTagService({
      tags: storage.tags,
      workspaces: storage.workspaces,
      clock,
    }),
    search: createSearchService({ search: storage.search }),
  };

  const workspace = await services.workspace.ensure();

  return { storage, services, workspace, clock };
}

export async function withHarness<T>(
  create: (name?: string) => Promise<StorageAdapter>,
  run: (harness: Harness) => Promise<T>
): Promise<T> {
  const harness = await openHarness(create);

  try {
    return await run(harness);
  } finally {
    await harness.storage.close();
  }
}
