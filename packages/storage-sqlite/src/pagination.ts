import type { ListOptions, Page } from "@opennest/core";
import { decodeCursor, encodeCursor } from "@opennest/core";

export const DEFAULT_LIMIT = 50;

export function paginate<T>(
  rows: readonly T[],
  options: ListOptions | undefined,
  valueOf: (row: T) => string,
  idOf: (row: T) => string
): Page<T> {
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const direction = options?.direction ?? "asc";
  const sign = direction === "asc" ? 1 : -1;

  const sorted = [...rows].sort((left, right) => {
    const a = valueOf(left);
    const b = valueOf(right);

    if (a !== b) {
      return a < b ? -sign : sign;
    }

    const leftId = idOf(left);
    const rightId = idOf(right);

    return leftId < rightId ? -sign : leftId > rightId ? sign : 0;
  });

  const start =
    options?.cursor === undefined || options.cursor === null
      ? 0
      : (() => {
          const [cursorValue, cursorId] = decodeCursor(options.cursor);
          const index = sorted.findIndex(
            (row) => valueOf(row) === cursorValue && idOf(row) === cursorId
          );

          return index === -1 ? sorted.length : index + 1;
        })();

  const items = sorted.slice(start, start + limit);
  const last = items.at(-1);
  const nextCursor =
    last !== undefined && start + limit < sorted.length
      ? encodeCursor([valueOf(last), idOf(last)])
      : null;

  return { items, nextCursor, total: sorted.length };
}

export function mapPage<T, R>(page: Page<T>, map: (row: T) => R): Page<R> {
  return {
    items: page.items.map(map),
    nextCursor: page.nextCursor,
    total: page.total,
  };
}
