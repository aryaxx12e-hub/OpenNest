import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryStorage, type IsoDate } from "@opennest/core";
import { LocaleProvider } from "@opennest/localization";

import { AppDataProvider } from "@/lib/data/app-data-provider";
import { createAppServices, sha256Hex } from "@/lib/data/services";

import { Dashboard } from "../dashboard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
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

async function mountDashboard(storage: ReturnType<typeof createMemoryStorage>) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root!.render(
      <LocaleProvider>
        <AppDataProvider openStorage={async () => storage}>
          <Dashboard />
        </AppDataProvider>
      </LocaleProvider>
    );
  });

  await waitFor(() => container?.textContent?.includes("Projects") === true);
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

describe("Dashboard", () => {
  it("shows storage, library counts, recent items, and nest health", async () => {
    const storage = createMemoryStorage();
    const { services, workspace } = await createAppServices(storage, {
      defaultWorkspaceName: "My Library",
      clock: () => AT,
      hash: sha256Hex,
      generateBlobKey: () => "44444444-4444-4444-8444-444444444444",
    });

    const folder = await services.folder.create({
      workspaceId: workspace.id,
      parentId: null,
      name: "Projects",
    });
    await services.file.upload({
      workspaceId: workspace.id,
      folderId: folder.id,
      name: "alpha.md",
      mimeType: "text/markdown",
      data: new TextEncoder().encode("hello"),
    });
    await services.note.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "First note",
      content: "A short note",
    });

    await mountDashboard(storage);

    const text = container?.textContent ?? "";
    const overview = container?.querySelector('[aria-label="Overview"]');

    expect(text).toContain("File storage");
    expect(text).toContain("Quick actions");
    expect(text).toContain("Back up your library");
    expect(text).toContain("Nest health");
    expect(text).toContain("Local-first");
    expect(text).toContain("alpha.md");
    expect(text).toContain("First note");
    expect(text).toContain("Projects");
    expect(overview?.textContent).toContain("Files");
    expect(overview?.textContent).toContain("Notes");
    expect(overview?.textContent).toContain("Folders");
    expect(container?.querySelector('a[href="/library"]')).not.toBeNull();
    expect(container?.querySelector('a[href="/notes"]')).not.toBeNull();
  });

  it("shows the empty state when the library has no content", async () => {
    const storage = createMemoryStorage();
    await createAppServices(storage, {
      defaultWorkspaceName: "My Library",
      clock: () => AT,
      hash: sha256Hex,
      generateBlobKey: () => "44444444-4444-4444-8444-444444444444",
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        <LocaleProvider>
          <AppDataProvider openStorage={async () => storage}>
            <Dashboard />
          </AppDataProvider>
        </LocaleProvider>
      );
    });

    await waitFor(() => container?.textContent?.includes("Start your library") === true);

    const text = container?.textContent ?? "";

    expect(text).toContain("Start your library");
    expect(text).not.toContain("Recent files");
    expect(text).not.toContain("Recent notes");
  });
});
