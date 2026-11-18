import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import {
  createAiProviderRegistry,
  type AiProviderConfig,
  type AiProviderInput,
  type AiTransport,
  type AiTransportResponse,
} from "@opennest/ai";
import { createMemoryStorage, type IsoDate } from "@opennest/core";
import { createMemoryPrivacyStore, createSequenceIds } from "@opennest/privacy";

import { createPlainDraftStore } from "@/lib/autosave/draft-store";
import { createAppServices, sha256Hex } from "@/lib/data/services";
import { createPrivacyRuntime } from "@/lib/privacy/runtime";

import { createAiRuntime } from "../runtime";
import { createDexieAiStore, createMemoryAiStore } from "../store";

const NOW = Date.parse("2026-11-17T08:00:00.000Z");
const AT = "2026-11-17T08:00:00.000Z" as IsoDate;

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

const PROVIDER: AiProviderConfig = {
  ...PROVIDER_INPUT,
  id: "local",
  createdAt: NOW,
  updatedAt: NOW,
};

function uniqueDatabaseName(): string {
  return `opennest-ai-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function setupPrivacy() {
  const storage = createMemoryStorage();
  const { services, workspace } = await createAppServices(storage, {
    defaultWorkspaceName: "My Library",
    clock: () => AT,
    hash: sha256Hex,
    generateBlobKey: () => "22222222-2222-4222-8222-222222222222",
  });
  const privacy = await createPrivacyRuntime({
    storage,
    services,
    workspace,
    drafts: createPlainDraftStore(window.localStorage),
    openPrivacyStore: async () => createMemoryPrivacyStore(),
    now: () => NOW,
    generateId: createSequenceIds("store"),
  });

  return privacy;
}

describe("AI store", () => {
  it("defaults off and persists providers and settings across reopen", async () => {
    const databaseName = uniqueDatabaseName();
    const store = createDexieAiStore({ databaseName });
    await store.init();

    expect(await store.getEnabled()).toBe(false);

    const registry = createAiProviderRegistry({
      store: store.providers,
      now: () => NOW,
      generateId: () => "local",
    });
    const created = await registry.create(PROVIDER_INPUT);

    await store.setEnabled(true);
    await store.close();

    const reopened = createDexieAiStore({ databaseName });
    await reopened.init();

    expect(await reopened.getEnabled()).toBe(true);
    expect(await reopened.providers.get(created.id)).toEqual(created);
    expect((await reopened.providers.list()).map((provider) => provider.id)).toEqual([
      "local",
    ]);

    await reopened.reset();

    expect(await reopened.getEnabled()).toBe(false);
    expect(await reopened.providers.list()).toEqual([]);
    await reopened.close();
  });

  it("keeps the memory store disabled until explicitly enabled and reset", async () => {
    const store = createMemoryAiStore();
    await store.init();

    expect(await store.getEnabled()).toBe(false);
    await store.providers.put(PROVIDER);
    await store.setEnabled(true);
    expect(await store.getEnabled()).toBe(true);

    await store.reset();

    expect(await store.getEnabled()).toBe(false);
    expect(await store.providers.list()).toEqual([]);
    await store.close();
  });

  it("disabling AI aborts active requests but keeps provider configs", async () => {
    const store = createMemoryAiStore();
    await store.providers.put(PROVIDER);
    await store.setEnabled(true);
    const privacy = await setupPrivacy();
    let started: () => void = () => undefined;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const transport: AiTransport = {
      async send(request) {
        started();
        return new Promise<AiTransportResponse>((_resolve, reject) => {
          request.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        });
      },
    };
    const runtime = createAiRuntime({
      privacy,
      settings: store,
      transport,
      now: () => NOW,
    });
    const prepared = await runtime.prepare({
      providerId: "local",
      model: "llama3.2",
      messages: [{ role: "user", content: "Hello" }],
      dataClasses: ["D1"],
      purpose: "Test the local model",
      credential: null,
      stream: false,
    });
    const pending = runtime.approveAndSend(prepared);

    await startedPromise;
    await runtime.setEnabled(false);

    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(await store.getEnabled()).toBe(false);
    expect(await store.providers.get("local")).toEqual(PROVIDER);
    await runtime.dispose();
    await privacy.dispose();
  });

  it("waits for active requests before disposing", async () => {
    const store = createMemoryAiStore();
    await store.providers.put(PROVIDER);
    await store.setEnabled(true);
    const privacy = await setupPrivacy();
    let started: () => void = () => undefined;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    let settled = false;
    const transport: AiTransport = {
      async send(request) {
        started();
        return new Promise<AiTransportResponse>((_resolve, reject) => {
          request.signal.addEventListener(
            "abort",
            () => {
              setTimeout(() => {
                settled = true;
                reject(new DOMException("Aborted", "AbortError"));
              }, 20);
            },
            { once: true }
          );
        });
      },
    };
    const runtime = createAiRuntime({
      privacy,
      settings: store,
      transport,
      now: () => NOW,
    });
    const prepared = await runtime.prepare({
      providerId: "local",
      model: "llama3.2",
      messages: [{ role: "user", content: "Hello" }],
      dataClasses: ["D1"],
      purpose: "Test disposal",
      credential: null,
      stream: false,
    });
    const pending = runtime.approveAndSend(prepared).catch(() => undefined);

    await startedPromise;
    await runtime.dispose();

    expect(settled).toBe(true);
    await pending;
    expect((await privacy.audit.list()).at(-1)?.event).toBe("ai.aborted");
    await privacy.dispose();
  });
});
