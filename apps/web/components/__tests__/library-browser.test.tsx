import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryStorage, type IsoDate } from "@opennest/core";
import { LocaleProvider } from "@opennest/localization";

import { AppDataProvider } from "@/lib/data/app-data-provider";
import { createAppServices, sha256Hex } from "@/lib/data/services";

import { LibraryBrowser } from "../library-browser";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/library",
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AT = "2026-11-13T12:34:56.000Z" as IsoDate;

let container: HTMLDivElement | undefined;
let root: ReturnType<typeof createRoot> | undefined;

async function waitFor(predicate: () => boolean, timeout = 5000) {
  const started = Date.now();

  while (!predicate() && Date.now() - started < timeout) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

function choose(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value"
  )?.set;

  act(() => {
    setter?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function fileNames() {
  return [...(container?.querySelectorAll('a[href^="/files?"]') ?? [])].map(
    (link) => link.textContent ?? ""
  );
}

function selectAt(index: number) {
  return container?.querySelectorAll("select")[index] as HTMLSelectElement | undefined;
}

async function chooseAt(index: number, value: string) {
  await waitFor(() => selectAt(index) !== undefined);
  choose(selectAt(index)!, value);
}

function buttonByText(label: string) {
  return [...(container?.querySelectorAll("button") ?? [])].find(
    (button) => button.textContent === label
  );
}

async function mountLibrary(storage: ReturnType<typeof createMemoryStorage>) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root!.render(
      <LocaleProvider>
        <AppDataProvider openStorage={async () => storage}>
          <LibraryBrowser folderId={null} />
        </AppDataProvider>
      </LocaleProvider>
    );
  });

  await waitFor(() => container?.textContent?.includes("alpha.md") === true);
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.replaceChildren();
  container = undefined;
  root = undefined;
  vi.restoreAllMocks();
});

describe("LibraryBrowser", () => {
  it("sorts files and filters them by type", async () => {
    const storage = createMemoryStorage();
    const { services, workspace } = await createAppServices(storage, {
      defaultWorkspaceName: "My Library",
      clock: () => AT,
      hash: sha256Hex,
      generateBlobKey: () => "44444444-4444-4444-8444-444444444444",
    });

    await services.file.upload({
      workspaceId: workspace.id,
      folderId: null,
      name: "alpha.md",
      mimeType: "text/markdown",
      data: Uint8Array.from([1]),
    });
    await services.file.upload({
      workspaceId: workspace.id,
      folderId: null,
      name: "beta.png",
      mimeType: "image/png",
      data: Uint8Array.from([2]),
    });

    await mountLibrary(storage);
    await waitFor(() => fileNames().length === 2);

    await chooseAt(0, "name");
    await chooseAt(1, "asc");
    await waitFor(() => fileNames()[0]?.includes("alpha.md") === true);

    const ascending = fileNames();
    expect(ascending[0]).toContain("alpha.md");
    expect(ascending[1]).toContain("beta.png");

    await chooseAt(2, "images");
    await waitFor(() => fileNames().length === 1);

    expect(fileNames()[0]).toContain("beta.png");
    expect(fileNames().some((name) => name.includes("alpha.md"))).toBe(false);

    await chooseAt(2, "documents");
    await waitFor(() => fileNames().some((name) => name.includes("alpha.md")));

    expect(fileNames()[0]).toContain("alpha.md");
    expect(fileNames().some((name) => name.includes("beta.png"))).toBe(false);
  }, 15000);

  it("shows a filtered empty state and clears the type filter", async () => {
    const storage = createMemoryStorage();
    const { services, workspace } = await createAppServices(storage, {
      defaultWorkspaceName: "My Library",
      clock: () => AT,
      hash: sha256Hex,
      generateBlobKey: () => "44444444-4444-4444-8444-444444444444",
    });

    await services.file.upload({
      workspaceId: workspace.id,
      folderId: null,
      name: "alpha.md",
      mimeType: "text/markdown",
      data: Uint8Array.from([1]),
    });

    await mountLibrary(storage);
    await chooseAt(2, "images");

    await waitFor(
      () => container?.textContent?.includes("No files match these filters") === true
    );

    expect(container?.textContent).toContain(
      "Change the type filter or clear it to see the files in this folder."
    );

    act(() => buttonByText("Clear filters")?.click());
    await waitFor(() => fileNames().some((name) => name.includes("alpha.md")));

    expect(fileNames()[0]).toContain("alpha.md");
  }, 15000);
});
