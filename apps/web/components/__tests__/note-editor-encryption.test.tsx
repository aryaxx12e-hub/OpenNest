import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createEncryptedStorage,
  createKeyring,
  createMemoryKeyringStore,
} from "@opennest/crypto";
import { createMemoryStorage, type IsoDate } from "@opennest/core";
import { LocaleProvider } from "@opennest/localization";
import { createMemoryPrivacyStore } from "@opennest/privacy";

import { AppDataProvider } from "@/lib/data/app-data-provider";
import { SaveCoordinatorProvider } from "@/lib/data/save-coordinator";
import { createAppServices } from "@/lib/data/services";
import { EncryptionGate } from "@/lib/crypto/encryption-gate";
import type { TabCoordinator } from "@/lib/crypto/tab-coordinator";

import { NoteEditor } from "../note-editor";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/notes/encrypted-note",
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PASSPHRASE = "correct horse battery staple";
const AT = "2026-11-17T12:00:00.000Z" as IsoDate;

class FakeTabCoordinator implements TabCoordinator {
  subscribe(): () => void {
    return () => undefined;
  }

  notifyLock(): void {}

  notifyReset(): void {}

  close(): void {}
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

async function waitFor(
  check: () => boolean,
  description: string,
  timeout = 10_000
): Promise<void> {
  const started = Date.now();

  while (Date.now() - started < timeout) {
    if (check()) {
      return;
    }

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }

  throw new Error(`Timed out waiting for ${description}`);
}

beforeEach(() => {
  window.localStorage.clear();
  document.body.replaceChildren();
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("NoteEditor encrypted drafts", () => {
  it("never writes plaintext recovery drafts in an encrypted workspace", async () => {
    const storage = createMemoryStorage();
    const workspace = await storage.workspaces.ensureWorkspace({
      name: "My Library",
      at: AT,
    });
    const keyringStore = createMemoryKeyringStore();
    const keyring = createKeyring({
      store: keyringStore,
      workspaceId: workspace.id,
    });
    await keyring.setup({ passphrase: PASSPHRASE });
    const context = await keyring.unlock(PASSPHRASE);
    const encryptedStorage = createEncryptedStorage({ base: storage, context });
    const { services } = await createAppServices(encryptedStorage, {
      defaultWorkspaceName: "My Library",
    });
    const note = await services.note.create({
      workspaceId: workspace.id,
      folderId: null,
      title: "Encrypted note",
      content: "Start",
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root: Root = createRoot(container);

    act(() => {
      root.render(
        <LocaleProvider>
          <AppDataProvider
            openStorage={async () => storage}
            openKeyringStore={async () => keyringStore}
            openPrivacyStore={async () => createMemoryPrivacyStore()}
            tabCoordinator={new FakeTabCoordinator()}
          >
            <EncryptionGate>
              <SaveCoordinatorProvider>
                <NoteEditor noteId={note.id} />
              </SaveCoordinatorProvider>
            </EncryptionGate>
          </AppDataProvider>
        </LocaleProvider>
      );
    });

    const unlockInput = await waitFor(
      () => container.querySelector("input") instanceof HTMLInputElement,
      "the unlock input"
    ).then(() => container.querySelector("input") as HTMLInputElement);

    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;

    act(() => {
      setter?.call(unlockInput, PASSPHRASE);
      unlockInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const form = container.querySelector("form");

    if (!(form instanceof HTMLFormElement)) {
      throw new Error("Unlock form is missing");
    }

    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    await waitFor(
      () => container.querySelector('textarea[aria-label="Write"]') !== null,
      "the note editor"
    );

    const editor = container.querySelector(
      'textarea[aria-label="Write"]'
    ) as HTMLTextAreaElement;
    change(editor, "Top secret draft");

    await waitFor(
      () => Object.keys(localStorage).some((key) => key.startsWith("opennest:edraft:")),
      "the encrypted draft"
    );

    const keys = Object.keys(localStorage);

    expect(keys.some((key) => key.startsWith("opennest:draft:note:"))).toBe(false);
    expect(keys.some((key) => key.startsWith("opennest:edraft:note:"))).toBe(true);

    act(() => root.unmount());
  });
});
