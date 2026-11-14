import type { Folder, FolderId, WorkspaceId } from "@opennest/core";
import { describe, expect, it } from "vitest";

import { collectFolderSubtree, folderOptions } from "../folders";

function folder(id: string, parentId: string | null, name: string): Folder {
  return {
    id: id as FolderId,
    workspaceId: "workspace" as WorkspaceId,
    parentId: parentId as FolderId | null,
    name,
    createdAt: "2030-01-01T00:00:00.000Z" as Folder["createdAt"],
    updatedAt: "2030-01-01T00:00:00.000Z" as Folder["updatedAt"],
  };
}

const folders = [
  folder("b", null, "Beta"),
  folder("a", null, "Alpha"),
  folder("c", "a", "Child"),
  folder("d", "c", "Grandchild"),
];

describe("folderOptions", () => {
  it("sorts folders by name and preserves hierarchy depth", () => {
    expect(
      folderOptions(folders).map((option) => [option.folder.name, option.depth])
    ).toEqual([
      ["Alpha", 0],
      ["Child", 1],
      ["Grandchild", 2],
      ["Beta", 0],
    ]);
  });

  it("drops an excluded subtree", () => {
    expect(
      folderOptions(folders, collectFolderSubtree(folders, "a" as FolderId)).map(
        (option) => option.folder.name
      )
    ).toEqual(["Beta"]);
  });
});

describe("collectFolderSubtree", () => {
  it("includes the root and all descendants", () => {
    expect([...collectFolderSubtree(folders, "a" as FolderId)].sort()).toEqual([
      "a",
      "c",
      "d",
    ]);
  });

  it("returns only the root when it has no children", () => {
    expect([...collectFolderSubtree(folders, "b" as FolderId)]).toEqual(["b"]);
  });
});
