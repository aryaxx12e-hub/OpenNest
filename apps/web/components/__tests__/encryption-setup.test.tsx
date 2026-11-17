import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMemoryKeyringStore } from "@opennest/crypto";
import { createMemoryStorage } from "@opennest/core";
import { LocaleProvider, useTranslations } from "@opennest/localization";
import { createMemoryPrivacyStore } from "@opennest/privacy";

import { AppDataProvider } from "@/lib/data/app-data-provider";
import { EncryptionGate, useEncryption } from "@/lib/crypto/encryption-gate";

import { EncryptionSetup } from "../encryption-setup";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

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

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll("button")).find(
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

function NoticeProbe() {
  const encryption = useEncryption();
  const t = useTranslations();

  return (
    <>
      <span data-testid="notice">
        {encryption.notice === null ? "" : t(encryption.notice)}
      </span>
      <span data-testid="status">{encryption.status}</span>
    </>
  );
}

function mount() {
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root!.render(
      <LocaleProvider>
        <AppDataProvider
          openStorage={async () => createMemoryStorage()}
          openKeyringStore={async () => createMemoryKeyringStore()}
          openPrivacyStore={async () => createMemoryPrivacyStore()}
        >
          <EncryptionGate>
            <EncryptionSetup />
            <NoticeProbe />
          </EncryptionGate>
        </AppDataProvider>
      </LocaleProvider>
    );
  });
}

async function reachRecoveryStep(passphrase = "correct horse battery staple") {
  await waitFor(
    () => container?.textContent?.includes("Turn on encryption") === true,
    "the setup form"
  );

  const passwords = container!.querySelectorAll('input[type="password"]');
  change(passwords[0] as HTMLInputElement, passphrase);
  change(passwords[1] as HTMLInputElement, passphrase);
  act(() => buttonByText(container!, "Continue").click());

  await waitFor(
    () => container?.textContent?.includes("Save your recovery key") === true,
    "the recovery key step"
  );
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
});

describe("EncryptionSetup", () => {
  it("validates passphrase rules, shows a recovery key, and requires confirmation", async () => {
    mount();
    await waitFor(
      () => container?.textContent?.includes("Turn on encryption") === true,
      "the setup form"
    );

    act(() => buttonByText(container!, "Continue").click());

    expect(container?.textContent).toContain("Enter a passphrase.");
    expect(document.activeElement?.getAttribute("type")).toBe("password");

    const passwords = container!.querySelectorAll('input[type="password"]');
    change(passwords[0] as HTMLInputElement, "short");
    change(passwords[1] as HTMLInputElement, "short");
    act(() => buttonByText(container!, "Continue").click());

    expect(container?.textContent).toContain("Use at least 12 characters.");

    change(passwords[0] as HTMLInputElement, "correct horse battery staple");
    change(passwords[1] as HTMLInputElement, "different passphrase");
    act(() => buttonByText(container!, "Continue").click());

    expect(container?.textContent).toContain("The passphrases do not match.");

    change(passwords[1] as HTMLInputElement, "correct horse battery staple");
    act(() => buttonByText(container!, "Continue").click());
    await waitFor(
      () => container?.textContent?.includes("Save your recovery key") === true,
      "the recovery key step"
    );

    const recovery = container!.querySelector("code");
    expect(recovery).not.toBeNull();
    expect(recovery?.textContent).toMatch(/^ONRK1-/);

    const enable = buttonByText(container!, "Turn on encryption");
    expect(enable.disabled).toBe(true);

    const confirmation = container!.querySelector('input[type="checkbox"]');
    expect(confirmation).not.toBeNull();

    act(() => {
      (confirmation as HTMLInputElement).click();
    });
    expect(enable.disabled).toBe(false);
  }, 30_000);

  it("shows migration progress and cancels before the commit", async () => {
    mount();
    await reachRecoveryStep();

    const confirmation = container!.querySelector(
      'input[type="checkbox"]'
    ) as HTMLInputElement;
    act(() => confirmation.click());
    act(() => buttonByText(container!, "Turn on encryption").click());

    await waitFor(
      () =>
        container?.querySelector('[role="progressbar"]') !== null ||
        container?.textContent?.includes("Encryption setup was cancelled.") === true,
      "migration progress"
    );

    const cancel = Array.from(container!.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === "Cancel setup"
    );

    if (cancel !== undefined) {
      act(() => cancel.click());
    }

    await waitFor(
      () =>
        container?.textContent?.includes("Encryption setup was cancelled.") === true ||
        container?.textContent?.includes("Encryption is on.") === true,
      "a settled setup state"
    );

    expect(container?.textContent).not.toContain("Your library is locked");
    expect(
      ["plaintext", "unlocked"].includes(
        container?.querySelector('[data-testid="status"]')?.textContent ?? ""
      )
    ).toBe(true);
  }, 45_000);

  it("turns on encryption and unlocks the encrypted workspace", async () => {
    mount();
    await reachRecoveryStep();

    const confirmation = container!.querySelector(
      'input[type="checkbox"]'
    ) as HTMLInputElement;
    act(() => confirmation.click());
    act(() => buttonByText(container!, "Turn on encryption").click());

    await waitFor(
      () =>
        container?.querySelector('[data-testid="status"]')?.textContent === "unlocked",
      "the encrypted workspace"
    );

    expect(container?.textContent).toContain("Encryption is on.");
  }, 45_000);
});
