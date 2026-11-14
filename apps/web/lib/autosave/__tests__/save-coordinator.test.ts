import { describe, expect, it, vi } from "vitest";

import { createSaveCoordinator, type SaveWork } from "../save-coordinator";

function work(
  id: string,
  flush: () => Promise<void>,
  dirty = true
): SaveWork & { isDirty: () => boolean } {
  return { id, flush, isDirty: () => dirty };
}

describe("save coordinator", () => {
  it("flushes every registered piece of work", async () => {
    const coordinator = createSaveCoordinator();
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);

    coordinator.register(work("first", first, false));
    coordinator.register(work("second", second, false));

    await expect(coordinator.flushAll()).resolves.toEqual({ ok: true });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("reports the work that failed and keeps the others flushed", async () => {
    const coordinator = createSaveCoordinator();
    const failure = new Error("disk full");
    const healthy = vi.fn(async () => undefined);

    coordinator.register(work("broken", async () => Promise.reject(failure)));
    coordinator.register(work("healthy", healthy));

    const result = await coordinator.flushAll();

    expect(result).toMatchObject({ ok: false, id: "broken", error: failure });
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it("fails closed when work is still dirty after flushing", async () => {
    const coordinator = createSaveCoordinator();

    coordinator.register(work("editor", async () => undefined, true));

    const result = await coordinator.flushAll();

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error).toBeInstanceOf(Error);
  });

  it("shares one flush between concurrent callers", async () => {
    const coordinator = createSaveCoordinator();
    let resolve: () => void = () => undefined;
    const flush = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        })
    );

    coordinator.register(work("editor", flush, false));

    const first = coordinator.flushAll();
    const second = coordinator.flushAll();

    expect(first).toBe(second);
    expect(flush).toHaveBeenCalledTimes(1);

    resolve();
    await expect(first).resolves.toEqual({ ok: true });
  });

  it("times out instead of leaving the update action hanging", async () => {
    const coordinator = createSaveCoordinator({ timeoutMs: 10 });

    coordinator.register(work("editor", async () => new Promise(() => undefined), false));

    const result = await coordinator.flushAll();

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error).toBeInstanceOf(Error);
  });

  it("stops tracking work after it unregisters", async () => {
    const coordinator = createSaveCoordinator();
    const flush = vi.fn(async () => undefined);
    const unregister = coordinator.register(work("editor", flush, false));

    unregister();
    await expect(coordinator.flushAll()).resolves.toEqual({ ok: true });
    expect(flush).not.toHaveBeenCalled();
  });

  it("reports whether any work is waiting", () => {
    const coordinator = createSaveCoordinator();
    const unregister = coordinator.register(work("editor", async () => undefined, true));

    expect(coordinator.hasPending()).toBe(true);
    unregister();
    expect(coordinator.hasPending()).toBe(false);
  });
});
