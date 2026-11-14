import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@opennest/localization";

import type { PwaContainer, PwaRegistration, PwaWorker } from "@/lib/pwa";

import { ConnectionStatus } from "../connection-status";
import { OfflineView } from "../offline-view";
import { ServiceWorkerUpdate } from "../service-worker-update";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function settle() {
  for (let index = 0; index < 20; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

class FakeWorker extends EventTarget implements PwaWorker {
  state = "installing";
  readonly messages: unknown[] = [];

  postMessage(message: unknown) {
    this.messages.push(message);
  }
}

class FakeRegistration extends EventTarget implements PwaRegistration {
  waiting: PwaWorker | null = null;
  installing: PwaWorker | null = null;
  readonly update = vi.fn(async () => undefined);
}

class FakeContainer extends EventTarget implements PwaContainer {
  controller: PwaWorker | null = null;
  readonly registration = new FakeRegistration();
  readonly register = vi.fn(async () => this.registration);
}

function mount(node: ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root!.render(<LocaleProvider>{node}</LocaleProvider>);
  });

  return container;
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text
  );

  if (button === undefined) {
    throw new Error(`No button named ${text}`);
  }

  return button;
}

afterEach(() => {
  if (root !== undefined) {
    act(() => root?.unmount());
    root = undefined;
  }

  container?.remove();
  container = undefined;
  Reflect.deleteProperty(window.navigator, "onLine");
});

describe("ConnectionStatus", () => {
  it("announces online and offline changes", async () => {
    let online = true;

    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      get: () => online,
    });

    const host = mount(<ConnectionStatus />);

    await settle();
    expect(host.textContent).toContain("Online");

    online = false;
    act(() => window.dispatchEvent(new Event("offline")));
    await settle();
    expect(host.textContent).toContain("Offline");

    online = true;
    act(() => window.dispatchEvent(new Event("online")));
    await settle();
    expect(host.textContent).toContain("Online");
  });
});

describe("OfflineView", () => {
  it("offers a saved-library route and a retry action", () => {
    const host = mount(<OfflineView />);

    expect(host.textContent).toContain("You're offline.");
    expect(host.querySelector('a[href="/library"]')?.textContent).toContain(
      "Open library"
    );
    expect(buttonByText(host, "Try again")).toBeTruthy();
  });
});

describe("ServiceWorkerUpdate", () => {
  it("registers quietly on a first install and does not prompt", async () => {
    const container = new FakeContainer();
    const host = mount(
      <ServiceWorkerUpdate enabled container={container} reload={vi.fn()} />
    );

    await settle();

    expect(container.register).toHaveBeenCalledWith("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });

    const installing = new FakeWorker();
    container.registration.installing = installing;

    act(() => container.registration.dispatchEvent(new Event("updatefound")));
    act(() => {
      installing.state = "installed";
      installing.dispatchEvent(new Event("statechange"));
    });

    await settle();

    expect(host.textContent).not.toContain("A new version is ready.");
  });

  it("only activates a waiting update after the user confirms", async () => {
    const container = new FakeContainer();
    const reload = vi.fn();
    const host = mount(
      <ServiceWorkerUpdate enabled container={container} reload={reload} />
    );

    await settle();

    container.controller = new FakeWorker();
    const waiting = new FakeWorker();
    const installing = new FakeWorker();
    container.registration.waiting = waiting;
    container.registration.installing = installing;

    act(() => container.registration.dispatchEvent(new Event("updatefound")));
    act(() => {
      installing.state = "installed";
      installing.dispatchEvent(new Event("statechange"));
    });

    await settle();
    expect(host.textContent).toContain("A new version is ready.");
    expect(waiting.messages).toEqual([]);

    act(() => buttonByText(host, "Refresh").click());

    expect(waiting.messages).toEqual([{ type: "SKIP_WAITING" }]);
    expect(reload).not.toHaveBeenCalled();

    act(() => container.dispatchEvent(new Event("controllerchange")));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("can defer the update", async () => {
    const container = new FakeContainer();
    const host = mount(
      <ServiceWorkerUpdate enabled container={container} reload={vi.fn()} />
    );

    await settle();

    container.controller = new FakeWorker();
    const waiting = new FakeWorker();
    container.registration.waiting = waiting;
    const installing = new FakeWorker();
    container.registration.installing = installing;

    act(() => container.registration.dispatchEvent(new Event("updatefound")));
    act(() => {
      installing.state = "installed";
      installing.dispatchEvent(new Event("statechange"));
    });

    await settle();
    act(() => buttonByText(host, "Later").click());
    await settle();

    expect(host.textContent).not.toContain("A new version is ready.");
    expect(waiting.messages).toEqual([]);
  });
});
