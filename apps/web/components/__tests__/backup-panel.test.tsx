import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryStorage, type IsoDate } from "@opennest/core";
import { LocaleProvider } from "@opennest/localization";

import { AppDataProvider, useAppData } from "@/lib/data/app-data-provider";
import { buildBackup } from "@/lib/data/backup";
import { createAppServices, sha256Hex } from "@/lib/data/services";

import { BackupPanel } from "../backup-panel";

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

async function createSeed() {
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
    title: "Before export",
    content: "hello",
  });

  return { storage, services, workspace, note };
}

function WorkspaceProbe() {
  const { workspace } = useAppData();

  return <span data-testid="workspace">{workspace.name}</span>;
}

function mount(storage: ReturnType<typeof createMemoryStorage>, download = vi.fn()) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root!.render(
      <LocaleProvider>
        <AppDataProvider openStorage={async () => storage}>
          <WorkspaceProbe />
          <BackupPanel download={download} />
        </AppDataProvider>
      </LocaleProvider>
    );
  });

  return { container, download };
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

async function chooseFile(host: HTMLElement, text: string) {
  const input = host.querySelector('input[type="file"]');

  if (input === null) {
    throw new Error("No file input");
  }

  Object.defineProperty(input, "files", {
    configurable: true,
    value: [
      {
        name: "backup.json",
        type: "application/json",
        text: async () => text,
      },
    ],
  });

  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

beforeEach(() => {
  window.localStorage.clear();
  document.body.replaceChildren();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("BackupPanel", () => {
  it("downloads a complete backup and reports success", async () => {
    const { storage, workspace } = await createSeed();
    const mounted = mount(storage);

    await settle();
    await act(async () => {
      buttonByText(mounted.container, "Export backup").click();
    });
    await settle();

    expect(mounted.download).toHaveBeenCalledTimes(1);
    const [fileName, text] = mounted.download.mock.calls[0] as [string, string];

    expect(fileName).toMatch(/^opennest-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(text).toContain(workspace.id);
    expect(mounted.container.textContent).toContain("Backup downloaded.");
  });

  it("rejects an invalid file without changing stored data", async () => {
    const { storage, services, workspace } = await createSeed();
    const mounted = mount(storage);

    await settle();
    await chooseFile(mounted.container, "{not json");

    expect(mounted.container.textContent).toContain(
      "That backup file is not valid JSON."
    );
    expect((await services.note.list(workspace.id, {})).total).toBe(1);
  });

  it("asks for confirmation before replacing data", async () => {
    const { storage, services, workspace } = await createSeed();
    const built = await buildBackup(storage, workspace.id, { now: () => AT });

    await services.note.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "After export",
    });

    const mounted = mount(storage);

    await settle();
    await chooseFile(mounted.container, built.text);

    expect(mounted.container.textContent).toContain("Replace all data?");
    expect((await services.note.list(workspace.id, {})).total).toBe(2);

    await act(async () => {
      buttonByText(mounted.container, "Replace data").click();
    });
    await settle();

    expect(mounted.container.textContent).toContain("Backup restored.");
    const notes = await services.note.list(workspace.id, {});

    expect(notes.items.map((note) => note.title)).toEqual(["Before export"]);
  });

  it("refreshes the active workspace after restoring a different workspace", async () => {
    const current = await createSeed();
    const restored = createMemoryStorage();
    const restoredApp = await createAppServices(restored, {
      defaultWorkspaceName: "Restored Library",
      clock: () => AT,
      hash: sha256Hex,
      generateBlobKey: () => "55555555-5555-4555-8555-555555555555",
    });

    await restoredApp.services.note.create({
      workspaceId: restoredApp.workspace.id,
      folderId: null,
      title: "Restored note",
    });

    const built = await buildBackup(restored, restoredApp.workspace.id, {
      now: () => AT,
    });
    const mounted = mount(current.storage);

    await settle();
    await chooseFile(mounted.container, built.text);
    await act(async () => {
      buttonByText(mounted.container, "Replace data").click();
    });
    await settle();

    expect(
      mounted.container.querySelector('[data-testid="workspace"]')?.textContent
    ).toBe("Restored Library");
    expect(
      (await current.services.note.list(restoredApp.workspace.id, {})).items.map(
        (note) => note.title
      )
    ).toEqual(["Restored note"]);
  });

  it("does not replace data when confirmation is cancelled", async () => {
    const { storage, services, workspace } = await createSeed();
    const built = await buildBackup(storage, workspace.id, { now: () => AT });

    await services.note.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "After export",
    });

    const mounted = mount(storage);

    await settle();
    await chooseFile(mounted.container, built.text);
    await act(async () => {
      buttonByText(mounted.container, "Cancel").click();
    });
    await settle();

    expect((await services.note.list(workspace.id, {})).total).toBe(2);
    expect(mounted.container.textContent).not.toContain("Backup restored.");
  });

  it("reports a restore failure without claiming success", async () => {
    const { storage, services, workspace } = await createSeed();
    const built = await buildBackup(storage, workspace.id, { now: () => AT });
    const failing = {
      ...storage,
      restore: async () => {
        throw new Error("restore failed");
      },
    };
    const mounted = mount(failing);

    await settle();
    await chooseFile(mounted.container, built.text);
    await act(async () => {
      buttonByText(mounted.container, "Replace data").click();
    });
    await settle();

    expect(mounted.container.textContent).toContain("Something went wrong. Try again.");
    expect(mounted.container.textContent).not.toContain("Backup restored.");
    expect((await services.note.list(workspace.id, {})).total).toBe(1);
  });
});
