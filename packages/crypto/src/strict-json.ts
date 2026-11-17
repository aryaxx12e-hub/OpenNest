export class DuplicateJsonKeyError extends Error {
  constructor(message = "JSON contains duplicate object keys") {
    super(message);
    this.name = "DuplicateJsonKeyError";
  }
}

export function parseStrictJson(text: string): unknown {
  assertUniqueJsonKeys(text);
  return JSON.parse(text) as unknown;
}

export function assertUniqueJsonKeys(text: string): void {
  const stack: Array<Set<string> | null> = [];
  let index = 0;

  while (index < text.length) {
    const char = text.charAt(index);

    if (char === "{") {
      stack.push(new Set());
      index += 1;
      continue;
    }

    if (char === "[") {
      stack.push(null);
      index += 1;
      continue;
    }

    if (char === "}" || char === "]") {
      stack.pop();
      index += 1;
      continue;
    }

    if (char !== '"') {
      index += 1;
      continue;
    }

    const start = index;
    index += 1;

    while (index < text.length) {
      if (text.charAt(index) === "\\") {
        index += 2;
        continue;
      }

      if (text.charAt(index) === '"') {
        index += 1;
        break;
      }

      index += 1;
    }

    let cursor = index;

    while (cursor < text.length && /\s/.test(text.charAt(cursor))) {
      cursor += 1;
    }

    const keys = stack[stack.length - 1];

    if (text.charAt(cursor) !== ":" || !keys) {
      continue;
    }

    let key: unknown;

    try {
      key = JSON.parse(text.slice(start, index)) as unknown;
    } catch {
      continue;
    }

    if (typeof key !== "string") {
      continue;
    }

    if (keys.has(key)) {
      throw new DuplicateJsonKeyError();
    }

    keys.add(key);
  }
}
