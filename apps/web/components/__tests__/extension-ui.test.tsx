import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExtensionUiNode } from "@opennest/extensions";
import { LocaleProvider } from "@opennest/localization";

import { ExtensionUiSurface } from "../extension-ui";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function renderUi(tree: ExtensionUiNode, onAction: (actionId: string) => void) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root!.render(
      <LocaleProvider>
        <ExtensionUiSurface tree={tree} onAction={onAction} />
      </LocaleProvider>
    );
  });

  return container;
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`No button named ${text}`);
  }

  return button;
}

beforeEach(() => {
  window.localStorage.clear();
  document.body.replaceChildren();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.replaceChildren();
  root = undefined;
  container = undefined;
});

describe("ExtensionUiSurface", () => {
  it("renders the safe tree and reports button actions", () => {
    const onAction = vi.fn();
    const host = renderUi(
      {
        type: "stack",
        children: [
          { type: "heading", text: "Summary" },
          { type: "button", id: "refresh", label: "Refresh" },
        ],
      },
      onAction
    );

    expect(host.textContent).toContain("Summary");
    act(() => buttonByText(host, "Refresh").click());

    expect(onAction).toHaveBeenCalledWith("refresh");
  });

  it("renders extension text as text, never as HTML", () => {
    const host = renderUi(
      {
        type: "text",
        text: '<img src="x" onerror="alert(1)"><script>alert(1)</script>',
      },
      () => undefined
    );

    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("script")).toBeNull();
    expect(host.textContent).toContain("<img");
  });

  it("keeps disabled buttons inert", () => {
    const onAction = vi.fn();
    const host = renderUi(
      {
        type: "button",
        id: "refresh",
        label: "Refresh",
        disabled: true,
      },
      onAction
    );

    act(() => buttonByText(host, "Refresh").click());

    expect(onAction).not.toHaveBeenCalled();
  });
});
