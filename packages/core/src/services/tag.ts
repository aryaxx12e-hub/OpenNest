import { ConflictError, NotFoundError } from "../errors";
import type { Tag } from "../domain";
import type { IsoDate, TagId, WorkspaceId } from "../ids";
import type { ListOptions, Page, TagRepository, WorkspaceRepository } from "../ports";
import { normalizeTagName, validateTagColor } from "../rules";
import type { Clock } from "./clock";
import { requireWorkspace } from "./require";

export interface TagService {
  create(input: {
    workspaceId: WorkspaceId;
    name: string;
    color?: string | null;
  }): Promise<Tag>;
  update(id: TagId, patch: { name?: string; color?: string | null }): Promise<Tag>;
  get(id: TagId): Promise<Tag | null>;
  list(workspaceId: WorkspaceId, options?: ListOptions): Promise<Page<Tag>>;
  findByName(workspaceId: WorkspaceId, name: string): Promise<Tag | null>;
  delete(id: TagId): Promise<void>;
}

export function createTagService(deps: {
  tags: TagRepository;
  workspaces: WorkspaceRepository;
  clock: Clock;
}): TagService {
  const { tags, workspaces, clock } = deps;

  async function assertNameAvailable(
    workspaceId: WorkspaceId,
    key: string,
    exceptId?: TagId
  ): Promise<void> {
    const existing = await tags.findByName(workspaceId, key);

    if (existing !== null && existing.id !== exceptId) {
      throw new ConflictError(
        "A tag with that name already exists.",
        "duplicate_tag_name"
      );
    }
  }

  return {
    async create(input) {
      await requireWorkspace(workspaces, input.workspaceId);
      const { display, key } = normalizeTagName(input.name);
      await assertNameAvailable(input.workspaceId, key);

      return tags.create({
        workspaceId: input.workspaceId,
        name: display,
        color: validateTagColor(input.color ?? null),
        at: clock(),
      });
    },
    async update(id, patch) {
      const tag = await tags.get(id);

      if (tag === null) {
        throw new NotFoundError("Tag does not exist.");
      }

      const next: { name?: string; color?: string | null; at?: IsoDate } = {
        at: clock(),
      };

      if (patch.name !== undefined) {
        const { display, key } = normalizeTagName(patch.name);
        await assertNameAvailable(tag.workspaceId, key, id);
        next.name = display;
      }

      if (patch.color !== undefined) {
        next.color = validateTagColor(patch.color);
      }

      return tags.update(id, next);
    },
    get(id) {
      return tags.get(id);
    },
    list(workspaceId, options) {
      return tags.list(workspaceId, options);
    },
    async findByName(workspaceId, name) {
      return tags.findByName(workspaceId, normalizeTagName(name).key);
    },
    async delete(id) {
      const tag = await tags.get(id);

      if (tag === null) {
        throw new NotFoundError("Tag does not exist.");
      }

      await tags.delete(id);
    },
  };
}
