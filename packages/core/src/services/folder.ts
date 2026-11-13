import { assertNoFolderCycle } from "../checks";
import { ConstraintError, NotFoundError } from "../errors";
import type { Folder } from "../domain";
import type { FolderId, WorkspaceId } from "../ids";
import type { FolderRepository, ListOptions, Page, WorkspaceRepository } from "../ports";
import { validateDisplayName } from "../rules";
import type { Clock } from "./clock";
import { requireWorkspace } from "./require";

export interface FolderService {
  create(input: {
    workspaceId: WorkspaceId;
    parentId: FolderId | null;
    name: string;
  }): Promise<Folder>;
  rename(id: FolderId, name: string): Promise<Folder>;
  move(id: FolderId, parentId: FolderId | null): Promise<Folder>;
  get(id: FolderId): Promise<Folder | null>;
  list(workspaceId: WorkspaceId, options?: ListOptions): Promise<Page<Folder>>;
  children(workspaceId: WorkspaceId, parentId: FolderId | null): Promise<Folder[]>;
  ancestors(id: FolderId): Promise<Folder[]>;
  descendants(id: FolderId): Promise<Folder[]>;
  delete(id: FolderId): Promise<void>;
}

export function createFolderService(deps: {
  folders: FolderRepository;
  workspaces: WorkspaceRepository;
  clock: Clock;
}): FolderService {
  const { folders, workspaces, clock } = deps;

  async function checkParent(
    workspaceId: WorkspaceId,
    parentId: FolderId | null,
    movingId?: FolderId
  ): Promise<void> {
    if (parentId === null) {
      return;
    }

    await requireWorkspace(workspaces, workspaceId);

    const parent = await folders.get(parentId);

    if (parent === null) {
      throw new NotFoundError("Parent folder does not exist.");
    }

    if (parent.workspaceId !== workspaceId) {
      throw new ConstraintError(
        "Parent folder belongs to a different workspace.",
        "cross_workspace"
      );
    }

    if (movingId !== undefined) {
      await assertNoFolderCycle(folders, movingId, parentId);
    }
  }

  return {
    async create(input) {
      await requireWorkspace(workspaces, input.workspaceId);
      const name = validateDisplayName(input.name);
      await checkParent(input.workspaceId, input.parentId);
      return folders.create({
        workspaceId: input.workspaceId,
        parentId: input.parentId,
        name,
        at: clock(),
      });
    },
    async rename(id, name) {
      const folder = await folders.get(id);

      if (folder === null) {
        throw new NotFoundError("Folder does not exist.");
      }

      return folders.update(id, { name: validateDisplayName(name), at: clock() });
    },
    async move(id, parentId) {
      const folder = await folders.get(id);

      if (folder === null) {
        throw new NotFoundError("Folder does not exist.");
      }

      if (parentId === id) {
        throw new ConstraintError("A folder must not be its own parent.", "folder_cycle");
      }

      await checkParent(folder.workspaceId, parentId, id);

      return folders.update(id, { parentId, at: clock() });
    },
    get(id) {
      return folders.get(id);
    },
    list(workspaceId, options) {
      return folders.list(workspaceId, options);
    },
    children(workspaceId, parentId) {
      return folders.listChildren(workspaceId, parentId);
    },
    ancestors(id) {
      return folders.ancestors(id);
    },
    descendants(id) {
      return folders.descendants(id);
    },
    async delete(id) {
      const folder = await folders.get(id);

      if (folder === null) {
        throw new NotFoundError("Folder does not exist.");
      }

      await folders.delete(id);
    },
  };
}
