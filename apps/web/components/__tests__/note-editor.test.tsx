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

function changeInput(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
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

  it("links another note from the editor", async () => {
    const storage = createMemoryStorage();
    const { services, workspace } = await createAppServices(storage, {
      defaultWorkspaceName: "My Library",
      clock: () => AT,
      hash: sha256Hex,
      generateBlobKey: () => "44444444-4444-4444-8444-444444444444",
    });
    const first = await services.note.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "First note",
      content: "Start",
    });
    const second = await services.note.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Second note",
      content: "Link me",
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        <LocaleProvider>
          <AppDataProvider openStorage={async () => storage}>
            <SaveCoordinatorProvider>
              <NoteEditor noteId={first.id} />
            </SaveCoordinatorProvider>
          </AppDataProvider>
        </LocaleProvider>
      );
    });

    await settle();

    const links = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Links"
    );

    expect(links).not.toBeUndefined();
    act(() => links?.click());
    await settle();

    const dialog = container.querySelector("dialog");
    const row = [...(dialog?.querySelectorAll("label") ?? [])].find((label) =>
      label.textContent?.includes("Second note")
    );
    const checkbox = row?.querySelector("input") as HTMLInputElement | null;

    expect(checkbox).not.toBeNull();
    act(() => checkbox?.click());

    const save = dialog?.querySelector(
      'button[type="submit"]'
    ) as HTMLButtonElement | null;

    expect(save).not.toBeNull();
    await act(async () => {
      save?.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await settle();

    expect(
      container.querySelector(`a[href="/notes?noteId=${second.id}"]`)?.textContent
    ).toContain("Second note");
  }, 15000);

  it("exports the current title as a markdown download", async () => {
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
    let downloaded = "";

    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:note");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      downloaded = this.download;
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

    const title = container.querySelector("#note-title") as HTMLInputElement | null;

    expect(title).not.toBeNull();
    changeInput(title!, "Trip: Day 1");

    const exportButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Export Markdown"
    );

    expect(exportButton).not.toBeUndefined();
    await act(async () => {
      exportButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(downloaded).toBe("Trip- Day 1.md");
    expect(container.textContent).toContain("Markdown file exported.");
  }, 15000);
});
