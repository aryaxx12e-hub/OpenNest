import type { Folder, FolderId } from "@opennest/core";

export interface FolderOption {
  folder: Folder;
  depth: number;
}

export function collectFolderSubtree(
  folders: readonly Folder[],
  rootId: FolderId
): Set<string> {
  const ids = new Set<string>([rootId]);
  let changed = true;

  while (changed) {
    changed = false;

    for (const folder of folders) {
      if (folder.parentId !== null && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        changed = true;
      }
    }
  }

  return ids;
}

export function folderOptions(
  folders: readonly Folder[],
  excluded: ReadonlySet<string> = new Set()
): FolderOption[] {
  const byParent = new Map<string | null, Folder[]>();

  for (const folder of folders) {
    const siblings = byParent.get(folder.parentId) ?? [];
    siblings.push(folder);
    byParent.set(folder.parentId, siblings);
  }

  for (const siblings of byParent.values()) {
    siblings.sort((left, right) => left.name.localeCompare(right.name));
  }

  const options: FolderOption[] = [];

  function visit(parentId: string | null, depth: number) {
    for (const folder of byParent.get(parentId) ?? []) {
      if (excluded.has(folder.id)) {
        continue;
      }

      options.push({ folder, depth });
      visit(folder.id, depth + 1);
    }
  }

  visit(null, 0);

  return options;
}
