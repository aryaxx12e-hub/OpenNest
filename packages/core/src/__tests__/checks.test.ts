import { describe, expect, it } from "vitest";

import {
  assertNoFolderCycle,
  assertNoFolderCycleInTree,
  assertSameWorkspace,
} from "../checks";
import { ConstraintError, NotFoundError } from "../errors";
import type { Folder, Tag } from "../domain";
import type { FolderId, TagId, WorkspaceId } from "../ids";
import { folderFixture, tagFixture } from "../testing/fixtures";

function folderLookup(folders: Folder[]) {
  const byId = new Map(folders.map((folder) => [folder.id as string, folder]));

  return {
    async get(id: FolderId) {
      return byId.get(id) ?? null;
    },
  };
}

const WS_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as WorkspaceId;
const WS_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as WorkspaceId;

function chain(): Folder[] {
  const root = folderFixture({ id: "f0000000-0000-4000-8000-000000000000" as FolderId });
  const mid = folderFixture({
    id: "f1111111-1111-4111-8111-111111111111" as FolderId,
    parentId: root.id,
  });
  const leaf = folderFixture({
    id: "f2222222-2222-4222-8222-222222222222" as FolderId,
    parentId: mid.id,
  });

  return [root, mid, leaf];
}

describe("assertNoFolderCycle", () => {
  it("accepts moving a folder under an unrelated folder", async () => {
    const folders = chain();
    const leaf = folders[2] as Folder;
    const other = folderFixture({
      id: "f3333333-3333-4333-8333-333333333333" as FolderId,
    });

    await expect(
      assertNoFolderCycle(folderLookup([...folders, other]), other.id, leaf.id)
    ).resolves.toBeUndefined();
  });

  it("accepts making a folder a root folder", async () => {
    const folders = chain();

    await expect(
      assertNoFolderCycle(folderLookup(folders), (folders[2] as Folder).id, null)
    ).resolves.toBeUndefined();
  });

  it("rejects moving a folder under itself", async () => {
    const folders = chain();
    const mid = folders[1] as Folder;

    await expect(
      assertNoFolderCycle(folderLookup(folders), mid.id, mid.id)
    ).rejects.toBeInstanceOf(ConstraintError);
  });

  it("rejects moving a folder under its own descendant", async () => {
    const folders = chain();
    const root = folders[0] as Folder;
    const leaf = folders[2] as Folder;

    await expect(
      assertNoFolderCycle(folderLookup(folders), root.id, leaf.id)
    ).rejects.toMatchObject({ code: "folder_cycle" });
  });

  it("rejects an unknown parent instead of writing a dangling row", async () => {
    const folders = chain();

    await expect(
      assertNoFolderCycle(
        folderLookup(folders),
        (folders[0] as Folder).id,
        "f9999999-9999-4999-8999-999999999999" as FolderId
      )
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("terminates on a corrupted chain instead of looping forever", async () => {
    const a = folderFixture({ id: "f0000000-0000-4000-8000-000000000000" as FolderId });
    const b = folderFixture({
      id: "f1111111-1111-4111-8111-111111111111" as FolderId,
      parentId: a.id,
    });
    (a as { parentId: FolderId | null }).parentId = b.id;

    await expect(
      assertNoFolderCycle(folderLookup([a, b]), a.id, b.id)
    ).rejects.toMatchObject({ code: "folder_cycle" });
  });
});

describe("assertSameWorkspace", () => {
  function deps(folders: Folder[], tags: Tag[]) {
    return {
      folders: folderLookup(folders),
      tags: {
        async get(id: TagId) {
          return tags.find((tag) => tag.id === id) ?? null;
        },
      },
    };
  }

  it("accepts a folder and tags from the same workspace", async () => {
    const folders = [folderFixture({ workspaceId: WS_A })];
    const tags = [tagFixture({ workspaceId: WS_A })];

    await expect(
      assertSameWorkspace(deps(folders, tags), {
        workspaceId: WS_A,
        folderId: (folders[0] as Folder).id,
        tagIds: [(tags[0] as Tag).id],
      })
    ).resolves.toBeUndefined();
  });

  it("accepts references that are all omitted", async () => {
    await expect(
      assertSameWorkspace(deps([], []), { workspaceId: WS_A })
    ).resolves.toBeUndefined();
  });

  it("rejects a folder from another workspace", async () => {
    const folders = [folderFixture({ workspaceId: WS_B })];

    await expect(
      assertSameWorkspace(deps(folders, []), {
        workspaceId: WS_A,
        folderId: (folders[0] as Folder).id,
      })
    ).rejects.toMatchObject({ code: "cross_workspace" });
  });

  it("rejects a tag from another workspace", async () => {
    const tags = [tagFixture({ workspaceId: WS_B })];

    await expect(
      assertSameWorkspace(deps([], tags), {
        workspaceId: WS_A,
        tagIds: [(tags[0] as Tag).id],
      })
    ).rejects.toMatchObject({ code: "cross_workspace" });
  });

  it("rejects a folder that does not exist", async () => {
    await expect(
      assertSameWorkspace(deps([], []), {
        workspaceId: WS_A,
        folderId: "f9999999-9999-4999-8999-999999999999" as FolderId,
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects a tag that does not exist", async () => {
    await expect(
      assertSameWorkspace(deps([], []), {
        workspaceId: WS_A,
        tagIds: ["t9999999-9999-4999-8999-999999999999" as TagId],
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("assertNoFolderCycleInTree", () => {
  it("accepts a valid tree", () => {
    expect(() => assertNoFolderCycleInTree(chain())).not.toThrow();
  });

  it("accepts an empty tree", () => {
    expect(() => assertNoFolderCycleInTree([])).not.toThrow();
  });

  it("rejects a folder that is its own parent", () => {
    const folder = folderFixture({
      id: "f3333333-3333-4333-8333-333333333333" as FolderId,
    });
    folder.parentId = folder.id;

    expect(() => assertNoFolderCycleInTree([folder])).toThrow(ConstraintError);
  });

  it("rejects a two-node cycle", () => {
    const first = folderFixture({
      id: "f4444444-4444-4444-8444-444444444444" as FolderId,
    });
    const second = folderFixture({
      id: "f5555555-5555-4555-8555-555555555555" as FolderId,
      parentId: first.id,
    });
    first.parentId = second.id;

    expect(() => assertNoFolderCycleInTree([first, second])).toThrow(ConstraintError);
  });

  it("rejects a three-node cycle reached from any member", () => {
    const a = folderFixture({ id: "f6666666-6666-4666-8666-666666666666" as FolderId });
    const b = folderFixture({
      id: "f7777777-7777-4777-8777-777777777777" as FolderId,
      parentId: a.id,
    });
    const c = folderFixture({
      id: "f8888888-8888-4888-8888-888888888888" as FolderId,
      parentId: b.id,
    });
    a.parentId = c.id;

    expect(() => assertNoFolderCycleInTree([a, b, c])).toThrow(ConstraintError);
    expect(() => assertNoFolderCycleInTree([c, a, b])).toThrow(ConstraintError);
  });

  it("rejects a chain deeper than the documented limit", () => {
    const folders: Folder[] = [];
    let parentId: FolderId | null = null;

    for (let index = 0; index <= 1001; index += 1) {
      const id =
        `f${String(index).padStart(7, "0")}-0000-4000-8000-000000000000` as FolderId;
      folders.push(folderFixture({ id, parentId }));
      parentId = id;
    }

    expect(() => assertNoFolderCycleInTree(folders)).toThrow(ConstraintError);
  });

  it("names the cycle code, not a bare error", () => {
    const folder = folderFixture({
      id: "f9999999-9999-4999-8999-999999999999" as FolderId,
    });
    folder.parentId = folder.id;

    try {
      assertNoFolderCycleInTree([folder]);
      expect.unreachable("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConstraintError);
      expect((error as ConstraintError).code).toBe("folder_cycle");
    }
  });

  it("ignores folders whose parent is missing from the array", () => {
    const orphan = folderFixture({
      id: "faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as FolderId,
      parentId: "fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as FolderId,
    });

    expect(() => assertNoFolderCycleInTree([orphan])).not.toThrow();
  });
});
