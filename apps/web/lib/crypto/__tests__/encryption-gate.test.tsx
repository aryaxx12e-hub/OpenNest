import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createKeyring,
  createMemoryKeyringStore,
  type Keyring,
  type KeyringStore,
} from "@opennest/crypto";
import {
  createMemoryStorage,
  type IsoDate,
  type StorageAdapter,
  type Workspace,
} from "@opennest/core";
import { LocaleProvider } from "@opennest/localization";
import { createMemoryPrivacyStore } from "@opennest/privacy";

import { AppDataProvider, useAppData } from "@/lib/data/app-data-provider";

import { EncryptionGate, useEncryption } from "../encryption-gate";
import type { TabCoordinator, TabCoordinatorEvent } from "../tab-coordinator";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PASSPHRASE = "correct horse battery staple";
const AT = "2026-11-17T12:00:00.000Z" as IsoDate;

interface Fixture {
  storage: StorageAdapter;
  workspace: Workspace;
  keyringStore: KeyringStore;
  keyring: Keyring | null;
  recoveryKey: string | null;
}

class FakeTabCoordinator implements TabCoordinator {
  lockNotifications = 0;
  resetNotifications = 0;
  listener: ((event: TabCoordinatorEvent) => void) | null = null;

  subscribe(listener: (event: TabCoordinatorEvent) => void): () => void {
    this.listener = listener;

    return () => {
      if (this.listener === listener) {
        this.listener = null;
      }
    };
  }

  notifyLock(): void {
    this.lockNotifications += 1;
  }

  notifyReset(): void {
    this.resetNotifications += 1;
  }

  close(): void {
    this.listener = null;
  }

  emit(event: TabCoordinatorEvent): void {
    this.listener?.(event);
  }
}

async function createFixture(encrypted: boolean): Promise<Fixture> {
  const storage = createMemoryStorage();
  const workspace = await storage.workspaces.ensureWorkspace({
    name: "My Library",
    at: AT,
  });
  const keyringStore = createMemoryKeyringStore();

  if (!encrypted) {
    return {
      storage,
      workspace,
      keyringStore,
      keyring: null,
      recoveryKey: null,
    };
  }

  const keyring = createKeyring({
    store: keyringStore,
    workspaceId: workspace.id,
  });
  const setup = await keyring.setup({ passphrase: PASSPHRASE });

  return {
    storage,
    workspace,
    keyringStore,
    keyring,
    recoveryKey: setup.recoveryKey,
  };
}

function Probe() {
  const data = useAppData();
  const encryption = useEncryption();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  return (
    <section data-testid="app-probe">
      <span data-testid="encryption-status">{encryption.status}</span>
      <span data-testid="record-state">{encryption.record?.state ?? "none"}</span>
      <span data-testid="workspace-name">{data.workspace.name}</span>
      <span data-testid="note-saved">{saved ? "yes" : "no"}</span>
      <span data-testid="note-error">{error}</span>
      <button
        type="button"
        onClick={() => {
          void data.services.note
            .create({
              workspaceId: data.workspace.id,
              folderId: null,
              title: "Secret",
              content: "hidden body",
            })
            .then(() => setSaved(true))
            .catch((reason: unknown) => {
              setError(reason instanceof Error ? reason.message : "save failed");
            });
        }}
      >
        Add note
      </button>
      <button
        type="button"
        onClick={() => {
          void encryption.lock();
        }}
      >
        Lock now
      </button>
    </section>
  );
}

function OutsideControls() {
  const encryption = useEncryption();
  const [error, setError] = useState("");

  return (
    <div>
      <span data-testid="outside-status">{encryption.status}</span>
      <span data-testid="outside-error">{error}</span>
      <button
        type="button"
        onClick={() => {
          void encryption.resetEncryption().catch((reason: unknown) => {
            setError(reason instanceof Error ? reason.message : "reset failed");
          });
        }}
      >
        Reset keyring
      </button>
    </div>
  );
}

function mount(fixture: Fixture, coordinator: TabCoordinator) {
  const container = document.createElement("div");
  document.body.append(container);
  const root: Root = createRoot(container);

  act(() => {
    root.render(
      <LocaleProvider>
        <AppDataProvider
          openStorage={async () => fixture.storage}
          openKeyringStore={async () => fixture.keyringStore}
          openPrivacyStore={async () => createMemoryPrivacyStore()}
          tabCoordinator={coordinator}
        >
          <EncryptionGate>
            <Probe />
          </EncryptionGate>
          <OutsideControls />
        </AppDataProvider>
      </LocaleProvider>
    );
  });

  return { container, root };
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

function input(container: HTMLElement): HTMLInputElement {
  const element = container.querySelector("input");

  if (!(element instanceof HTMLInputElement)) {
    throw new Error("Unlock input is missing");
  }

  return element;
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

function submit(container: HTMLElement) {
  const form = container.querySelector("form");

  if (!(form instanceof HTMLFormElement)) {
    throw new Error("Unlock form is missing");
  }

  act(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const element = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text
  );

  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`Button ${text} is missing`);
  }

  return element;
}

async function waitForLocked(container: HTMLElement) {
  await waitFor(
    () => container.textContent?.includes("Your library is locked") === true,
    "the unlock screen"
  );
}

async function unlockWithPassphrase(container: HTMLElement) {
  change(input(container), PASSPHRASE);
  submit(container);
  await waitFor(
    () =>
      container.querySelector('[data-testid="encryption-status"]')?.textContent ===
      "unlocked",
    "the unlocked workspace"
  );
}

describe("encryption gate", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.replaceChildren();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("mounts the app in plaintext mode when no keyring exists", async () => {
    const fixture = await createFixture(false);
    const coordinator = new FakeTabCoordinator();
    const { container, root } = mount(fixture, coordinator);

    await waitFor(
      () => container.querySelector('[data-testid="app-probe"]') !== null,
      "the plaintext app"
    );

    expect(container.textContent).toContain("My Library");
    expect(
      container.querySelector('[data-testid="encryption-status"]')?.textContent
    ).toBe("plaintext");
    expect(container.querySelector("input")).toBeNull();

    act(() => root.unmount());
  });

  it("shows a focused unlock form without mounting the app when locked", async () => {
    const fixture = await createFixture(true);
    const coordinator = new FakeTabCoordinator();
    const { container, root } = mount(fixture, coordinator);

    await waitForLocked(container);

    expect(container.querySelector('[data-testid="app-probe"]')).toBeNull();
    expect(container.querySelector("label")?.textContent).toContain("Passphrase");
    expect(input(container).type).toBe("password");

    await waitFor(() => document.activeElement === input(container), "input focus");

    act(() => root.unmount());
  });

  it("unlocks with a passphrase and mounts an encrypted workspace", async () => {
    const fixture = await createFixture(true);
    const coordinator = new FakeTabCoordinator();
    const { container, root } = mount(fixture, coordinator);

    await waitForLocked(container);
    await unlockWithPassphrase(container);

    expect(
      container.querySelector('[data-testid="encryption-status"]')?.textContent
    ).toBe("unlocked");
    expect(container.querySelector('[data-testid="record-state"]')?.textContent).toBe(
      "active"
    );
    expect(container.textContent).toContain("My Library");

    act(() => button(container, "Add note").click());

    await waitFor(
      () => container.querySelector('[data-testid="note-saved"]')?.textContent === "yes",
      "the note save"
    );

    const notes = await fixture.storage.notes.list(
      fixture.workspace.id,
      {},
      { limit: 5 }
    );

    expect(notes.items).toHaveLength(1);
    expect(notes.items[0]?.title).toBe("Secret");
    expect(notes.items[0]?.content.startsWith("enc1:")).toBe(true);

    act(() => root.unmount());
  });

  it("announces a wrong passphrase and stays locked", async () => {
    const fixture = await createFixture(true);
    const coordinator = new FakeTabCoordinator();
    const { container, root } = mount(fixture, coordinator);

    await waitForLocked(container);

    change(input(container), "this is not the passphrase");
    submit(container);

    await waitFor(
      () => container.querySelector('[role="alert"]') !== null,
      "the unlock error"
    );

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("incorrect");
    expect(input(container).getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector('[data-testid="app-probe"]')).toBeNull();

    act(() => root.unmount());
  });

  it("unlocks with a recovery key", async () => {
    const fixture = await createFixture(true);
    const coordinator = new FakeTabCoordinator();
    const { container, root } = mount(fixture, coordinator);

    await waitForLocked(container);
    act(() => button(container, "Use a recovery key").click());

    await waitFor(
      () =>
        container.querySelector("label")?.textContent?.includes("Recovery key") === true,
      "the recovery-key form"
    );
    await waitFor(() => document.activeElement === input(container), "recovery focus");

    change(input(container), fixture.recoveryKey ?? "");
    submit(container);

    await waitFor(
      () =>
        container.querySelector('[data-testid="encryption-status"]')?.textContent ===
        "unlocked",
      "the recovered workspace"
    );

    act(() => root.unmount());
  });

  it("locks locally, broadcasts the lock, and unmounts the app", async () => {
    const fixture = await createFixture(true);
    const coordinator = new FakeTabCoordinator();
    const { container, root } = mount(fixture, coordinator);

    await waitForLocked(container);
    await unlockWithPassphrase(container);

    act(() => button(container, "Lock now").click());

    await waitForLocked(container);

    expect(coordinator.lockNotifications).toBe(1);
    expect(container.querySelector('[data-testid="app-probe"]')).toBeNull();
    expect(await fixture.keyringStore.get(fixture.workspace.id)).not.toBeNull();

    act(() => root.unmount());
  });

  it("locks when another tab broadcasts a lock", async () => {
    const fixture = await createFixture(true);
    const coordinator = new FakeTabCoordinator();
    const { container, root } = mount(fixture, coordinator);

    await waitForLocked(container);
    await unlockWithPassphrase(container);

    act(() => coordinator.emit({ type: "lock" }));

    await waitForLocked(container);

    expect(coordinator.lockNotifications).toBe(0);
    expect(container.querySelector('[data-testid="app-probe"]')).toBeNull();

    act(() => root.unmount());
  });

  it("returns to plaintext mode after deleting a keyring with no encrypted data", async () => {
    const fixture = await createFixture(true);
    const coordinator = new FakeTabCoordinator();
    const { container, root } = mount(fixture, coordinator);

    await waitForLocked(container);
    expect(container.querySelector('[data-testid="outside-status"]')?.textContent).toBe(
      "locked"
    );

    act(() => button(container, "Reset keyring").click());

    await waitFor(
      () =>
        container.querySelector('[data-testid="encryption-status"]')?.textContent ===
        "plaintext",
      "plaintext mode"
    );

    expect(await fixture.keyringStore.get(fixture.workspace.id)).toBeNull();
    expect(coordinator.resetNotifications).toBe(1);

    act(() => root.unmount());
  });

  it("refuses to delete a keyring while encrypted content exists", async () => {
    const fixture = await createFixture(true);
    const coordinator = new FakeTabCoordinator();
    const { container, root } = mount(fixture, coordinator);

    await waitForLocked(container);
    await unlockWithPassphrase(container);
    act(() => button(container, "Add note").click());

    await waitFor(
      () => container.querySelector('[data-testid="note-saved"]')?.textContent === "yes",
      "the note save"
    );

    act(() => button(container, "Reset keyring").click());

    await waitFor(
      () =>
        (container.querySelector('[data-testid="outside-error"]')?.textContent ?? "")
          .length > 0,
      "the reset refusal"
    );

    expect(
      container.querySelector('[data-testid="encryption-status"]')?.textContent
    ).toBe("unlocked");
    expect(await fixture.keyringStore.get(fixture.workspace.id)).not.toBeNull();
    expect(coordinator.resetNotifications).toBe(0);

    act(() => root.unmount());
  });

  it("validates an empty recovery key and moves focus between fields", async () => {
    const fixture = await createFixture(true);
    const coordinator = new FakeTabCoordinator();
    const { container, root } = mount(fixture, coordinator);

    await waitForLocked(container);
    act(() => button(container, "Use a recovery key").click());

    await waitFor(
      () =>
        container.querySelector("label")?.textContent?.includes("Recovery key") === true,
      "the recovery-key form"
    );

    submit(container);

    await waitFor(
      () => container.querySelector('[role="alert"]') !== null,
      "the recovery-key validation"
    );

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Enter your recovery key"
    );

    act(() => button(container, "Use passphrase").click());

    await waitFor(
      () =>
        container.querySelector("label")?.textContent?.includes("Passphrase") === true,
      "the passphrase form"
    );
    await waitFor(() => document.activeElement === input(container), "passphrase focus");

    act(() => root.unmount());
  });
});
