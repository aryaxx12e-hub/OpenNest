import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CryptoError } from "@opennest/crypto";
import { LocaleProvider } from "@opennest/localization";

import {
  EncryptionProvider,
  type EncryptionContextValue,
} from "@/lib/crypto/encryption-gate";

import { EncryptionSettings } from "../encryption-settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

async function settle(rounds = 30) {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

function mount(overrides: Partial<EncryptionContextValue> = {}) {
  const value: EncryptionContextValue = {
    status: "unlocked",
    record: null,
    pendingRotation: false,
    operation: null,
    notice: null,
    unlock: vi.fn(async () => undefined),
    unlockWithRecoveryKey: vi.fn(async () => undefined),
    lock: vi.fn(async () => undefined),
    startSetup: vi.fn(async () => undefined),
    cancelSetup: vi.fn(async () => undefined),
    rotate: vi.fn(async () => undefined),
    changePassphrase: vi.fn(async () => undefined),
    dismissOperation: vi.fn(),
    clearNotice: vi.fn(),
    resetEncryption: vi.fn(async () => undefined),
    ...overrides,
  };

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root!.render(
      <LocaleProvider>
        <EncryptionProvider value={value}>
          <EncryptionSettings />
        </EncryptionProvider>
      </LocaleProvider>
    );
  });

  return value;
}

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.replaceChildren();
  root = undefined;
  container = undefined;
  vi.restoreAllMocks();
});

describe("EncryptionSettings", () => {
  it("changes the passphrase and reports success", async () => {
    const value = mount();
    const passwords = container!.querySelectorAll('input[type="password"]');

    change(passwords[0] as HTMLInputElement, "old correct horse battery");
    change(passwords[1] as HTMLInputElement, "new correct horse battery");
    change(passwords[2] as HTMLInputElement, "new correct horse battery");

    act(() => buttonByText(container!, "Change passphrase").click());
    await settle();

    expect(value.changePassphrase).toHaveBeenCalledWith(
      "old correct horse battery",
      "new correct horse battery"
    );
    expect(container?.textContent).toContain("Passphrase changed.");
  });

  it("announces an incorrect current passphrase", async () => {
    const value = mount({
      changePassphrase: vi.fn(async () => {
        throw new CryptoError("authentication_failed", "wrong");
      }),
    });
    const passwords = container!.querySelectorAll('input[type="password"]');

    change(passwords[0] as HTMLInputElement, "wrong current passphrase");
    change(passwords[1] as HTMLInputElement, "new correct horse battery");
    change(passwords[2] as HTMLInputElement, "new correct horse battery");

    act(() => buttonByText(container!, "Change passphrase").click());
    await settle();

    expect(value.changePassphrase).toHaveBeenCalled();
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain(
      "current passphrase is incorrect"
    );
  });

  it("confirms rotation and locks the workspace on request", async () => {
    const value = mount({ pendingRotation: true });
    const rotationInput = container!.querySelector(
      'input[data-testid="rotation-passphrase"]'
    ) as HTMLInputElement | null;

    expect(rotationInput).not.toBeNull();
    change(rotationInput!, "correct horse battery staple");
    act(() => buttonByText(container!, "Rotate key").click());
    await settle();

    expect(container?.textContent).toContain("Rotate the workspace key?");
    act(() => buttonByText(container!, "Rotate key").click());
    await settle();

    expect(value.rotate).toHaveBeenCalledWith("correct horse battery staple");

    act(() => buttonByText(container!, "Lock now").click());
    await settle();
    expect(value.lock).toHaveBeenCalled();
  });

  it("shows pending rotation recovery state", () => {
    mount({ pendingRotation: true });

    expect(container?.textContent).toContain("Rotation needs to finish");
  });
});
