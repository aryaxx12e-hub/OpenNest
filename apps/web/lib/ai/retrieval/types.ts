import type { SearchHit, SearchRepository, WorkspaceId } from "@opennest/core";

export const DEFAULT_MAX_CANDIDATES = 8;
export const DEFAULT_MAX_PASSAGES = 20;
export const DEFAULT_MAX_BYTES = 256 * 1024;
export const DEFAULT_MAX_CHARS = 1200;

export type PassageKind = "note" | "file";

export interface PassageSource {
  kind: PassageKind;
  id: string;
  title: string;
  text: string;
  mimeType: string | null;
}

export interface Passage {
  id: string;
  kind: PassageKind;
  sourceId: string;
  sourceTitle: string;
  text: string;
  start: number;
  end: number;
}

export interface ChunkOptions {
  maxChars?: number;
  maxPassages?: number;
  maxBytes?: number;
}

export interface RetrievalOptions extends ChunkOptions {
  workspaceId: WorkspaceId;
  query: string;
  search: Pick<SearchRepository, "search">;
  loadSource: (hit: SearchHit) => Promise<PassageSource | null>;
  maxCandidates?: number;
}

export interface RetrievalResult {
  query: string;
  passages: Passage[];
  candidates: number;
  skipped: number;
  bytes: number;
}

export interface CitationValidation {
  answer: string;
  citations: Passage[];
  unsupported: boolean;
}
