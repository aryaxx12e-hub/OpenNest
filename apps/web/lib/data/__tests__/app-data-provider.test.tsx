import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAiProviderRegistry, type AiProviderInput } from "@opennest/ai";
import { createMemoryCredentialVaultStore } from "@opennest/credential-vault";
import { createMemoryStorage, type StorageAdapter } from "@opennest/core";
import {
  createExtensionPackage,
  createMemoryExtensionStore,
  type ExtensionManifest,
  type StoredExtension,
} from "@opennest/extensions";
import { LocaleProvider } from "@opennest/localization";
import { createMemoryPrivacyStore, type PrivacyStore } from "@opennest/privacy";

import { createMemoryAiStore } from "../../ai/store";
import {
  AppDataProvider,
  useAppData,
  useAppRevision,
  type AppDataProviderProps,
  type ReadyAppData,
} from "../app-data-provider";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROVIDER_INPUT: AiProviderInput = {
  label: "Local",
  kind: "local",
  adapter: "openai-compatible",
  endpoint: "http://127.0.0.1:11434/v1",
  models: ["llama3.2"],
  capabilities: ["chat"],
  auth: "none",
  dataPolicyUrl: null,
  maxContextTokens: null,
  maxOutputTokens: null,
};

const EXTENSION_MANIFEST: ExtensionManifest = {
  id: "com.example.demo",
  name: "Demo extension",
  version: "1.0.0",
  publisher: "Example",
  description: "A demo extension.",
  tier: 1,
  entry: "index.js",
  capabilities: ["workspace.read.metadata"],
  dataScopes: ["notes"],
  networkOrigins: [],
  minHostVersion: "0.1.0",
};

async function extensionRecord(): Promise<StoredExtension> {
  const code = "opennest.ready();";
  const pkg = await createExtensionPackage({
    manifest: EXTENSION_MANIFEST,
    code,
  });

  return {
    id: EXTENSION_MANIFEST.id,
    manifest: EXTENSION_MANIFEST,
    code,
    integrity: pkg.integrity,
    installedAt: 1,
    updatedAt: 1,
    enabled: true,
  };
}

function Probe({ onReady }: { onReady?: (data: ReadyAppData) => void }) {
  const data = useAppData();
  const revision = useAppRevision();

  return (
    <div>
      <span data-testid="workspace">{data.workspace.name}</span>
      <span data-testid="revision">{revision}</span>
      <span data-testid="privacy">
        {data.privacy === undefined ? "missing" : "ready"}
      </span>
      <span data-testid="ai">{data.ai === undefined ? "missing" : "ready"}</span>
      <span data-testid="credentials">
        {data.credentials === undefined ? "missing" : "ready"}
      </span>
      <span data-testid="extensions">
        {data.extensions === undefined ? "missing" : "ready"}
      </span>
      <span data-testid="storage">{"storage" in data ? "exposed" : "hidden"}</span>
      <button type="button" onClick={data.invalidate}>
        refresh
      </button>
      <button type="button" data-testid="capture" onClick={() => onReady?.(data)}>
        capture
      </button>
    </div>
  );
}

interface MountOptions {
  provider?: Omit<AppDataProviderProps, "children" | "openStorage">;
  onReady?: (data: ReadyAppData) => void;
}

function mount(openStorage: () => Promise<StorageAdapter>, options: MountOptions = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root: Root = createRoot(container);

  act(() => {
    root.render(
      <LocaleProvider>
        <AppDataProvider openStorage={openStorage} {...options.provider}>
          <Probe onReady={options.onReady} />
        </AppDataProvider>
      </LocaleProvider>
    );
  });

  return { container, root };
}

async function settle() {
  for (let index = 0; index < 50; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

function capturedRuntime(container: HTMLElement, ready: () => ReadyAppData | null) {
  act(() => container.querySelector<HTMLElement>('[data-testid="capture"]')?.click());
  const data = ready();

  if (data === null) {
    throw new Error("App data did not become ready.");
  }

  return data;
}

describe("AppDataProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.replaceChildren();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("opens storage, ensures the workspace, and exposes services", async () => {
    const storage = createMemoryStorage();
    const { container, root } = mount(async () => storage);

    await settle();

    expect(container.textContent).toContain("My Library");
    expect(container.textContent).toContain("0");
    expect(container.querySelector('[data-testid="privacy"]')?.textContent).toBe("ready");
    expect(container.querySelector('[data-testid="ai"]')?.textContent).toBe("ready");
    expect(container.querySelector('[data-testid="credentials"]')?.textContent).toBe(
      "ready"
    );
    expect(container.querySelector('[data-testid="extensions"]')?.textContent).toBe(
      "ready"
    );
    expect(container.querySelector('[data-testid="storage"]')?.textContent).toBe(
      "hidden"
    );

    const button = container.querySelector("button");
    act(() => button?.click());

    expect(container.textContent).toContain("1");

    act(() => root.unmount());
  });

  it("shows a recoverable error when browser storage cannot open", async () => {
    const { container, root } = mount(async () => {
      throw new Error("blocked");
    });

    await settle();

    expect(container.textContent).toContain("Your library could not be opened");

    act(() => root.unmount());
  });

  it("clears AI, vault, session credentials, and consents on delete all", async () => {
    const storage = createMemoryStorage();
    const aiStore = createMemoryAiStore();
    const registry = createAiProviderRegistry({
      store: aiStore.providers,
      now: () => 1,
      generateId: () => "local",
    });
    await registry.create(PROVIDER_INPUT);
    await aiStore.setEnabled(true);
    const privacyStore = createMemoryPrivacyStore();
    const credentialStore = createMemoryCredentialVaultStore();
    let ready: ReadyAppData | null = null;
    const { container, root } = mount(async () => storage, {
      provider: {
        openAiStore: async () => aiStore,
        openPrivacyStore: async () => privacyStore,
        openCredentialStore: async () => credentialStore,
      },
      onReady: (data) => {
        ready = data;
      },
    });

    await settle();

    expect(container.querySelector('[data-testid="ai"]')?.textContent).toBe("ready");
    expect(container.querySelector('[data-testid="credentials"]')?.textContent).toBe(
      "ready"
    );

    const data = capturedRuntime(container, () => ready);
    await data.credentials.createSessionCredential({
      providerId: "openai",
      accountLabel: "Work",
      secret: "sk-session-secret",
    });
    await data.credentials.setupVault("correct horse battery staple");
    const session = data.credentials.getVaultSession();

    expect(session).not.toBeNull();
    await data.credentials.vault.create(session!, {
      providerId: "openai",
      accountLabel: "Vault",
      secret: "sk-vault-secret",
    });
    await data.privacy.consents.create({
      sessionId: data.privacy.sessionId,
      principalId: data.privacy.principal.id,
      providerId: "local",
      model: "llama3.2",
      endpointOrigin: "http://127.0.0.1:11434",
      payloadHash: "a".repeat(64),
      payloadBytes: 32,
      dataClasses: ["D1"],
      purpose: "Test consent cleanup",
      expiresAt: Date.now() + 60_000,
    });

    expect(await privacyStore.consents.list()).toHaveLength(1);
    expect(data.credentials.session.list()).toHaveLength(1);

    await data.privacy.data.deleteAll();

    expect(await aiStore.getEnabled()).toBe(false);
    expect(await aiStore.providers.list()).toEqual([]);
    expect(await privacyStore.consents.list()).toEqual([]);
    expect(data.credentials.session.list()).toEqual([]);
    expect(data.credentials.getVaultSession()).toBeNull();
    await expect(data.credentials.vault.hasVault()).resolves.toBe(false);

    act(() => root.unmount());
  });

  it("loads extensions and clears extension data on delete all without disposing", async () => {
    const storage = createMemoryStorage();
    const extensionStore = createMemoryExtensionStore();
    const record = await extensionRecord();
    await extensionStore.extensions.put(record);
    await extensionStore.storage.set(record.id, "count", "1");
    let ready: ReadyAppData | null = null;
    const { container, root } = mount(async () => storage, {
      provider: {
        openExtensionStore: async () => extensionStore,
      },
      onReady: (data) => {
        ready = data;
      },
    });

    await settle();

    const data = capturedRuntime(container, () => ready);
    await expect(data.extensions.registry.list()).resolves.toEqual([record]);

    await data.privacy.data.deleteAll();

    expect(await extensionStore.extensions.list()).toEqual([]);
    expect(await extensionStore.storage.keys(record.id)).toEqual([]);
    await expect(data.extensions.registry.list()).resolves.toEqual([]);

    await extensionStore.extensions.put(record);
    await expect(data.extensions.registry.list()).resolves.toEqual([record]);

    act(() => root.unmount());
  });

  it("exposes AI and disposes AI, credentials, then privacy on unmount", async () => {
    const storage = createMemoryStorage();
    const order: string[] = [];
    const aiStore = createMemoryAiStore();
    const closeAi = aiStore.close.bind(aiStore);
    aiStore.close = async () => {
      order.push("ai");
      await closeAi();
    };
    const basePrivacyStore = createMemoryPrivacyStore();
    const privacyStore: PrivacyStore = {
      ...basePrivacyStore,
      async close() {
        order.push("privacy");
        await basePrivacyStore.close();
      },
    };
    const credentialStore = {
      ...createMemoryCredentialVaultStore(),
      async close() {
        order.push("credentials");
      },
    };
    const baseExtensionStore = createMemoryExtensionStore();
    const extensionStore = {
      ...baseExtensionStore,
      async close() {
        order.push("extensions");
        await baseExtensionStore.close();
      },
    };
    let ready: ReadyAppData | null = null;
    const { container, root } = mount(async () => storage, {
      provider: {
        openAiStore: async () => aiStore,
        openPrivacyStore: async () => privacyStore,
        openCredentialStore: async () => credentialStore,
        openExtensionStore: async () => extensionStore,
      },
      onReady: (data) => {
        ready = data;
      },
    });

    await settle();

    const data = capturedRuntime(container, () => ready);
    act(() => root.unmount());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(order).toEqual(["ai", "credentials", "extensions", "privacy"]);
    await expect(data.ai.isEnabled()).rejects.toMatchObject({
      code: "runtime_disposed",
    });
    await expect(data.extensions.start("com.example.demo")).rejects.toMatchObject({
      code: "runtime_disposed",
    });
    await expect(
      data.credentials.createSessionCredential({
        providerId: "openai",
        accountLabel: "Work",
        secret: "sk-session-secret",
      })
    ).rejects.toMatchObject({ code: "runtime_disposed" });
  });
});
