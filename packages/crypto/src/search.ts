import {
  normalizeForSearch,
  searchTokens,
  type Note,
  type NoteFilter,
  type NoteRepository,
  type SearchHit,
  type SearchQuery,
  type SearchRepository,
  type WorkspaceId,
} from "@opennest/core";

import { CryptoError } from "./errors";

const DEFAULT_LIMIT = 50;
const NOTE_PAGE_SIZE = 200;
const FILE_PAGE_SIZE = 200;

export interface EncryptedSearchOptions {
  workspaceId: string;
  baseSearch: SearchRepository;
  baseNotes: NoteRepository;
  openNote: (note: Note) => Promise<Note>;
}

export function createEncryptedSearch(options: EncryptedSearchOptions): SearchRepository {
  const workspaceId = options.workspaceId as WorkspaceId;
  const { baseSearch, baseNotes, openNote } = options;

  return {
    async search(query) {
      assertWorkspace(query.workspaceId);

      const tokens = searchTokens(query.text);

      if (tokens.length === 0) {
        return [];
      }

      const kinds = new Set(query.kinds ?? ["file", "note"]);

      if (kinds.has("file") && !kinds.has("note")) {
        return baseSearch.search(query);
      }

      const foldedQuery = normalizeForSearch(query.text);
      const hits: SearchHit[] = [];

      if (kinds.has("file")) {
        hits.push(...(await listFileHits(query)));
      }

      if (kinds.has("note")) {
        for (const raw of await listRawNotes(query)) {
          const note = await openNote(raw);
          const text = `${note.title} ${note.content}`;

          if (matchesTokens(text, tokens)) {
            hits.push({
              kind: "note",
              id: note.id,
              title: note.title,
              snippet: snippetOf(text, tokens),
              score: 0,
            });
          }
        }
      }

      const offset = query.offset ?? 0;
      const limit = query.limit ?? DEFAULT_LIMIT;

      return hits
        .sort((left, right) => compareHits(left, right, foldedQuery, tokens))
        .slice(offset, offset + limit);
    },
    async reindexAll(target) {
      assertWorkspace(target);
      await baseSearch.reindexAll(target);
    },
  };

  function assertWorkspace(target: string): void {
    if (target !== workspaceId) {
      throw new CryptoError(
        "invalid_workspace_id",
        "Encrypted search cannot access another workspace"
      );
    }
  }

  async function listFileHits(query: SearchQuery): Promise<SearchHit[]> {
    const hits: SearchHit[] = [];
    let offset = 0;

    for (;;) {
      const page = await baseSearch.search({
        ...fileQuery(query),
        limit: FILE_PAGE_SIZE,
        offset,
      });
      hits.push(...page);

      if (page.length < FILE_PAGE_SIZE) {
        return hits;
      }

      offset += page.length;
    }
  }

  async function listRawNotes(query: SearchQuery): Promise<Note[]> {
    const filter: NoteFilter = {};

    if (query.folderId !== undefined) {
      filter.folderId = query.folderId;
    }
    if (query.tagIds !== undefined) {
      filter.tagIds = query.tagIds;
    }

    const notes: Note[] = [];
    let cursor: string | null = null;

    for (;;) {
      const page = await baseNotes.list(workspaceId, filter, {
        limit: NOTE_PAGE_SIZE,
        ...(cursor === null ? {} : { cursor }),
      });
      notes.push(...page.items);

      if (page.nextCursor === null || page.nextCursor === cursor) {
        return notes;
      }

      cursor = page.nextCursor;
    }
  }
}

function fileQuery(query: SearchQuery): SearchQuery {
  const next: SearchQuery = {
    workspaceId: query.workspaceId,
    text: query.text,
    kinds: ["file"],
  };

  if (query.folderId !== undefined) {
    next.folderId = query.folderId;
  }
  if (query.tagIds !== undefined) {
    next.tagIds = query.tagIds;
  }

  return next;
}

function compareHits(
  left: SearchHit,
  right: SearchHit,
  foldedQuery: string,
  tokens: string[]
): number {
  const tier = hitTier(left, foldedQuery, tokens) - hitTier(right, foldedQuery, tokens);

  if (tier !== 0) {
    return tier;
  }

  const leftTitle = normalizeForSearch(left.title);
  const rightTitle = normalizeForSearch(right.title);

  if (leftTitle !== rightTitle) {
    return leftTitle < rightTitle ? -1 : 1;
  }

  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function hitTier(hit: SearchHit, foldedQuery: string, tokens: string[]): number {
  const foldedTitle = normalizeForSearch(hit.title);

  if (foldedTitle === foldedQuery) {
    return 0;
  }

  if (foldedTitle.startsWith(foldedQuery)) {
    return 1;
  }

  if (
    tokens.every((token) => foldedTitle.split(" ").some((word) => word.startsWith(token)))
  ) {
    return 2;
  }

  return 3;
}

function matchesTokens(text: string, tokens: string[]): boolean {
  const words = normalizeForSearch(text)
    .split(" ")
    .filter((word) => word.length > 0);

  return tokens.every((token) => words.some((word) => word.startsWith(token)));
}

function snippetOf(text: string, tokens: string[]): string {
  const folded = normalizeForSearch(text);
  const position = tokens
    .map((token) => folded.indexOf(token))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];

  if (position === undefined) {
    return text.slice(0, 80);
  }

  const start = Math.max(0, position - 20);

  return text.slice(start, start + 100);
}
