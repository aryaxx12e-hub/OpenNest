import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ExtensionError,
  type ExtensionUiNode,
  type StoredExtension,
} from "@opennest/extensions";
import { LocaleProvider } from "@opennest/localization";

import type { ExtensionSessionStatus } from "@/lib/extensions/session";

import { ExtensionRunner, type ExtensionRunnerRuntime } from "../extension-runner";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

const TREE: ExtensionUiNode = {
  type: "stack",
  children: [
    { type: "heading", text: "Summary" },
    { type: "button", id: "refresh", label: "Refresh" },
  ],
};

function record(): StoredExtension {
  return {
    id: "com.example.demo",
    manifest: {
      id: "com.example.demo",
      name: "Demo extension",
      version: "1.0.0",
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
    enabled: true,
  };
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

function createRuntime(options: { fail?: unknown; statusError?: boolean } = {}) {
  const calls = {
    actions: [] as string[],
    stopped: 0,
  };
  let sessionStatus: ExtensionSessionStatus = "running";
  const runtime: ExtensionRunnerRuntime = {
    registry: {
      async get() {
        return record();
      },
    },
    async start(id, handlers) {
      if (options.fail !== undefined) {
        throw options.fail;
      }

      handlers?.onStatus?.({ status: "starting" });
      sessionStatus = "running";
      handlers?.onStatus?.({ status: "running" });

      if (options.statusError === true) {
        sessionStatus = "error";
        handlers?.onStatus?.({ status: "error", code: "protocol_error" });
      } else {
        handlers?.onUi?.(TREE);
      }

      return {
        extensionId: id,
        sessionId: "session-1",
        get status() {
          return sessionStatus;
        },
        async start() {
          return undefined;
        },
        async stop() {
          sessionStatus = "stopped";
        },
        async action(actionId) {
          calls.actions.push(actionId);
        },
        async handleWorkerMessage() {
          return { ok: true as const };
        },
      };
    },
    async stop() {
      calls.stopped += 1;
      sessionStatus = "stopped";
    },
    async action(actionId) {
      calls.actions.push(actionId);
    },
  };

  return { runtime, calls };
}

async function renderRunner(runtime: ExtensionRunnerRuntime) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root!.render(
      <LocaleProvider>
        <ExtensionRunner extensionId="com.example.demo" extensions={runtime} />
      </LocaleProvider>
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
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

describe("ExtensionRunner", () => {
  it("starts the extension, renders its surface, and forwards actions", async () => {
    const { runtime, calls } = createRuntime();
    const host = await renderRunner(runtime);

    await waitForText(host, "Running");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).toContain("Demo extension");
    expect(host.textContent).toContain("Summary");
    expect(host.querySelector("section")?.getAttribute("aria-label")).toBe(
      "Extension output"
    );

    await act(async () => {
      buttonByText(host, "Refresh").click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(calls.actions).toEqual(["refresh"]);
    expect(buttonByText(host, "Refresh").disabled).toBe(false);
  });

  it("stops the session from the page control", async () => {
    const { runtime, calls } = createRuntime();
    const host = await renderRunner(runtime);

    await waitForText(host, "Running");
    act(() => buttonByText(host, "Stop extension").click());
    await waitForText(host, "Stopped");

    expect(calls.stopped).toBe(1);
  });

  it("maps session error codes to a localized message", async () => {
    const { runtime } = createRuntime({ statusError: true });
    const host = await renderRunner(runtime);

    await waitForText(host, "The extension sent an invalid request.");
  });

  it("maps start failures to a localized message", async () => {
    const { runtime } = createRuntime({
      fail: new ExtensionError("extension_disabled", "Disabled"),
    });
    const host = await renderRunner(runtime);

    await waitForText(host, "This extension is disabled. Enable it before running.");
  });
});
