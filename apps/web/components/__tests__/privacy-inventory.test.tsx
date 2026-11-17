import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createKeyring,
  createMemoryKeyringStore,
  type KeyringStore,
  type Keyring,
} from "@opennest/crypto";
import { createMemoryStorage, type IsoDate, type StorageAdapter } from "@opennest/core";
import { LocaleProvider } from "@opennest/localization";
import { createMemoryPrivacyStore } from "@opennest/privacy";
import { dataInventory } from "@opennest/privacy";

import { PrivacyCenter } from "@/components/privacy-center";
import { EncryptionGate, useEncryption } from "@/lib/crypto/encryption-gate";
import { AppDataProvider } from "@/lib/data/app-data-provider";

import { PrivacyInventory } from "../privacy-inventory";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PASSPHRASE = "correct horse battery staple";
const AT = "2026-11-17T12:00:00.000Z" as IsoDate;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const scope =
    Array.from(host.querySelectorAll("dialog")).find((dialog) => dialog.open) ?? host;
  const button = Array.from(scope.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`No button named ${text}`);
  }

  return button;
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

async function waitFor(check: () => boolean, description: string, timeout = 15_000) {
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

function StatusProbe() {
  const encryption = useEncryption();

  return (
    <div>
      <span data-testid="record">{encryption.record === null ? "none" : "present"}</span>
      <span data-testid="status">{encryption.status}</span>
    </div>
  );
}

async function createFixture(): Promise<{
  storage: StorageAdapter;
  keyringStore: KeyringStore;
  keyring: Keyring;
  workspaceId: string;
}> {
  const storage = createMemoryStorage();
  const workspace = await storage.workspaces.ensureWorkspace({
    name: "My Library",
    at: AT,
  });
  const keyringStore = createMemoryKeyringStore();
  const keyring = createKeyring({ store: keyringStore, workspaceId: workspace.id });
  await keyring.setup({ passphrase: PASSPHRASE });

  return { storage, keyringStore, keyring, workspaceId: workspace.id };
}

function mount(fixture: Awaited<ReturnType<typeof createFixture>>) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root!.render(
      <LocaleProvider>
        <AppDataProvider
          openStorage={async () => fixture.storage}
          openKeyringStore={async () => fixture.keyringStore}
          openPrivacyStore={async () => createMemoryPrivacyStore()}
        >
          <EncryptionGate>
            <PrivacyCenter />
          </EncryptionGate>
          <StatusProbe />
        </AppDataProvider>
      </LocaleProvider>
    );
  });
}

beforeEach(() => {
  window.localStorage.clear();
  document.body.replaceChildren();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.replaceChildren();
  root = undefined;
  container = undefined;
});

describe("privacy encryption inventory", () => {
  it("lists the encryption keyring and clears it during delete-all", async () => {
    const keyringEntry = dataInventory.find((entry) => entry.id === "keyring");

    expect(keyringEntry).toMatchObject({
      dataClass: "D3",
      storage: "indexeddb",
      includedInBackup: false,
      deletedWithSource: false,
    });
    expect(keyringEntry?.labelKey).toBe("privacy.inventory.items.keyring");

    const fixture = await createFixture();
    mount(fixture);

    await waitFor(
      () => container?.textContent?.includes("Your library is locked") === true,
      "the unlock screen"
    );
    const input = container!.querySelector("input") as HTMLInputElement;
    change(input, PASSPHRASE);
    const unlockForm = container!.querySelector("form") as HTMLFormElement;
    act(() => {
      unlockForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await waitFor(
      () =>
        container?.querySelector('[data-testid="status"]')?.textContent === "unlocked",
      "the unlocked workspace"
    );
    await waitFor(
      () => container?.textContent?.includes("Data inventory") === true,
      "the privacy inventory"
    );

    expect(container?.textContent).toContain("Encryption keyring");

    act(() => buttonByText(container!, "Delete all data").click());
    await waitFor(
      () => container?.textContent?.includes("Delete all data?") === true,
      "the delete confirmation"
    );
    act(() => buttonByText(container!, "Delete everything").click());

    await waitFor(
      () => container?.textContent?.includes("All local data was deleted.") === true,
      "the deletion result"
    );
    await waitFor(
      () => container?.querySelector('[data-testid="record"]')?.textContent === "none",
      "the cleared keyring"
    );

    expect(await fixture.keyringStore.get(fixture.workspaceId)).toBeNull();
  }, 45_000);

  it("renders the keyring row from the inventory", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        <LocaleProvider>
          <PrivacyInventory inventory={dataInventory} flows={[]} />
        </LocaleProvider>
      );
    });

    expect(container.textContent).toContain("Encryption keyring");
  });
});
