import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createEncryptedStorage,
  createKeyring,
  createMemoryKeyringStore,
  enableEncryption,
  rotateWorkspaceKey,
  type Keyring,
} from "@opennest/crypto";
import {
  createMemoryStorage,
  type IsoDate,
  type StorageAdapter,
  type WorkspaceId,
} from "@opennest/core";
import { LocaleProvider, useTranslations } from "@opennest/localization";
import { createMemoryPrivacyStore } from "@opennest/privacy";

import { EncryptionGate, useEncryption } from "@/lib/crypto/encryption-gate";
import { AppDataProvider } from "@/lib/data/app-data-provider";
import { createAppServices } from "@/lib/data/services";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PASSPHRASE = "correct horse battery staple";
const AT = "2026-11-17T12:00:00.000Z" as IsoDate;

interface Fixture {
  storage: StorageAdapter;
  keyring: Keyring;
  keyringStore: ReturnType<typeof createMemoryKeyringStore>;
  pendingKid: string;
  recoveryKey: string;
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function createFixtureForRotation(): Promise<Fixture> {
  const storage = createMemoryStorage();
  const workspace = await storage.workspaces.ensureWorkspace({
    name: "My Library",
    at: AT,
  });
  const { services } = await createAppServices(storage, {
    defaultWorkspaceName: "My Library",
  });
  await services.note.create({
    workspaceId: workspace.id,
    folderId: null,
    title: "Before rotation",
    content: "hello",
  });

  const keyringStore = createMemoryKeyringStore();
  const keyring = createKeyring({ store: keyringStore, workspaceId: workspace.id });
  const setup = await enableEncryption({
    base: storage,
    keyring,
    passphrase: PASSPHRASE,
  });

  return {
    storage,
    keyring,
    keyringStore,
    pendingKid: setup.record.activeKid,
    recoveryKey: setup.recoveryKey,
  };
}

async function createFixture(): Promise<Fixture> {
  const storage = createMemoryStorage();
  const workspace = await storage.workspaces.ensureWorkspace({
    name: "My Library",
    at: AT,
  });
  const { services } = await createAppServices(storage, {
    defaultWorkspaceName: "My Library",
  });
  await services.note.create({
    workspaceId: workspace.id,
    folderId: null,
    title: "Before rotation",
    content: "hello",
  });

  const keyringStore = createMemoryKeyringStore();
  const keyring = createKeyring({ store: keyringStore, workspaceId: workspace.id });
  const setup = await enableEncryption({
    base: storage,
    keyring,
    passphrase: PASSPHRASE,
  });

  await expect(
    rotateWorkspaceKey({
      base: storage,
      keyring,
      passphrase: PASSPHRASE,
      context: setup.context,
      beforeCommit: async () => {
        throw new Error("simulated crash");
      },
    })
  ).rejects.toThrow();

  const record = await keyring.get();

  if (record?.pending === null || record?.pending === undefined) {
    throw new Error("rotation was not staged");
  }

  return {
    storage,
    keyring,
    keyringStore,
    pendingKid: record.pending.kid,
    recoveryKey: setup.recoveryKey,
  };
}

function Probe() {
  const encryption = useEncryption();
  const t = useTranslations();

  return (
    <div>
      <span data-testid="status">{encryption.status}</span>
      <span data-testid="pending">{encryption.pendingRotation ? "yes" : "no"}</span>
      <span data-testid="notice">
        {encryption.notice === null ? "" : t(encryption.notice)}
      </span>
      <button
        type="button"
        onClick={() => {
          void encryption.rotate(PASSPHRASE);
        }}
      >
        Rotate
      </button>
    </div>
  );
}

async function settle() {
  for (let index = 0; index < 30; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

function mount(fixture: Fixture) {
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
            <Probe />
          </EncryptionGate>
        </AppDataProvider>
      </LocaleProvider>
    );
  });
}

async function waitForLocked() {
  for (let index = 0; index < 600; index += 1) {
    if (container?.textContent?.includes("Your library is locked") === true) {
      return;
    }

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }

  throw new Error(`Timed out waiting for the unlock screen: ${container?.textContent}`);
}

async function unlock(secret: string, recovery: boolean) {
  await waitForLocked();

  if (recovery) {
    const button = Array.from(container!.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === "Use a recovery key"
    );
    act(() => button?.click());
    await settle();
  }

  const input = container!.querySelector("input") as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;

  act(() => {
    setter?.call(input, secret);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const form = container!.querySelector("form") as HTMLFormElement;
  act(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

async function waitForUnlocked() {
  for (let index = 0; index < 900; index += 1) {
    if (container?.querySelector('[data-testid="status"]')?.textContent === "unlocked") {
      return;
    }

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }

  throw new Error(
    `Timed out waiting for the recovered workspace: ${container?.textContent}`
  );
}

async function expectNoteReadable(fixture: Fixture) {
  const context = await fixture.keyring.unlock(PASSPHRASE);
  const storage = createEncryptedStorage({ base: fixture.storage, context });
  const notes = await storage.notes.list(
    context.workspaceId as WorkspaceId,
    {},
    { limit: 5 }
  );

  expect(notes.items.map((note) => note.content)).toEqual(["hello"]);
}

async function expectRecovered(fixture: Fixture) {
  const record = await fixture.keyring.get();

  expect(record?.pending).toBeNull();
  expect(record?.activeKid).toBe(fixture.pendingKid);

  const context = await fixture.keyring.unlock(PASSPHRASE);
  const storage = createEncryptedStorage({ base: fixture.storage, context });
  const notes = await storage.notes.list(
    context.workspaceId as WorkspaceId,
    {},
    { limit: 5 }
  );

  expect(notes.items.map((note) => note.content)).toEqual(["hello"]);
  expect(window.localStorage.length).toBe(0);
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

describe("pending rotation recovery", () => {
  it("finishes a rotation interrupted after the workspace restore", async () => {
    const fixture = await createFixture();
    mount(fixture);

    await unlock(PASSPHRASE, false);
    await waitForUnlocked();
    await expectRecovered(fixture);
  }, 60_000);

  it("rotates an unlocked workspace and keeps notes readable", async () => {
    const fixture = await createFixtureForRotation();
    mount(fixture);
    await unlock(PASSPHRASE, false);
    await waitForUnlocked();

    const before = await fixture.keyring.get();
    const button = Array.from(container!.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === "Rotate"
    );
    act(() => button?.click());

    for (let index = 0; index < 900; index += 1) {
      if (container?.textContent?.includes("Workspace key rotated.") === true) {
        break;
      }

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }

    const after = await fixture.keyring.get();
    expect(after?.pending).toBeNull();
    expect(after?.activeKid).not.toBe(before?.activeKid);
    await expectNoteReadable(fixture);
    expect(window.localStorage.length).toBe(0);
  }, 60_000);

  it("finishes a pending rotation with the recovery key", async () => {
    const fixture = await createFixture();
    mount(fixture);

    await unlock(fixture.recoveryKey, true);
    await waitForUnlocked();
    await expectRecovered(fixture);
  }, 60_000);
});
