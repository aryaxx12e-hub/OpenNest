import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryStorage, type IsoDate } from "@opennest/core";
import { LocaleProvider } from "@opennest/localization";

import { AppDataProvider } from "@/lib/data/app-data-provider";
import { SaveCoordinatorProvider } from "@/lib/data/save-coordinator";
import { createAppServices, sha256Hex } from "@/lib/data/services";

import { NoteEditor } from "../note-editor";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/notes/note-1",
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AT = "2026-11-13T12:34:56.000Z" as IsoDate;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function settle() {
  for (let index = 0; index < 40; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

async function waitForDraft() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 230));
  });
}

function change(element: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value"
  )?.set;

  act(() => {
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
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
  vi.restoreAllMocks();
});

describe("NoteEditor", () => {
  it("shows a truthful warning when the recovery draft cannot be written", async () => {
    const storage = createMemoryStorage();
    const { services, workspace } = await createAppServices(storage, {
      defaultWorkspaceName: "My Library",
      clock: () => AT,
      hash: sha256Hex,
      generateBlobKey: () => "44444444-4444-4444-8444-444444444444",
    });
    const note = await services.note.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "A note",
      content: "Start",
    });

    const originalSetItem = Storage.prototype.setItem;

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      if (key.startsWith("opennest:draft:note:")) {
        throw new Error("blocked");
      }

      originalSetItem.call(this, key, value);
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        <LocaleProvider>
          <AppDataProvider openStorage={async () => storage}>
            <SaveCoordinatorProvider>
              <NoteEditor noteId={note.id} />
            </SaveCoordinatorProvider>
          </AppDataProvider>
        </LocaleProvider>
      );
    });

    await settle();

    const editor = container.querySelector(
      'textarea[aria-label="Write"]'
    ) as HTMLTextAreaElement | null;

    expect(editor).not.toBeNull();

    change(editor!, "Draft that cannot persist");
    await waitForDraft();

    expect(container.textContent).toContain(
      "This browser could not keep a recovery draft. Keep this page open and try again."
    );
  });
});
