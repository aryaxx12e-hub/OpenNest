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
});
