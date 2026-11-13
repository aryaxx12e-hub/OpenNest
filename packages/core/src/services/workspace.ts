import { normalizeName } from "../rules";
import type { Workspace } from "../domain";
import type { WorkspaceId } from "../ids";
import type { BlobStore, FileRepository, WorkspaceRepository } from "../ports";
import type { Clock } from "./clock";
import { requireWorkspace } from "./require";

export interface WorkspaceService {
  ensure(name?: string): Promise<Workspace>;
  create(name: string): Promise<Workspace>;
  rename(id: WorkspaceId, name: string): Promise<Workspace>;
  get(id: WorkspaceId): Promise<Workspace | null>;
  list(): Promise<Workspace[]>;
  delete(id: WorkspaceId): Promise<void>;
}

export function createWorkspaceService(deps: {
  workspaces: WorkspaceRepository;
  files?: FileRepository;
  blobs?: BlobStore;
  clock: Clock;
}): WorkspaceService {
  const { workspaces, files, blobs, clock } = deps;

  async function purgeOrphanBlobs(): Promise<void> {
    if (files === undefined || blobs === undefined) {
      return;
    }

    const known: string[] = [];

    for (const workspace of await workspaces.list()) {
      let cursor: string | null = null;

      do {
        const page = await files.list(workspace.id, {}, { cursor, limit: 500 });
        known.push(...page.items.map((row) => row.blobKey));
        cursor = page.nextCursor;
      } while (cursor !== null);
    }

    await blobs.purgeOrphans(known as never);
  }

  return {
    ensure(name) {
      return workspaces.ensureWorkspace(
        name === undefined ? { at: clock() } : { name: normalizeName(name), at: clock() }
      );
    },
    async create(name) {
      return workspaces.create({ name: normalizeName(name), at: clock() });
    },
    async rename(id, name) {
      await requireWorkspace(workspaces, id);
      return workspaces.update(id, { name: normalizeName(name), at: clock() });
    },
    get(id) {
      return workspaces.get(id);
    },
    list() {
      return workspaces.list();
    },
    async delete(id) {
      await requireWorkspace(workspaces, id);
      await workspaces.delete(id);
      await purgeOrphanBlobs();
    },
  };
}
