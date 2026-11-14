import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMemoryStorage } from "@opennest/core";
import { LocaleProvider } from "@opennest/localization";

import { AppDataProvider } from "../app-data-provider";
import { useAsyncData } from "../hooks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  const state = useAsyncData("probe", async () => "ready");

  return (
    <div>
      <span data-testid="state">{state.loading ? "loading" : String(state.data)}</span>
      <button type="button" onClick={state.reload}>
        reload
      </button>
    </div>
  );
}

function KeyProbe({ dataKey, load }: { dataKey: string; load: () => Promise<string> }) {
  const state = useAsyncData(dataKey, load);

  return (
    <div>
      <span data-testid="loading">{state.loading ? "loading" : "idle"}</span>
      <span data-testid="data">{state.data === null ? "none" : state.data}</span>
      <span data-testid="error">{state.error === null ? "clear" : "error"}</span>
      <button type="button" onClick={state.reload}>
        reload
      </button>
    </div>
  );
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });

  return { promise, resolve, reject };
}

async function settle() {
  for (let index = 0; index < 50; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

describe("useAsyncData", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(async () => {
    window.localStorage.clear();
    document.body.replaceChildren();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root.render(
        <LocaleProvider>
          <AppDataProvider openStorage={async () => createMemoryStorage()}>
            <Probe />
          </AppDataProvider>
        </LocaleProvider>
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  it("loads data after the provider is ready and can reload", async () => {
    await settle();

    expect(container.textContent).toContain("ready");

    act(() => container.querySelector("button")?.click());
    await settle();

    expect(container.textContent).toContain("ready");
  });

  it("hides the previous key's data while the next key loads", async () => {
    const openStorage = async () => createMemoryStorage();
    const first = deferred<string>();
    const second = deferred<string>();
    const loaders = {
      first: () => first.promise,
      second: () => second.promise,
    };

    act(() => {
      root.render(
        <LocaleProvider>
          <AppDataProvider openStorage={openStorage}>
            <KeyProbe dataKey="first" load={loaders.first} />
          </AppDataProvider>
        </LocaleProvider>
      );
    });
    await settle();
    await act(async () => {
      first.resolve("First note");
    });
    await settle();

    expect(container.querySelector('[data-testid="data"]')?.textContent).toBe(
      "First note"
    );

    act(() => {
      root.render(
        <LocaleProvider>
          <AppDataProvider openStorage={openStorage}>
            <KeyProbe dataKey="second" load={loaders.second} />
          </AppDataProvider>
        </LocaleProvider>
      );
    });

    expect(container.querySelector('[data-testid="loading"]')?.textContent).toBe(
      "loading"
    );
    expect(container.querySelector('[data-testid="data"]')?.textContent).toBe("none");
    expect(container.textContent).not.toContain("First note");

    await act(async () => {
      second.resolve("Second note");
    });
    await settle();

    expect(container.querySelector('[data-testid="data"]')?.textContent).toBe(
      "Second note"
    );
  });

  it("ignores a late resolution from the previous key", async () => {
    const openStorage = async () => createMemoryStorage();
    const first = deferred<string>();
    const second = deferred<string>();
    const loaders = {
      first: () => first.promise,
      second: () => second.promise,
    };

    act(() => {
      root.render(
        <LocaleProvider>
          <AppDataProvider openStorage={openStorage}>
            <KeyProbe dataKey="first" load={loaders.first} />
          </AppDataProvider>
        </LocaleProvider>
      );
    });
    await settle();

    act(() => {
      root.render(
        <LocaleProvider>
          <AppDataProvider openStorage={openStorage}>
            <KeyProbe dataKey="second" load={loaders.second} />
          </AppDataProvider>
        </LocaleProvider>
      );
    });
    await settle();

    await act(async () => {
      first.resolve("Late first");
    });
    await settle();

    expect(container.querySelector('[data-testid="loading"]')?.textContent).toBe(
      "loading"
    );
    expect(container.querySelector('[data-testid="data"]')?.textContent).toBe("none");
    expect(container.querySelector('[data-testid="error"]')?.textContent).toBe("clear");

    await act(async () => {
      second.resolve("Second note");
    });
    await settle();

    expect(container.querySelector('[data-testid="data"]')?.textContent).toBe(
      "Second note"
    );
  });

  it("ignores a late rejection from the previous key", async () => {
    const openStorage = async () => createMemoryStorage();
    const first = deferred<string>();
    const second = deferred<string>();
    const loaders = {
      first: () => first.promise,
      second: () => second.promise,
    };

    act(() => {
      root.render(
        <LocaleProvider>
          <AppDataProvider openStorage={openStorage}>
            <KeyProbe dataKey="first" load={loaders.first} />
          </AppDataProvider>
        </LocaleProvider>
      );
    });
    await settle();

    act(() => {
      root.render(
        <LocaleProvider>
          <AppDataProvider openStorage={openStorage}>
            <KeyProbe dataKey="second" load={loaders.second} />
          </AppDataProvider>
        </LocaleProvider>
      );
    });
    await settle();

    await act(async () => {
      first.reject(new Error("old failure"));
    });
    await settle();

    expect(container.querySelector('[data-testid="loading"]')?.textContent).toBe(
      "loading"
    );
    expect(container.querySelector('[data-testid="data"]')?.textContent).toBe("none");
    expect(container.querySelector('[data-testid="error"]')?.textContent).toBe("clear");

    await act(async () => {
      second.resolve("Second note");
    });
    await settle();

    expect(container.querySelector('[data-testid="data"]')?.textContent).toBe(
      "Second note"
    );
    expect(container.querySelector('[data-testid="error"]')?.textContent).toBe("clear");
  });

  it("ignores a late resolution from an earlier same-key reload", async () => {
    const openStorage = async () => createMemoryStorage();
    const first = deferred<string>();
    const second = deferred<string>();
    let calls = 0;
    const load = () => {
      calls += 1;

      return calls === 1 ? first.promise : second.promise;
    };

    act(() => {
      root.render(
        <LocaleProvider>
          <AppDataProvider openStorage={openStorage}>
            <KeyProbe dataKey="same" load={load} />
          </AppDataProvider>
        </LocaleProvider>
      );
    });
    await settle();

    act(() => {
      container.querySelector("button")?.click();
      first.resolve("Late first");
    });
    await settle();

    expect(container.querySelector('[data-testid="loading"]')?.textContent).toBe(
      "loading"
    );
    expect(container.querySelector('[data-testid="data"]')?.textContent).toBe("none");

    await act(async () => {
      second.resolve("Second value");
    });
    await settle();

    expect(container.querySelector('[data-testid="loading"]')?.textContent).toBe("idle");
    expect(container.querySelector('[data-testid="data"]')?.textContent).toBe(
      "Second value"
    );
  });

  it("ignores a late rejection from an earlier same-key reload", async () => {
    const openStorage = async () => createMemoryStorage();
    const first = deferred<string>();
    const second = deferred<string>();
    let calls = 0;
    const load = () => {
      calls += 1;

      return calls === 1 ? first.promise : second.promise;
    };

    act(() => {
      root.render(
        <LocaleProvider>
          <AppDataProvider openStorage={openStorage}>
            <KeyProbe dataKey="same" load={load} />
          </AppDataProvider>
        </LocaleProvider>
      );
    });
    await settle();

    act(() => container.querySelector("button")?.click());
    await settle();

    await act(async () => {
      first.reject(new Error("old same-key failure"));
    });
    await settle();

    expect(container.querySelector('[data-testid="loading"]')?.textContent).toBe(
      "loading"
    );
    expect(container.querySelector('[data-testid="data"]')?.textContent).toBe("none");
    expect(container.querySelector('[data-testid="error"]')?.textContent).toBe("clear");

    await act(async () => {
      second.resolve("Second value");
    });
    await settle();

    expect(container.querySelector('[data-testid="loading"]')?.textContent).toBe("idle");
    expect(container.querySelector('[data-testid="data"]')?.textContent).toBe(
      "Second value"
    );
    expect(container.querySelector('[data-testid="error"]')?.textContent).toBe("clear");
  });

  it("keeps the previous data while the same key reloads", async () => {
    const openStorage = async () => createMemoryStorage();
    const reloaded = deferred<string>();
    let calls = 0;
    const load = () => {
      calls += 1;

      return calls === 1 ? Promise.resolve("First value") : reloaded.promise;
    };

    act(() => {
      root.render(
        <LocaleProvider>
          <AppDataProvider openStorage={openStorage}>
            <KeyProbe dataKey="same" load={load} />
          </AppDataProvider>
        </LocaleProvider>
      );
    });
    await settle();

    expect(container.querySelector('[data-testid="data"]')?.textContent).toBe(
      "First value"
    );

    act(() => container.querySelector("button")?.click());
    await settle();

    expect(container.querySelector('[data-testid="loading"]')?.textContent).toBe(
      "loading"
    );
    expect(container.querySelector('[data-testid="data"]')?.textContent).toBe(
      "First value"
    );

    await act(async () => {
      reloaded.resolve("Reloaded value");
    });
    await settle();

    expect(container.querySelector('[data-testid="data"]')?.textContent).toBe(
      "Reloaded value"
    );
  });
});
