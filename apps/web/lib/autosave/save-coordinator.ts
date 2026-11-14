export interface SaveWork {
  id: string;
  flush: () => Promise<void>;
  isDirty: () => boolean;
}

export type SaveFlushResult = { ok: true } | { ok: false; error: unknown; id?: string };

export interface SaveCoordinator {
  register(work: SaveWork): () => void;
  flushAll(): Promise<SaveFlushResult>;
  hasPending(): boolean;
}

export interface SaveCoordinatorOptions {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export function createSaveCoordinator(
  options: SaveCoordinatorOptions = {}
): SaveCoordinator {
  const works = new Map<string, SaveWork>();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let flushing: Promise<SaveFlushResult> | null = null;

  async function run(): Promise<SaveFlushResult> {
    const entries = Array.from(works.values());
    let timer: ReturnType<typeof setTimeout> | undefined;

    const raced = await Promise.race([
      Promise.allSettled(entries.map((entry) => entry.flush())).then((results) => ({
        type: "settled" as const,
        results,
      })),
      new Promise<{ type: "timeout" }>((resolve) => {
        timer = setTimeout(() => resolve({ type: "timeout" }), timeoutMs);
      }),
    ]);

    if (timer !== undefined) {
      clearTimeout(timer);
    }

    if (raced.type === "timeout") {
      return { ok: false, error: new Error("Saving timed out.") };
    }

    for (let index = 0; index < raced.results.length; index += 1) {
      const result = raced.results[index];

      if (result === undefined) {
        continue;
      }

      if (result.status === "rejected") {
        return {
          ok: false,
          error: result.reason,
          id: entries[index]?.id,
        };
      }
    }

    const stillDirty = entries.find((entry) => entry.isDirty());

    if (stillDirty !== undefined) {
      return {
        ok: false,
        error: new Error("Unsaved changes remain."),
        id: stillDirty.id,
      };
    }

    return { ok: true };
  }

  return {
    register(work) {
      works.set(work.id, work);

      return () => {
        if (works.get(work.id) === work) {
          works.delete(work.id);
        }
      };
    },
    flushAll() {
      if (flushing !== null) {
        return flushing;
      }

      flushing = run().finally(() => {
        flushing = null;
      });

      return flushing;
    },
    hasPending() {
      return Array.from(works.values()).some((work) => work.isDirty());
    },
  };
}
