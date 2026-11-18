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
import { createMemoryAiStore, type AiStore } from "@/lib/ai/store";
import {
  createCredentialRuntime,
  type CredentialRuntime,
} from "@/lib/credentials/runtime";
import { createPlainDraftStore } from "@/lib/autosave/draft-store";
import { createAppServices } from "@/lib/data/services";
import { createPrivacyRuntime } from "@/lib/privacy/runtime";

import { AiSettings } from "../ai-settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse("2026-11-17T08:00:00.000Z");
const AT = "2026-11-17T08:00:00.000Z" as IsoDate;
const PASSPHRASE = "correct horse battery staple";

const PROVIDER_INPUT: AiProviderInput = {
  label: "OpenAI Cloud",
  kind: "remote",
  adapter: "openai-compatible",
  endpoint: "https://api.openai.com/v1",
  models: ["gpt-4.1-mini"],
  capabilities: ["chat"],
  auth: "bearer",
  dataPolicyUrl: "https://openai.com/policies/privacy-policy",
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
  aiStore: AiStore;
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

  return { ai, credentials, aiStore, vaultStore };
}

function render(ai: AiRuntime, credentials: CredentialRuntime) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root!.render(
      <LocaleProvider>
        <AiSettings ai={ai} credentials={credentials} />
      </LocaleProvider>
    );
  });
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

async function waitFor(check: () => boolean) {
  for (let index = 0; index < 500; index += 1) {
    if (check()) {
      return;
    }

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }

  throw new Error("Timed out waiting for condition");
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

describe("AiSettings", () => {
  it("shows AI off by default and disables the console link until enabled", async () => {
    const { ai, credentials } = await setup();
    render(ai, credentials);
    await waitForText(container!, "No session credentials.");

    const toggle = fieldByTestId<HTMLInputElement>(container!, "ai-enabled");
    const link = container!.querySelector('a[href="/ai"]');

    expect(toggle.checked).toBe(false);
    expect(link?.getAttribute("aria-disabled")).toBe("true");

    toggleCheckbox(toggle);
    await waitFor(() => link?.getAttribute("aria-disabled") !== "true");

    expect(await ai.isEnabled()).toBe(true);
  });

  it("requires the local warning, then creates and edits a local provider", async () => {
    const { ai, credentials } = await setup();
    render(ai, credentials);
    await waitForText(container!, "No session credentials.");

    act(() => buttonByText(container!, "Add provider").click());
    await waitFor(() => openDialog(container!) !== null);
    selectByText(fieldByTestId(container!, "provider-preset"), "Ollama");
    changeInput(fieldByTestId(container!, "provider-label"), "Local test");

    act(() => buttonByText(container!, "Save provider").click());
    await waitForText(container!, "Acknowledge the local endpoint warning");

    expect(await ai.listProviders()).toEqual([]);

    toggleCheckbox(fieldByTestId(container!, "provider-local-warning"));
    act(() => buttonByText(container!, "Save provider").click());
    await waitForText(container!, "Local test");

    const [created] = await ai.listProviders();
    if (created === undefined) {
      throw new Error("Expected a created provider");
    }

    expect(created.label).toBe("Local test");
    expect(created.kind).toBe("local");

    act(() => buttonByText(container!, "Edit").click());
    await waitFor(() => openDialog(container!) !== null);
    changeInput(fieldByTestId(container!, "provider-label"), "Local renamed");
    act(() => buttonByText(container!, "Save provider").click());
    await waitForText(container!, "Local renamed");

    const [renamed] = await ai.listProviders();
    expect(renamed?.label).toBe("Local renamed");
  });

  it("rejects a remote HTTP endpoint inline without saving", async () => {
    const { ai, credentials } = await setup();
    render(ai, credentials);
    await waitForText(container!, "No session credentials.");

    act(() => buttonByText(container!, "Add provider").click());
    await waitFor(() => openDialog(container!) !== null);
    selectByText(fieldByTestId(container!, "provider-preset"), "Custom");
    changeInput(fieldByTestId(container!, "provider-label"), "HTTP provider");
    changeInput(fieldByTestId(container!, "provider-endpoint"), "http://example.com/v1");

    act(() => buttonByText(container!, "Save provider").click());
    await waitForText(container!, "Remote providers must use HTTPS.");

    expect(await ai.listProviders()).toEqual([]);
    expect(openDialog(container!)).not.toBeNull();
  });

  it("removes session credentials but keeps vault entries unlinked when a provider is deleted", async () => {
    const { ai, credentials } = await setup();
    const provider = await ai.createProvider(PROVIDER_INPUT);
    await credentials.createSessionCredential({
      providerId: provider.id,
      accountLabel: "Session key",
      secret: "sk-session",
    });
    await credentials.setupVault(PASSPHRASE);
    const vaultSession = credentials.getVaultSession();

    if (vaultSession === null) {
      throw new Error("Vault did not unlock");
    }

    await credentials.vault.create(vaultSession, {
      providerId: provider.id,
      accountLabel: "Vault key",
      secret: "vault-secret",
    });

    render(ai, credentials);
    await waitForText(container!, "Session key");
    await waitForText(container!, "Vault key");

    act(() =>
      fieldByTestId<HTMLButtonElement>(
        container!,
        `delete-provider-${provider.id}`
      ).click()
    );
    await waitForText(container!, "Delete provider?");
    act(() => buttonByText(container!, "Delete provider").click());
    await waitForText(container!, "Provider deleted.");

    expect(credentials.session.list()).toEqual([]);
    const entries = await credentials.vault.list(vaultSession);
    expect(entries.map((entry) => entry.accountLabel)).toEqual(["Vault key"]);
    await waitForText(container!, "Unlinked");
  });
});
