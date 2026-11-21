import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isNativeApp, useIsNativeApp } from "../native";
import { unregisterServiceWorkers } from "../pwa";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  delete window.Capacitor;
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: undefined,
  });
});

function PlatformProbe() {
  return <span>{useIsNativeApp() ? "native" : "web"}</span>;
}

describe("native platform detection", () => {
  it("treats a plain browser as web", () => {
    expect(isNativeApp()).toBe(false);
  });

  it("detects the Capacitor native bridge", () => {
    window.Capacitor = { isNativePlatform: () => true };

    expect(isNativeApp()).toBe(true);
  });

  it("exposes the native state to components", () => {
    window.Capacitor = { isNativePlatform: () => true };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(<PlatformProbe />);
    });

    expect(container.textContent).toBe("native");

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});

describe("service worker cleanup", () => {
  it("unregisters every service worker registration", async () => {
    const first = { unregister: vi.fn(async () => true) };
    const second = { unregister: vi.fn(async () => true) };
    const registrations = [first, second];

    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistrations: async () => registrations,
      },
    });

    await unregisterServiceWorkers();

    expect(first.unregister).toHaveBeenCalledTimes(1);
    expect(second.unregister).toHaveBeenCalledTimes(1);
  });

  it("does nothing when service workers are unavailable", async () => {
    await expect(unregisterServiceWorkers()).resolves.toBeUndefined();
  });
});
