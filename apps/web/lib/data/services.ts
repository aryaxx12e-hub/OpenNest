import {
  createFileService,
  createFolderService,
  createNoteService,
  createSearchService,
  createTagService,
  createWorkspaceService,
  type Clock,
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

export interface AppServices {
  workspace: WorkspaceService;
  folder: FolderService;
  file: FileService;
  note: NoteService;
  tag: TagService;
  search: SearchService;
}

export interface AppServicesResult {
  services: AppServices;
  workspace: Workspace;
}

export interface AppServiceOptions {
  defaultWorkspaceName: string;
  clock?: Clock;
  hash?: (data: Uint8Array) => Promise<string>;
  generateBlobKey?: () => string;
}

export function browserClock(): IsoDate {
  return new Date().toISOString() as IsoDate;
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(data));

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export function randomBlobKey(): string {
  return crypto.randomUUID().toLowerCase();
}

export async function createAppServices(
  storage: StorageAdapter,
  options: AppServiceOptions
): Promise<AppServicesResult> {
  const clock = options.clock ?? browserClock;
  const hash = options.hash ?? sha256Hex;
  const generateBlobKey = options.generateBlobKey ?? randomBlobKey;

  const services: AppServices = {
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
      generateBlobKey,
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

  const workspace = await services.workspace.ensure(options.defaultWorkspaceName);

  return { services, workspace };
}
