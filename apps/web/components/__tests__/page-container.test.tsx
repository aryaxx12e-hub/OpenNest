import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { PageContainer } from "../page-container";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | undefined;
let root: ReturnType<typeof createRoot> | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

describe("PageContainer", () => {
  it("renders the standard column and lets a screen override the width", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        <PageContainer className="max-w-5xl">
          <p>Content</p>
        </PageContainer>
      );
    });

    const wrapper = container.firstElementChild as HTMLElement;

    expect(wrapper.className).toContain("max-w-5xl");
    expect(wrapper.className).not.toContain("max-w-6xl");
    expect(wrapper.textContent).toBe("Content");
  });
});
