import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_CHARS,
  DEFAULT_MAX_PASSAGES,
  type ChunkOptions,
  type Passage,
  type PassageSource,
} from "./types";

interface Range {
  start: number;
  end: number;
}

interface ChunkState {
  maxChars: number;
  maxPassages: number;
  maxBytes: number;
  bytes: number;
  passages: Passage[];
}

const encoder = new TextEncoder();

function byteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

function option(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;
}

function isTextReadable(source: PassageSource): boolean {
  if (source.kind === "note") {
    return true;
  }

  const mimeType = source.mimeType?.split(";")[0]?.trim().toLowerCase();

  return mimeType === "text/plain" || mimeType === "text/markdown";
}

function hashText(text: string): string {
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function passageId(
  source: PassageSource,
  start: number,
  end: number,
  text: string
): string {
  return `${source.kind}:${source.id}:${start}-${end}:${hashText(text)}`;
}

function trimmedRange(text: string, start: number, end: number): Range {
  const raw = text.slice(start, end);
  const leading = raw.length - raw.trimStart().length;
  const trailing = raw.length - raw.trimEnd().length;

  return { start: start + leading, end: end - trailing };
}

function paragraphRanges(text: string): Range[] {
  const ranges: Range[] = [];
  const separator = /\n{2,}/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = separator.exec(text)) !== null) {
    const range = trimmedRange(text, cursor, match.index);

    if (range.start < range.end) {
      ranges.push(range);
    }

    cursor = match.index + match[0].length;
  }

  const tail = trimmedRange(text, cursor, text.length);

  if (tail.start < tail.end) {
    ranges.push(tail);
  }

  return ranges;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function segments(text: string, range: Range, maxChars: number): Range[] {
  const result: Range[] = [];
  let cursor = range.start;

  while (cursor < range.end) {
    let end = Math.min(range.end, cursor + maxChars);

    if (end < range.end && isLowSurrogate(text.charCodeAt(end))) {
      end -= 1;
    }

    if (end <= cursor) {
      end = Math.min(range.end, cursor + 1);
    }

    result.push({ start: cursor, end });
    cursor = end;
  }

  return result;
}

function full(state: ChunkState): boolean {
  return state.passages.length >= state.maxPassages || state.bytes >= state.maxBytes;
}

function addPassage(state: ChunkState, source: PassageSource, range: Range): boolean {
  if (full(state)) {
    return false;
  }

  const text = source.text.slice(range.start, range.end);

  if (text.length === 0) {
    return true;
  }

  const bytes = byteLength(text);

  if (state.bytes + bytes > state.maxBytes) {
    return false;
  }

  state.passages.push({
    id: passageId(source, range.start, range.end, text),
    kind: source.kind,
    sourceId: source.id,
    sourceTitle: source.title,
    text,
    start: range.start,
    end: range.end,
  });
  state.bytes += bytes;

  return !full(state);
}

function appendSource(state: ChunkState, source: PassageSource): void {
  if (!isTextReadable(source) || source.text.length === 0 || full(state)) {
    return;
  }

  let current: Range | null = null;

  for (const paragraph of paragraphRanges(source.text)) {
    if (paragraph.end - paragraph.start > state.maxChars) {
      if (current !== null) {
        addPassage(state, source, current);
        current = null;
      }

      for (const segment of segments(source.text, paragraph, state.maxChars)) {
        if (!addPassage(state, source, segment)) {
          return;
        }
      }

      continue;
    }

    if (current === null) {
      current = { ...paragraph };
    } else if (paragraph.end - current.start <= state.maxChars) {
      current.end = paragraph.end;
    } else {
      if (!addPassage(state, source, current)) {
        return;
      }

      current = { ...paragraph };
    }
  }

  if (current !== null) {
    addPassage(state, source, current);
  }
}

function stateFor(options: ChunkOptions): ChunkState {
  return {
    maxChars: option(options.maxChars, DEFAULT_MAX_CHARS),
    maxPassages: option(options.maxPassages, DEFAULT_MAX_PASSAGES),
    maxBytes: option(options.maxBytes, DEFAULT_MAX_BYTES),
    bytes: 0,
    passages: [],
  };
}

export function chunkSource(
  source: PassageSource,
  options: ChunkOptions = {}
): Passage[] {
  const state = stateFor(options);
  appendSource(state, source);

  return state.passages;
}

export function chunkSources(
  sources: readonly PassageSource[],
  options: ChunkOptions = {}
): Passage[] {
  const state = stateFor(options);

  for (const source of sources) {
    appendSource(state, source);

    if (full(state)) {
      break;
    }
  }

  return state.passages;
}
