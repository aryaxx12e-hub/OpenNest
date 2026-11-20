import type { SearchHit } from "@opennest/core";

import { chunkSource } from "./chunk";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_CANDIDATES,
  DEFAULT_MAX_CHARS,
  DEFAULT_MAX_PASSAGES,
  type Passage,
  type PassageSource,
  type RetrievalOptions,
  type RetrievalResult,
} from "./types";

function option(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;
}

function candidateKey(hit: SearchHit): string {
  return `${hit.kind}:${hit.id}`;
}

export async function retrievePassages(
  options: RetrievalOptions
): Promise<RetrievalResult> {
  const query = options.query.trim();
  const maxCandidates = option(options.maxCandidates, DEFAULT_MAX_CANDIDATES);

  if (query.length === 0) {
    return { query, passages: [], candidates: 0, skipped: 0, bytes: 0 };
  }

  const hits = await options.search.search({
    workspaceId: options.workspaceId,
    text: options.query,
    limit: maxCandidates,
  });
  const maxPassages = option(options.maxPassages, DEFAULT_MAX_PASSAGES);
  let remainingBytes = option(options.maxBytes, DEFAULT_MAX_BYTES);
  const maxChars = option(options.maxChars, DEFAULT_MAX_CHARS);
  const seen = new Set<string>();
  const passages: Passage[] = [];
  let skipped = 0;
  let bytes = 0;

  for (const hit of hits.slice(0, maxCandidates)) {
    if (passages.length >= maxPassages || remainingBytes <= 0) {
      break;
    }

    const key = candidateKey(hit);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    let source: PassageSource | null;

    try {
      source = await options.loadSource(hit);
    } catch {
      skipped += 1;
      continue;
    }

    if (source === null) {
      skipped += 1;
      continue;
    }

    const remaining = maxPassages - passages.length;
    const chunked = chunkSource(source, {
      maxChars,
      maxPassages: remaining,
      maxBytes: remainingBytes,
    });

    if (chunked.length === 0) {
      skipped += 1;
      continue;
    }

    for (const passage of chunked) {
      const size = new TextEncoder().encode(passage.text).byteLength;

      if (size > remainingBytes) {
        break;
      }

      passages.push(passage);
      bytes += size;
      remainingBytes -= size;
    }

    if (passages.length >= maxPassages || remainingBytes <= 0) {
      break;
    }
  }

  return {
    query,
    passages,
    candidates: hits.length,
    skipped,
    bytes,
  };
}
