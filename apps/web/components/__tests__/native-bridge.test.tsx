import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const plugins = vi.hoisted(() => ({
  setStyle: vi.fn(async () => undefined),
  addListener: vi.fn(async () => ({ remove: vi.fn(async () => undefined) })),
  exitApp: vi.fn(async () => undefined),
}));

vi.mock("@capacitor/core", () => ({
  SystemBars: { setStyle: plugins.setStyle },
  SystemBarsStyle: { Dark: "DARK", Light: "LIGHT" },
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: plugins.addListener,
    exitApp: plugins.exitApp,
  },
}));

import { handleBackNavigation, NativeBridge } from "../native-bridge";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function settle() {
  for (let index = 0; index < 10; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(() => {
  plugins.setStyle.mockClear();
  plugins.addListener.mockClear();
  plugins.exitApp.mockClear();
  document.documentElement.className = "";
  window.Capacitor = { isNativePlatform: () => true };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  delete window.Capacitor;
  document.querySelectorAll("dialog").forEach((dialog) => dialog.remove());
});

describe("native back navigation", () => {
  it("closes the top dialog before leaving the page", () => {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    const close = vi.spyOn(dialog, "close").mockImplementation(() => undefined);
    document.body.append(dialog);

    const result = handleBackNavigation(() => undefined);

    expect(result).toBe("dialog");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("does not close a busy dialog", () => {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    dialog.setAttribute("aria-busy", "true");
    const close = vi.spyOn(dialog, "close").mockImplementation(() => undefined);
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    Object.defineProperty(window.history, "length", {
      configurable: true,
      value: 2,
    });
    document.body.append(dialog);

    const result = handleBackNavigation(() => undefined);

    expect(result).toBe("history");
    expect(close).not.toHaveBeenCalled();
    expect(back).toHaveBeenCalled();
  });

  it("exits the app at the root", () => {
    const exit = vi.fn();
    Object.defineProperty(window.history, "length", {
      configurable: true,
      value: 1,
    });

    expect(handleBackNavigation(exit)).toBe("exit");
    expect(exit).toHaveBeenCalledTimes(1);
  });
});

describe("NativeBridge", () => {
  it("sets system bar style and listens for Android back", async () => {
    act(() => {
      root!.render(<NativeBridge />);
    });

    await settle();

    expect(plugins.setStyle).toHaveBeenCalledWith({ style: "LIGHT" });
    expect(plugins.addListener).toHaveBeenCalledWith("backButton", expect.any(Function));
  });
});
