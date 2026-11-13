import type { Folder, Tag } from "./domain";
import { ConstraintError, NotFoundError } from "./errors";
import type { FolderId, TagId, WorkspaceId } from "./ids";
import { limits } from "./limits";

export interface FolderLookup {
  get(id: FolderId): Promise<Folder | null>;
}

export interface TagLookup {
  get(id: TagId): Promise<Tag | null>;
}

export interface WorkspaceRefs {
  workspaceId: WorkspaceId;
  folderId?: FolderId | null;
  tagIds?: TagId[];
}

export interface SameWorkspaceDeps {
  folders: FolderLookup;
  tags: TagLookup;
}

export async function assertNoFolderCycle(
  folders: FolderLookup,
  folderId: FolderId,
  nextParentId: FolderId | null
): Promise<void> {
  if (nextParentId === null) {
    return;
  }

  if (nextParentId === folderId) {
    throw new ConstraintError("A folder must not be its own parent.", "folder_cycle");
  }

  let cursor: FolderId | null = nextParentId;
  const visited = new Set<string>([folderId]);
  let depth = 0;

  while (cursor !== null) {
    if (visited.has(cursor)) {
      throw new ConstraintError(
        "A folder must not be nested inside itself.",
        "folder_cycle"
      );
    }

    visited.add(cursor);
    depth += 1;

    if (depth > limits.maxFolderDepth) {
      throw new ConstraintError("Folder nesting is too deep.", "folder_cycle");
    }

    const parent: Folder | null = await folders.get(cursor);

    if (parent === null) {
      throw new NotFoundError("Parent folder does not exist.");
    }

    cursor = parent.parentId;
  }
}

export async function assertSameWorkspace(
  deps: SameWorkspaceDeps,
  refs: WorkspaceRefs
): Promise<void> {
  const { workspaceId } = refs;

  if (refs.folderId !== undefined && refs.folderId !== null) {
    const folder = await deps.folders.get(refs.folderId);

    if (folder === null) {
      throw new NotFoundError("Folder does not exist.");
    }

    if (folder.workspaceId !== workspaceId) {
      throw new ConstraintError(
        "Folder belongs to a different workspace.",
        "cross_workspace"
      );
    }
  }

  for (const tagId of refs.tagIds ?? []) {
    const tag = await deps.tags.get(tagId);

    if (tag === null) {
      throw new NotFoundError("Tag does not exist.");
    }

    if (tag.workspaceId !== workspaceId) {
      throw new ConstraintError(
        "Tag belongs to a different workspace.",
        "cross_workspace"
      );
    }
  }
}

export function assertNoFolderCycleInTree(folders: readonly Folder[]): void {
  const byId = new Map<string, Folder>();

  for (const folder of folders) {
    byId.set(folder.id, folder);
  }

  const depthOf = new Map<string, number>();

  for (const folder of folders) {
    if (depthOf.has(folder.id)) {
      continue;
    }

    const path: string[] = [];
    const onPath = new Set<string>();
    let cursor: Folder | undefined = folder;

    while (cursor !== undefined && !depthOf.has(cursor.id)) {
      if (onPath.has(cursor.id)) {
        throw new ConstraintError(
          "A folder must not be nested inside itself.",
          "folder_cycle"
        );
      }

      onPath.add(cursor.id);
      path.push(cursor.id);

      if (path.length > limits.maxFolderDepth) {
        throw new ConstraintError("Folder nesting is too deep.", "folder_cycle");
      }

      cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
    }

    let depth = cursor === undefined ? 0 : (depthOf.get(cursor.id) ?? 0);

    for (let index = path.length - 1; index >= 0; index -= 1) {
      const id = path[index];

      if (id === undefined) {
        continue;
      }

      depth += 1;
      depthOf.set(id, depth);

      if (depth > limits.maxFolderDepth) {
        throw new ConstraintError("Folder nesting is too deep.", "folder_cycle");
      }
    }
  }
}
