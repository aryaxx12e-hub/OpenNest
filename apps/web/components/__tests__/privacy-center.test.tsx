import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryStorage } from "@opennest/core";
import { LocaleProvider } from "@opennest/localization";

import { AppDataProvider } from "@/lib/data/app-data-provider";

import { PrivacyCenter } from "../privacy-center";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function settle() {
  for (let index = 0; index < 50; index += 1) {
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

function mount() {
  act(() => {
    root!.render(
      <LocaleProvider>
        <AppDataProvider openStorage={async () => createMemoryStorage()}>
          <PrivacyCenter />
        </AppDataProvider>
      </LocaleProvider>
    );
  });
}

beforeEach(() => {
  window.localStorage.clear();
  document.body.replaceChildren();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mount();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.replaceChildren();
  root = undefined;
  container = undefined;
  vi.restoreAllMocks();
});

describe("PrivacyCenter", () => {
  it("shows the inventory and requires confirmation before deleting all data", async () => {
    await waitForText(container!, "Data inventory");

    expect(container?.textContent).toContain("Privacy Center");
    expect(container?.textContent).toContain("Data inventory");
    expect(container?.textContent).toContain("Audit log");
    expect(container?.textContent).toContain("Sync outbox");
    expect(container?.textContent).toContain(
      "Recovery drafts, permission grants, audit entries, search results, and sync metadata (including outbox and conflict records) are not included in backup v1 or v2."
    );

    await act(async () => {
      buttonByText(container!, "Delete all data").click();
    });
    await settle();

    expect(container?.textContent).toContain("Delete all data?");

    await act(async () => {
      buttonByText(container!, "Delete everything").click();
    });
    await settle();

    expect(container?.querySelector('[role="status"]')?.textContent).toContain(
      "All local data was deleted."
    );
  });

  it("shows storage diagnostics and reports a denied persistence request", async () => {
    const original = Object.getOwnPropertyDescriptor(window.navigator, "storage");
    Object.defineProperty(window.navigator, "storage", {
      configurable: true,
      value: {
        estimate: async () => ({ usage: 1536, quota: 2097152 }),
        persisted: async () => false,
        persist: async () => false,
      },
    });

    try {
      act(() => root?.unmount());
      root = createRoot(container!);
      mount();

      await waitForText(container!, "Browser storage");
      expect(container?.textContent).toContain("Not granted");

      await act(async () => {
        buttonByText(container!, "Keep this data").click();
      });
      await waitForText(
        container!,
        "The browser did not grant persistent storage. Keep a backup."
      );

      expect(container?.textContent).toContain(
        "The browser did not grant persistent storage. Keep a backup."
      );
    } finally {
      if (original === undefined) {
        Reflect.deleteProperty(window.navigator, "storage");
      } else {
        Object.defineProperty(window.navigator, "storage", original);
      }
    }
  });

  it("exports an encrypted backup through the shared export dialog", async () => {
    let downloaded = "";
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:backup");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      downloaded = this.download;
    });

    await waitForText(container!, "Export backup");
    await act(async () => {
      buttonByText(container!, "Export backup").click();
    });
    await settle();

    const dialog = openDialog(container!);
    const passwords = dialog?.querySelectorAll('input[type="password"]') ?? [];

    expect(passwords).toHaveLength(2);
    change(passwords[0] as HTMLInputElement, "correct horse battery staple");
    change(passwords[1] as HTMLInputElement, "correct horse battery staple");

    await act(async () => {
      buttonByText(container!, "Download backup").click();
    });
    await waitForText(container!, "Backup downloaded.");

    expect(downloaded).toMatch(/^opennest-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(container?.textContent).toContain("Backup downloaded.");
  }, 15000);
});
