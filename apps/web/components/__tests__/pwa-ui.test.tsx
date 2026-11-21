import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryStorage } from "@opennest/core";
import { LocaleProvider } from "@opennest/localization";

import { clearNoteDraft, writeNoteDraft } from "@/lib/autosave/draft-journal";
import {
  createSaveCoordinator,
  type SaveCoordinator,
} from "@/lib/autosave/save-coordinator";
import { AppDataProvider, useAppData } from "@/lib/data/app-data-provider";
import { SaveCoordinatorProvider } from "@/lib/data/save-coordinator";
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

function mount(node: ReactNode, coordinator?: SaveCoordinator) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root!.render(
      <LocaleProvider>
        <SaveCoordinatorProvider coordinator={coordinator}>
          {node}
        </SaveCoordinatorProvider>
      </LocaleProvider>
    );
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

beforeEach(() => {
  window.localStorage.clear();
});

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

  it("does not register the service worker on native", async () => {
    window.Capacitor = { isNativePlatform: () => true };
    const container = new FakeContainer();
    mount(<ServiceWorkerUpdate enabled container={container} reload={vi.fn()} />);

    await settle();

    expect(container.register).not.toHaveBeenCalled();
    delete window.Capacitor;
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
    await settle();

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

  it("waits for pending saves before activating the update", async () => {
    const container = new FakeContainer();
    const coordinator = createSaveCoordinator();
    let dirty = true;
    let resolveFlush: () => void = () => undefined;
    const flush = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveFlush = resolve;
        })
    );
    coordinator.register({ id: "note", flush, isDirty: () => dirty });
    const reload = vi.fn();
    const host = mount(
      <ServiceWorkerUpdate enabled container={container} reload={reload} />,
      coordinator
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

    act(() => buttonByText(host, "Refresh").click());
    await settle();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(waiting.messages).toEqual([]);

    await act(async () => {
      dirty = false;
      resolveFlush();
      await Promise.resolve();
    });
    await settle();

    expect(waiting.messages).toEqual([{ type: "SKIP_WAITING" }]);

    act(() => container.dispatchEvent(new Event("controllerchange")));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not activate the update when saving fails", async () => {
    const container = new FakeContainer();
    const coordinator = createSaveCoordinator();
    coordinator.register({
      id: "note",
      flush: async () => Promise.reject(new Error("disk full")),
      isDirty: () => true,
    });
    const host = mount(
      <ServiceWorkerUpdate enabled container={container} reload={vi.fn()} />,
      coordinator
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

    act(() => buttonByText(host, "Refresh").click());
    await settle();

    expect(waiting.messages).toEqual([]);
    expect(host.textContent).toContain(
      "Could not save before updating. Try again before refreshing."
    );
  });

  it("does not activate the update when a draft is still in the journal", async () => {
    writeNoteDraft(window.localStorage, {
      version: 1,
      workspaceId: "workspace-1",
      noteId: "note-1",
      title: "Draft title",
      content: "Unsaved content",
      baseUpdatedAt: "2026-11-14T10:00:00.000Z",
      savedAt: Date.now(),
    });

    const container = new FakeContainer();
    const host = mount(
      <ServiceWorkerUpdate
        enabled
        container={container}
        reload={vi.fn()}
        classifyDrafts={async (drafts) =>
          drafts.map((draft) => ({ draft, exists: true }))
        }
      />
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

    act(() => buttonByText(host, "Refresh").click());
    await settle();

    expect(waiting.messages).toEqual([]);
    expect(host.textContent).toContain(
      "Open these notes to save or discard their recovery drafts before refreshing."
    );
  });

  it("downloads and discards an orphan draft before activating", async () => {
    writeNoteDraft(window.localStorage, {
      version: 1,
      workspaceId: "workspace-1",
      noteId: "note-1",
      title: "Draft title",
      content: "Unsaved content",
      baseUpdatedAt: "2026-11-14T10:00:00.000Z",
      savedAt: Date.now(),
    });

    const container = new FakeContainer();
    const clearDraft = vi.fn(async (workspaceId: string, noteId: string) =>
      clearNoteDraft(window.localStorage, workspaceId, noteId)
    );
    const download = vi.fn();
    const host = mount(
      <ServiceWorkerUpdate
        enabled
        container={container}
        reload={vi.fn()}
        classifyDrafts={async (drafts) =>
          drafts.map((draft) => ({ draft, exists: false }))
        }
        clearDraft={clearDraft}
        download={download}
      />
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

    act(() => buttonByText(host, "Refresh").click());
    await settle();

    expect(host.textContent).toContain(
      "These drafts belong to notes that no longer exist."
    );

    act(() => buttonByText(host, "Export").click());
    expect(download).toHaveBeenCalledTimes(1);

    act(() => buttonByText(host, "Discard").click());
    await settle();
    act(() => buttonByText(host, "Discard draft").click());
    await settle();

    expect(clearDraft).toHaveBeenCalledWith("workspace-1", "note-1");
    expect(waiting.messages).toEqual([{ type: "SKIP_WAITING" }]);
  });

  it("discards only the selected orphan draft", async () => {
    writeNoteDraft(window.localStorage, {
      version: 1,
      workspaceId: "workspace-1",
      noteId: "note-1",
      title: "First draft",
      content: "First content",
      baseUpdatedAt: "2026-11-14T10:00:00.000Z",
      savedAt: Date.now(),
    });
    writeNoteDraft(window.localStorage, {
      version: 1,
      workspaceId: "workspace-1",
      noteId: "note-2",
      title: "Second draft",
      content: "Second content",
      baseUpdatedAt: "2026-11-14T10:00:00.000Z",
      savedAt: Date.now(),
    });

    const container = new FakeContainer();
    const clearDraft = vi.fn(async (workspaceId: string, noteId: string) =>
      clearNoteDraft(window.localStorage, workspaceId, noteId)
    );
    const host = mount(
      <ServiceWorkerUpdate
        enabled
        container={container}
        reload={vi.fn()}
        classifyDrafts={async (drafts) =>
          drafts.map((draft) => ({ draft, exists: false }))
        }
        clearDraft={clearDraft}
      />
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

    act(() => buttonByText(host, "Refresh").click());
    await settle();

    expect(host.textContent).toContain("First draft");
    expect(host.textContent).toContain("Second draft");

    act(() => buttonByText(host, "Discard").click());
    await settle();
    act(() => buttonByText(host, "Discard draft").click());
    await settle();

    expect(clearDraft).toHaveBeenCalledTimes(1);
    expect(clearDraft).toHaveBeenCalledWith("workspace-1", "note-1");
    expect(waiting.messages).toEqual([]);
    expect(host.textContent).not.toContain("First draft");
    expect(host.textContent).toContain("Second draft");

    act(() => buttonByText(host, "Discard").click());
    await settle();
    act(() => buttonByText(host, "Discard draft").click());
    await settle();

    expect(clearDraft).toHaveBeenCalledTimes(2);
    expect(clearDraft).toHaveBeenLastCalledWith("workspace-1", "note-2");
    expect(waiting.messages).toEqual([{ type: "SKIP_WAITING" }]);
  });

  it("refreshes the recovery list after a note change", async () => {
    writeNoteDraft(window.localStorage, {
      version: 1,
      workspaceId: "workspace-1",
      noteId: "note-1",
      title: "Draft title",
      content: "Unsaved content",
      baseUpdatedAt: "2026-11-14T10:00:00.000Z",
      savedAt: Date.now(),
    });

    function InvalidateButton() {
      const { invalidate } = useAppData();

      return (
        <button type="button" onClick={invalidate}>
          mark changed
        </button>
      );
    }

    const container = new FakeContainer();
    const host = mount(
      <AppDataProvider openStorage={async () => createMemoryStorage()}>
        <ServiceWorkerUpdate
          enabled
          container={container}
          reload={vi.fn()}
          classifyDrafts={async (drafts) =>
            drafts.map((draft) => ({ draft, exists: false }))
          }
        />
        <InvalidateButton />
      </AppDataProvider>
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

    act(() => buttonByText(host, "Refresh").click());
    await settle();

    expect(host.textContent).toContain("Draft title");

    clearNoteDraft(window.localStorage, "workspace-1", "note-1");
    act(() => buttonByText(host, "mark changed").click());
    await settle();

    expect(host.textContent).not.toContain("Draft title");
    expect(waiting.messages).toEqual([]);
  });

  it("reports a requestUpdate failure as an update error", async () => {
    const container = new FakeContainer();
    const host = mount(
      <ServiceWorkerUpdate enabled container={container} reload={vi.fn()} />
    );

    await settle();

    container.controller = new FakeWorker();
    const waiting = new FakeWorker();
    const installing = new FakeWorker();
    waiting.postMessage = () => {
      throw new Error("cannot message the worker");
    };
    container.registration.waiting = waiting;
    container.registration.installing = installing;

    act(() => container.registration.dispatchEvent(new Event("updatefound")));
    act(() => {
      installing.state = "installed";
      installing.dispatchEvent(new Event("statechange"));
    });
    await settle();

    act(() => buttonByText(host, "Refresh").click());
    await settle();

    expect(host.textContent).toContain("Could not start the update.");
    expect(host.textContent).not.toContain("Could not save before updating.");
  });

  it("offers recovery when note classification fails", async () => {
    writeNoteDraft(window.localStorage, {
      version: 1,
      workspaceId: "workspace-1",
      noteId: "note-1",
      title: "Draft title",
      content: "Unsaved content",
      baseUpdatedAt: "2026-11-14T10:00:00.000Z",
      savedAt: Date.now(),
    });

    const container = new FakeContainer();
    const clearDraft = vi.fn(async (workspaceId: string, noteId: string) =>
      clearNoteDraft(window.localStorage, workspaceId, noteId)
    );
    const host = mount(
      <ServiceWorkerUpdate
        enabled
        container={container}
        reload={vi.fn()}
        classifyDrafts={async () => Promise.reject(new Error("lookup failed"))}
        clearDraft={clearDraft}
      />
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

    act(() => buttonByText(host, "Refresh").click());
    await settle();

    expect(host.textContent).toContain("Some notes could not be verified.");
    expect(
      Array.from(host.querySelectorAll("button")).some(
        (button) => button.textContent === "Export"
      )
    ).toBe(true);

    act(() => buttonByText(host, "Discard").click());
    await settle();
    act(() => buttonByText(host, "Discard draft").click());
    await settle();

    expect(clearDraft).toHaveBeenCalledWith("workspace-1", "note-1");
    expect(waiting.messages).toEqual([{ type: "SKIP_WAITING" }]);
  });

  it("reports a draft clear failure and keeps the update waiting", async () => {
    writeNoteDraft(window.localStorage, {
      version: 1,
      workspaceId: "workspace-1",
      noteId: "note-1",
      title: "Draft title",
      content: "Unsaved content",
      baseUpdatedAt: "2026-11-14T10:00:00.000Z",
      savedAt: Date.now(),
    });

    const container = new FakeContainer();
    const host = mount(
      <ServiceWorkerUpdate
        enabled
        container={container}
        reload={vi.fn()}
        classifyDrafts={async (drafts) =>
          drafts.map((draft) => ({ draft, exists: false }))
        }
        clearDraft={async () => false}
      />
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

    act(() => buttonByText(host, "Refresh").click());
    await settle();

    act(() => buttonByText(host, "Discard").click());
    await settle();
    act(() => buttonByText(host, "Discard draft").click());
    await settle();

    expect(host.textContent).toContain("Could not discard this draft. Try again.");
    expect(waiting.messages).toEqual([]);
  });

  it("reports an unreadable-journal clear failure and keeps the update waiting", async () => {
    const container = new FakeContainer();
    const host = mount(
      <ServiceWorkerUpdate
        enabled
        container={container}
        reload={vi.fn()}
        readDrafts={async () => ({ ok: false, error: new Error("blocked") })}
        clearDrafts={async () => ({ removed: 0, failed: 1 })}
      />
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

    act(() => buttonByText(host, "Refresh").click());
    await settle();

    act(() => buttonByText(host, "Clear draft data").click());
    await settle();
    act(() => buttonByText(host, "Clear data").click());
    await settle();

    expect(host.textContent).toContain("Draft data could not be cleared.");
    expect(waiting.messages).toEqual([]);
  });

  it("links to an existing note instead of offering discard", async () => {
    writeNoteDraft(window.localStorage, {
      version: 1,
      workspaceId: "workspace-1",
      noteId: "note-1",
      title: "Draft title",
      content: "Unsaved content",
      baseUpdatedAt: "2026-11-14T10:00:00.000Z",
      savedAt: Date.now(),
    });

    const container = new FakeContainer();
    const host = mount(
      <ServiceWorkerUpdate
        enabled
        container={container}
        reload={vi.fn()}
        classifyDrafts={async (drafts) =>
          drafts.map((draft) => ({ draft, exists: true }))
        }
      />
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

    act(() => buttonByText(host, "Refresh").click());
    await settle();

    expect(host.querySelector('a[href="/notes?noteId=note-1"]')?.textContent).toContain(
      "Open note"
    );
    expect(
      Array.from(host.querySelectorAll("button")).some(
        (button) => button.textContent === "Discard"
      )
    ).toBe(false);
  });

  it("clears an unreadable journal before activating", async () => {
    const container = new FakeContainer();
    const clearDrafts = vi.fn(async () => ({ removed: 1, failed: 0 }));
    const readDrafts = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: new Error("blocked") })
      .mockResolvedValue({ ok: true, drafts: [] });
    const host = mount(
      <ServiceWorkerUpdate
        enabled
        container={container}
        reload={vi.fn()}
        readDrafts={readDrafts}
        clearDrafts={clearDrafts}
      />
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

    act(() => buttonByText(host, "Refresh").click());
    await settle();

    act(() => buttonByText(host, "Clear draft data").click());
    await settle();
    act(() => buttonByText(host, "Clear data").click());
    await settle();

    expect(clearDrafts).toHaveBeenCalledTimes(1);
    expect(readDrafts).toHaveBeenCalledTimes(2);
    expect(waiting.messages).toEqual([{ type: "SKIP_WAITING" }]);
  });

  it("does not activate the update when the journal cannot be read", async () => {
    const container = new FakeContainer();
    const host = mount(
      <ServiceWorkerUpdate
        enabled
        container={container}
        reload={vi.fn()}
        readDrafts={async () => ({ ok: false, error: new Error("blocked") })}
      />
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

    act(() => buttonByText(host, "Refresh").click());
    await settle();

    expect(waiting.messages).toEqual([]);
    expect(host.textContent).toContain(
      "Could not check drafts on this device. Try again before refreshing."
    );
  });
});
