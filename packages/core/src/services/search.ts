import type { SearchHit, SearchQuery, SearchRepository } from "../ports";
import type { WorkspaceId } from "../ids";
import { normalizeForSearch } from "../rules";

export interface SearchService {
  search(query: SearchQuery): Promise<SearchHit[]>;
  reindexAll(workspaceId: WorkspaceId): Promise<void>;
}

export function createSearchService(deps: { search: SearchRepository }): SearchService {
  const { search } = deps;

  return {
    async search(query) {
      const text = normalizeForSearch(query.text);

      if (text.length === 0) {
        return [];
      }

      return search.search({ ...query, text });
    },
    reindexAll(workspaceId) {
      return search.reindexAll(workspaceId);
    },
  };
}
