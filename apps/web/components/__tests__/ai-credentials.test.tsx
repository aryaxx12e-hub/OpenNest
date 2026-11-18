import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryCredentialVaultStore } from "@opennest/credential-vault";
import type { IsoDate } from "@opennest/core";
import { createMemoryStorage } from "@opennest/core";
import { LocaleProvider } from "@opennest/localization";
import { createMemoryPrivacyStore, createSequenceIds } from "@opennest/privacy";
import type { AiProviderInput, AiTransport } from "@opennest/ai";

import { createAiRuntime, type AiRuntime } from "@/lib/ai/runtime";
import { createMemoryAiStore } from "@/lib/ai/store";
import {
  createCredentialRuntime,
  type CredentialRuntime,
} from "@/lib/credentials/runtime";
import { createPlainDraftStore } from "@/lib/autosave/draft-store";
import { createAppServices } from "@/lib/data/services";
import { createPrivacyRuntime } from "@/lib/privacy/runtime";

import { AiCredentials } from "../ai-credentials";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse("2026-11-17T08:00:00.000Z");
const AT = "2026-11-17T08:00:00.000Z" as IsoDate;
const PASSPHRASE = "correct horse battery staple";
const SECRET = "sk-super-secret-value";

const PROVIDER_INPUT: AiProviderInput = {
  label: "OpenAI Cloud",
  kind: "remote",
  adapter: "openai-compatible",
  endpoint: "https://api.openai.com/v1",
  models: ["gpt-4.1-mini"],
  capabilities: ["chat"],
  auth: "bearer",
  dataPolicyUrl: null,
  maxContextTokens: 128_000,
  maxOutputTokens: 4_096,
};

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let cleanupRuntime: (() => Promise<void>) | undefined;

async function setupPrivacy() {
  const storage = createMemoryStorage();
  const { services, workspace } = await createAppServices(storage, {
    defaultWorkspaceName: "My Library",
    clock: () => AT,
    hash: async (value) => value.join(":"),
    generateBlobKey: () => "22222222-2222-4222-8222-222222222222",
  });

  return createPrivacyRuntime({
    storage,
    services,
    workspace,
    drafts: createPlainDraftStore(window.localStorage),
    openPrivacyStore: async () => createMemoryPrivacyStore(),
    now: () => NOW,
    generateId: createSequenceIds("store"),
  });
}

async function setup(): Promise<{
  ai: AiRuntime;
  credentials: CredentialRuntime;
  vaultStore: ReturnType<typeof createMemoryCredentialVaultStore>;
}> {
  const aiStore = createMemoryAiStore();
  const privacy = await setupPrivacy();
  const transport: AiTransport = {
    async send() {
      throw new Error("Unexpected network request");
    },
  };
  const ai = createAiRuntime({
    privacy,
    settings: aiStore,
    transport,
    now: () => NOW,
  });
  const vaultStore = createMemoryCredentialVaultStore();
  const credentials = await createCredentialRuntime({
    store: vaultStore,
    now: () => NOW,
    generateId: createSequenceIds("credential"),
  });

  cleanupRuntime = async () => {
    await ai.dispose();
    await credentials.dispose();
    await privacy.dispose();
  };

  return { ai, credentials, vaultStore };
}

function render(ai: AiRuntime, credentials: CredentialRuntime) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root!.render(
      <LocaleProvider>
        <AiCredentials ai={ai} credentials={credentials} />
      </LocaleProvider>
    );
  });
}

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

function fieldByTestId<T extends HTMLElement>(host: HTMLElement, id: string): T {
  const element = host.querySelector(`[data-testid="${id}"]`);

  if (element === null) {
    throw new Error(`No field named ${id}`);
  }

  return element as T;
}

function changeInput(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

  act(() => {
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function selectByText(element: HTMLSelectElement, text: string) {
  const option = Array.from(element.options).find(
    (candidate) => candidate.textContent?.trim() === text
  );

  if (option === undefined) {
    throw new Error(`No option named ${text}`);
  }

  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value"
  )?.set;

  act(() => {
    setter?.call(element, option.value);
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function toggleCheckbox(element: HTMLInputElement) {
  act(() => element.click());
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

beforeEach(() => {
  window.localStorage.clear();
  document.body.replaceChildren();
});

afterEach(async () => {
  act(() => root?.unmount());
  container?.remove();
  document.body.replaceChildren();
  root = undefined;
  container = undefined;
  await cleanupRuntime?.();
  cleanupRuntime = undefined;
  vi.restoreAllMocks();
});

describe("AiCredentials", () => {
  it("clears the session secret after saving and never renders it", async () => {
    const { ai, credentials } = await setup();
    const provider = await ai.createProvider(PROVIDER_INPUT);
    render(ai, credentials);
    await waitForText(container!, "Session credentials");

    selectByText(fieldByTestId(container!, "session-provider"), "OpenAI Cloud");
    changeInput(fieldByTestId(container!, "session-label"), "Work key");
    changeInput(fieldByTestId(container!, "session-secret"), SECRET);
    act(() => buttonByText(container!, "Save credential").click());
    await waitForText(container!, "Credential saved.");

    expect(fieldByTestId<HTMLInputElement>(container!, "session-secret").value).toBe("");
    expect(container!.textContent).not.toContain(SECRET);
    expect(credentials.session.list()).toHaveLength(1);

    const saved = credentials.session.list()[0];
    if (saved === undefined) {
      throw new Error("Expected a session credential");
    }

    expect(saved.providerId).toBe(provider.id);
    await expect(
      credentials.resolve({ kind: "session", id: saved.id, providerId: provider.id })
    ).resolves.toBe(SECRET);
  });

  it("warns that vault setup has no recovery and requires acknowledgement", async () => {
    const { ai, credentials } = await setup();
    render(ai, credentials);
    await waitForText(container!, "Set up vault");

    expect(container?.textContent).toContain("There is no recovery.");

    changeInput(fieldByTestId(container!, "vault-setup-passphrase"), PASSPHRASE);
    changeInput(fieldByTestId(container!, "vault-setup-confirm"), PASSPHRASE);
    act(() => buttonByText(container!, "Create vault").click());
    await waitForText(container!, "Acknowledge that there is no recovery.");

    expect(await credentials.vault.hasVault()).toBe(false);

    toggleCheckbox(fieldByTestId(container!, "vault-setup-ack"));
    act(() => buttonByText(container!, "Create vault").click());
    await waitForText(container!, "Vault unlocked");

    expect(await credentials.vault.hasVault()).toBe(true);
  });

  it("shows a wrong passphrase message and then the rate limit message", async () => {
    const { ai, credentials, vaultStore } = await setup();
    await credentials.setupVault(PASSPHRASE);
    credentials.lockVault();
    render(ai, credentials);
    await waitForText(container!, "Vault locked");

    changeInput(
      fieldByTestId(container!, "vault-unlock-passphrase"),
      "wrong passphrase value"
    );
    act(() => buttonByText(container!, "Unlock vault").click());
    await waitForText(container!, "The vault passphrase is incorrect.");

    const record = await vaultStore.get();

    if (record === null) {
      throw new Error("Vault record is missing");
    }

    await vaultStore.put({ ...record, failedAttempts: 4, retryAfter: null });
    changeInput(
      fieldByTestId(container!, "vault-unlock-passphrase"),
      "wrong passphrase value"
    );
    act(() => buttonByText(container!, "Unlock vault").click());
    await waitForText(container!, "Too many attempts. Wait 30 seconds and try again.");
  });
});
