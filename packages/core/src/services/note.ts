import { assertSameWorkspace } from "../checks";
import { ConstraintError, NotFoundError } from "../errors";
import type { Note, NoteLink, Tag } from "../domain";
import type { FolderId, IsoDate, NoteId, TagId, WorkspaceId } from "../ids";
import type {
  FolderRepository,
  ListOptions,
  NoteFilter,
  NoteRepository,
  Page,
  TagRepository,
  WorkspaceRepository,
} from "../ports";
import { assertNoSelfLink, validateNoteInput } from "../rules";
import type { Clock } from "./clock";
import { requireWorkspace } from "./require";

export interface NoteService {
  create(input: {
    workspaceId: WorkspaceId;
    folderId: FolderId | null;
    title: string;
    content?: string;
    pinned?: boolean;
  }): Promise<Note>;
  update(
    id: NoteId,
    patch: {
      title?: string;
      content?: string;
      folderId?: FolderId | null;
      pinned?: boolean;
    }
  ): Promise<Note>;
  get(id: NoteId): Promise<Note | null>;
  list(
    workspaceId: WorkspaceId,
    filter: NoteFilter,
    options?: ListOptions
  ): Promise<Page<Note>>;
  setTags(id: NoteId, tagIds: TagId[]): Promise<void>;
  tags(id: NoteId): Promise<Tag[]>;
  setLinks(id: NoteId, targetIds: NoteId[]): Promise<void>;
  links(id: NoteId): Promise<NoteLink[]>;
  delete(id: NoteId): Promise<void>;
}

export interface NoteDeps {
  notes: NoteRepository;
  folders: FolderRepository;
  tags: TagRepository;
  workspaces: WorkspaceRepository;
  clock: Clock;
}

export function createNoteService(deps: NoteDeps): NoteService {
  const { notes, folders, tags, workspaces, clock } = deps;

  async function checkRefs(
    workspaceId: WorkspaceId,
    folderId: FolderId | null | undefined,
    tagIds: TagId[] | undefined
  ): Promise<void> {
    await requireWorkspace(workspaces, workspaceId);
    await assertSameWorkspace(
      { folders, tags },
      {
        workspaceId,
        ...(folderId === undefined ? {} : { folderId }),
        ...(tagIds === undefined ? {} : { tagIds }),
      }
    );
  }

  return {
    async create(input) {
      const { title, content } = validateNoteInput(input);
      await checkRefs(input.workspaceId, input.folderId, undefined);

      return notes.create({
        workspaceId: input.workspaceId,
        folderId: input.folderId,
        title,
        content,
        pinned: input.pinned ?? false,
        at: clock(),
      });
    },
    async update(id, patch) {
      const note = await notes.get(id);

      if (note === null) {
        throw new NotFoundError("Note does not exist.");
      }

      const next: {
        title?: string;
        content?: string;
        folderId?: FolderId | null;
        pinned?: boolean;
        at?: IsoDate;
      } = { at: clock() };

      if (patch.title !== undefined || patch.content !== undefined) {
        const validated = validateNoteInput({
          title: patch.title ?? note.title,
          content: patch.content ?? note.content,
        });

        if (patch.title !== undefined) {
          next.title = validated.title;
        }

        if (patch.content !== undefined) {
          next.content = validated.content;
        }
      }

      if (patch.folderId !== undefined) {
        await checkRefs(note.workspaceId, patch.folderId, undefined);
        next.folderId = patch.folderId;
      }

      if (patch.pinned !== undefined) {
        next.pinned = patch.pinned;
      }

      return notes.update(id, next);
    },
    get(id) {
      return notes.get(id);
    },
    list(workspaceId, filter, options) {
      return notes.list(workspaceId, filter, options);
    },
    async setTags(id, tagIds) {
      const note = await notes.get(id);

      if (note === null) {
        throw new NotFoundError("Note does not exist.");
      }

      await checkRefs(note.workspaceId, undefined, [...new Set(tagIds)]);
      await notes.setTags(id, [...new Set(tagIds)]);
    },
    tags(id) {
      return notes.tags(id);
    },
    async setLinks(id, targetIds) {
      const note = await notes.get(id);

      if (note === null) {
        throw new NotFoundError("Note does not exist.");
      }

      const unique = [...new Set(targetIds)];

      for (const targetId of unique) {
        assertNoSelfLink(id, targetId);
        const target = await notes.get(targetId);

        if (target === null) {
          throw new NotFoundError("Linked note does not exist.");
        }

        if (target.workspaceId !== note.workspaceId) {
          throw new ConstraintError(
            "Linked note belongs to a different workspace.",
            "cross_workspace"
          );
        }
      }

      await notes.setLinks(id, unique);
    },
    links(id) {
      return notes.links(id);
    },
    async delete(id) {
      const note = await notes.get(id);

      if (note === null) {
        throw new NotFoundError("Note does not exist.");
      }

      await notes.delete(id);
    },
  };
}
