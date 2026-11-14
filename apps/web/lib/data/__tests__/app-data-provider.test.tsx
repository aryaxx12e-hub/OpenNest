import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryStorage, type StorageAdapter } from "@opennest/core";
import { LocaleProvider } from "@opennest/localization";

import { AppDataProvider, useAppData, useAppRevision } from "../app-data-provider";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  const data = useAppData();
  const revision = useAppRevision();

  return (
    <div>
      <span data-testid="workspace">{data.workspace.name}</span>
      <span data-testid="revision">{revision}</span>
      <button type="button" onClick={data.invalidate}>
        refresh
      </button>
    </div>
  );
}

function mount(openStorage: () => Promise<StorageAdapter>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root: Root = createRoot(container);

  act(() => {
    root.render(
      <LocaleProvider>
        <AppDataProvider openStorage={openStorage}>
          <Probe />
        </AppDataProvider>
      </LocaleProvider>
    );
  });

  return { container, root };
}

async function settle() {
  for (let index = 0; index < 50; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

describe("AppDataProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.replaceChildren();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("opens storage, ensures the workspace, and exposes services", async () => {
    const storage = createMemoryStorage();
    const { container, root } = mount(async () => storage);

    await settle();

    expect(container.textContent).toContain("My Library");
    expect(container.textContent).toContain("0");

    const button = container.querySelector("button");
    act(() => button?.click());

    expect(container.textContent).toContain("1");

    act(() => root.unmount());
  });

  it("shows a recoverable error when browser storage cannot open", async () => {
    const { container, root } = mount(async () => {
      throw new Error("blocked");
    });

    await settle();

    expect(container.textContent).toContain("Your library could not be opened");

    act(() => root.unmount());
  });
});
