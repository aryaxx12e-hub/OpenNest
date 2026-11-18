import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryStorage, type IsoDate } from "@opennest/core";
import { LocaleProvider } from "@opennest/localization";

import { readNoteDraft, writeNoteDraft } from "@/lib/autosave/draft-journal";
import { AppDataProvider, useAppData } from "@/lib/data/app-data-provider";
import { buildBackup } from "@/lib/data/backup";
import { createAppServices, sha256Hex } from "@/lib/data/services";

import { BackupPanel } from "../backup-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AT = "2026-11-13T12:34:56.000Z" as IsoDate;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function settle(rounds = 40) {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

function openDialog(host: HTMLElement): HTMLDialogElement | null {
  return (
    Array.from(host.querySelectorAll("dialog")).find((dialog) => dialog.open) ?? null
  );
}

function change(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;

  act(() => {
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function clickLabel(host: HTMLElement, text: string) {
  const label = Array.from(host.querySelectorAll("label")).find((candidate) =>
    candidate.textContent?.trim().startsWith(text)
  );

  if (label === undefined) {
    throw new Error(`No label named ${text}`);
  }

  act(() => {
    label.click();
  });
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
  const scope = openDialog(host) ?? host;
  const button = Array.from(scope.querySelectorAll("button")).find(
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
  it("downloads an encrypted backup by default and reports success", async () => {
    const { storage, workspace } = await createSeed();
    const mounted = mount(storage);

    await settle();
    await act(async () => {
      buttonByText(mounted.container, "Export backup").click();
    });
    await settle();

    const dialog = openDialog(mounted.container);
    expect(dialog?.textContent).toContain("Download a backup?");
    expect(dialog?.textContent).toContain(
      "sync metadata (including outbox and conflict records) are not included"
    );
    const passwords = dialog?.querySelectorAll('input[type="password"]') ?? [];

    change(passwords[0] as HTMLInputElement, "correct horse battery staple");
    change(passwords[1] as HTMLInputElement, "correct horse battery staple");

    await act(async () => {
      buttonByText(mounted.container, "Download backup").click();
    });
    await settle(240);

    expect(mounted.download).toHaveBeenCalledTimes(1);
    const [fileName, text] = mounted.download.mock.calls[0] as [string, string];

    expect(fileName).toMatch(/^opennest-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(text).toContain('"formatVersion": 2');
    expect(text).not.toContain(workspace.id);
    expect(text).not.toContain("Before export");
    expect(mounted.container.textContent).toContain("Backup downloaded.");
    expect(String(window.localStorage.getItem("opennest:backup:last-export"))).toMatch(
      /^\d{4}-\d{2}-\d{2}T/
    );
    expect(mounted.container.textContent).toContain("Last backup");
  });

  it("exports a generated backup key and restores with it", async () => {
    const { storage, services, workspace } = await createSeed();
    const mounted = mount(storage);

    await settle();
    await act(async () => {
      buttonByText(mounted.container, "Export backup").click();
    });
    await settle();

    const exportDialog = openDialog(mounted.container);
    clickLabel(exportDialog as HTMLElement, "Backup key");
    const keyInput = exportDialog?.querySelector(
      "input[readonly]"
    ) as HTMLInputElement | null;
    const backupKey = keyInput?.value ?? "";

    expect(backupKey).toMatch(/^ONBK1-/);

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await act(async () => {
      buttonByText(mounted.container, "Copy key").click();
    });
    await settle();
    expect(writeText).toHaveBeenCalledWith(backupKey);
    expect(exportDialog?.textContent).toContain("Backup key copied.");

    await act(async () => {
      buttonByText(mounted.container, "Download backup").click();
    });
    await settle();
    expect(openDialog(mounted.container)?.textContent).toContain(
      "Save and confirm the backup key first."
    );

    const saved = exportDialog?.querySelector(
      'input[type="checkbox"]'
    ) as HTMLInputElement | null;
    act(() => {
      saved?.click();
    });

    await act(async () => {
      buttonByText(mounted.container, "Download backup").click();
    });
    await settle(240);
    const [, text] = mounted.download.mock.calls[0] as [string, string];

    act(() => {
      buttonByText(mounted.container, "Done").click();
    });
    await services.note.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "After export",
    });

    await chooseFile(mounted.container, text);

    const importDialog = openDialog(mounted.container);
    clickLabel(importDialog as HTMLElement, "Backup key");
    const importKey = importDialog?.querySelector(
      'input[placeholder="ONBK1-..."]'
    ) as HTMLInputElement | null;
    change(importKey as HTMLInputElement, "ONBK1-not-the-right-key");

    await act(async () => {
      buttonByText(mounted.container, "Unlock backup").click();
    });
    await settle();

    expect(mounted.container.textContent).toContain(
      "The passphrase or backup key is incorrect, or the backup is damaged."
    );

    change(importKey as HTMLInputElement, backupKey);

    await act(async () => {
      buttonByText(mounted.container, "Unlock backup").click();
    });
    await settle(240);

    expect(openDialog(mounted.container)?.textContent).toContain("Replace all data?");
    expect(openDialog(mounted.container)?.textContent).toContain(
      "This backup is encrypted, but your library is not. Restored data will be stored unencrypted on this device."
    );
    await act(async () => {
      buttonByText(mounted.container, "Replace data").click();
    });
    await settle();

    expect(mounted.container.textContent).toContain("Backup restored.");
    expect(
      (await services.note.list(workspace.id, {})).items.map((note) => note.title)
    ).toEqual(["Before export"]);
  }, 15000);

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
    expect(mounted.container.textContent).toContain(
      "This is a plaintext v1 backup. Its titles, notes, and file contents are not encrypted."
    );
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

  it("clears recovery drafts after a successful restore", async () => {
    const { storage, workspace } = await createSeed();
    const built = await buildBackup(storage, workspace.id, { now: () => AT });
    writeNoteDraft(window.localStorage, {
      version: 1,
      workspaceId: "workspace-1",
      noteId: "note-1",
      title: "Draft title",
      content: "Unsaved content",
      baseUpdatedAt: AT,
      savedAt: Date.now(),
    });

    const mounted = mount(storage);

    await settle();
    await chooseFile(mounted.container, built.text);
    await act(async () => {
      buttonByText(mounted.container, "Replace data").click();
    });
    await settle();

    expect(mounted.container.textContent).toContain("Backup restored.");
    expect(readNoteDraft(window.localStorage, "workspace-1", "note-1")).toBeNull();
  });

  it("reports a draft clear failure without hiding the restore success", async () => {
    const { storage, workspace } = await createSeed();
    const built = await buildBackup(storage, workspace.id, { now: () => AT });
    writeNoteDraft(window.localStorage, {
      version: 1,
      workspaceId: "workspace-1",
      noteId: "note-1",
      title: "Draft title",
      content: "Unsaved content",
      baseUpdatedAt: AT,
      savedAt: Date.now(),
    });
    vi.spyOn(window.localStorage, "removeItem").mockImplementationOnce(() => {
      throw new Error("blocked");
    });

    const mounted = mount(storage);

    await settle();
    await chooseFile(mounted.container, built.text);
    await act(async () => {
      buttonByText(mounted.container, "Replace data").click();
    });
    await settle();

    expect(mounted.container.textContent).toContain("Backup restored.");
    expect(mounted.container.textContent).toContain("Draft data could not be cleared.");
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
