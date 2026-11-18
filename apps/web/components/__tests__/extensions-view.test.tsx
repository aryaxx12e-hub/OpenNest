import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EXTENSION_MAX_PACKAGE_BYTES, type StoredExtension } from "@opennest/extensions";
import { LocaleProvider } from "@opennest/localization";

import { ExtensionsView, type ExtensionsViewRuntime } from "../extensions-view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const scope =
    Array.from(host.querySelectorAll("dialog")).find((dialog) => dialog.open) ?? host;
  const button = Array.from(scope.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`No button named ${text}`);
  }

  return button;
}

function record(enabled = true): StoredExtension {
  return {
    id: "com.example.demo",
    manifest: {
      id: "com.example.demo",
      name: "Demo extension",
      version: "1.2.0",
      publisher: "Example",
      description: "A demo extension.",
      tier: 1,
      entry: "index.js",
      capabilities: ["workspace.read.metadata"],
      dataScopes: ["notes"],
      networkOrigins: [],
      minHostVersion: "0.1.0",
    },
    code: "opennest.ready();",
    integrity: `sha256:${"0".repeat(64)}`,
    installedAt: 1,
    updatedAt: 1,
    enabled,
  };
}

function createRuntime(initial: StoredExtension[] = []) {
  const records = [...initial];
  const calls = {
    enabled: [] as { id: string; enabled: boolean }[],
    uninstalled: [] as string[],
    prepared: 0,
    safeMode: false,
  };
  const runtime: ExtensionsViewRuntime = {
    registry: {
      async list() {
        return records.map((item) => ({ ...item }));
      },
      async prepareInstall() {
        calls.prepared += 1;
        throw new Error("Not used in this test.");
      },
      async install() {
        throw new Error("Not used in this test.");
      },
    },
    async setEnabled(id, enabled) {
      calls.enabled.push({ id, enabled });
      const existing = records.find((item) => item.id === id);

      if (existing === undefined) {
        throw new Error("Missing record.");
      }

      const updated = { ...existing, enabled };
      records.splice(records.indexOf(existing), 1, updated);
      return updated;
    },
    async uninstall(id) {
      calls.uninstalled.push(id);
      const index = records.findIndex((item) => item.id === id);

      if (index >= 0) {
        records.splice(index, 1);
      }
    },
    async setSafeMode(enabled) {
      calls.safeMode = enabled;
    },
    async getSafeMode() {
      return calls.safeMode;
    },
  };

  return { runtime, calls };
}

function renderView(runtime: ExtensionsViewRuntime) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root!.render(
      <LocaleProvider>
        <ExtensionsView extensions={runtime} />
      </LocaleProvider>
    );
  });

  return container;
}

async function waitForText(host: HTMLElement, text: string) {
  for (let index = 0; index < 500; index += 1) {
    if (host.textContent?.includes(text) === true) {
      return;
    }

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }

  throw new Error(`Timed out waiting for ${text}`);
}

async function waitFor(check: () => boolean) {
  for (let index = 0; index < 500; index += 1) {
    if (check()) {
      return;
    }

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }

  throw new Error("Timed out waiting for condition");
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

describe("ExtensionsView", () => {
  it("shows the empty state and safe mode control", async () => {
    const { runtime } = createRuntime();
    const host = renderView(runtime);

    await waitForText(host, "No extensions installed");

    expect(host.textContent).toContain("Safe mode");
    expect(host.textContent).toContain("Turn on safe mode");
  });

  it("rejects oversized files before reading them", async () => {
    const { runtime, calls } = createRuntime();
    const host = renderView(runtime);

    await waitForText(host, "No extensions installed");

    const input = host.querySelector('input[type="file"]');

    if (!(input instanceof HTMLInputElement)) {
      throw new Error("No file input");
    }

    const file = new File(
      [new Uint8Array(EXTENSION_MAX_PACKAGE_BYTES + 1)],
      "oversized.opennest-extension.json",
      { type: "application/json" }
    );
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await waitForText(host, "The extension package is too large.");
    expect(calls.prepared).toBe(0);
  });

  it("lists extensions and toggles or uninstalls them", async () => {
    const { runtime, calls } = createRuntime([record()]);
    const host = renderView(runtime);

    await waitForText(host, "Demo extension");
    expect(host.textContent).toContain("1.2.0");
    expect(host.textContent).toContain("Example");
    expect(host.textContent).toContain("Read workspace metadata");

    const checkbox = host.querySelector('input[type="checkbox"]');

    if (!(checkbox instanceof HTMLInputElement)) {
      throw new Error("No enabled checkbox");
    }

    act(() => checkbox.click());
    await waitFor(() => calls.enabled.length === 1);
    expect(calls.enabled[0]).toEqual({ id: "com.example.demo", enabled: false });
    await waitFor(() => buttonByText(host, "Uninstall").disabled === false);

    act(() => buttonByText(host, "Uninstall").click());
    await waitForText(host, "Uninstall this extension?");
    const confirmUninstall = buttonByText(host, "Uninstall extension");
    expect(confirmUninstall.disabled).toBe(false);
    expect(host.querySelectorAll("dialog[open]").length).toBe(1);
    act(() => confirmUninstall.click());
    await waitFor(() => calls.uninstalled.length === 1);
    expect(calls.uninstalled[0]).toBe("com.example.demo");
    await waitForText(host, "No extensions installed");
  });

  it("turns safe mode on and off", async () => {
    const { runtime, calls } = createRuntime();
    const host = renderView(runtime);

    await waitForText(host, "Turn on safe mode");
    act(() => buttonByText(host, "Turn on safe mode").click());
    await waitForText(host, "Safe mode is on.");
    expect(calls.safeMode).toBe(true);

    act(() => buttonByText(host, "Turn off safe mode").click());
    await waitForText(host, "Safe mode is off.");
    expect(calls.safeMode).toBe(false);
  });
});
