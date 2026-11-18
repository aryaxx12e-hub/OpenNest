import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AiProviderInput,
  AiTransport,
  AiTransportRequest,
  AiTransportResponse,
} from "@opennest/ai";
import type { IsoDate } from "@opennest/core";
import { createMemoryStorage } from "@opennest/core";
import { createMemoryCredentialVaultStore } from "@opennest/credential-vault";
import { LocaleProvider } from "@opennest/localization";
import { createMemoryPrivacyStore, createSequenceIds } from "@opennest/privacy";

import { createPlainDraftStore } from "@/lib/autosave/draft-store";
import { createAiRuntime, type AiRuntime } from "@/lib/ai/runtime";
import { createMemoryAiStore } from "@/lib/ai/store";
import { createAppServices } from "@/lib/data/services";
import {
  createCredentialRuntime,
  type CredentialRuntime,
} from "@/lib/credentials/runtime";
import { createPrivacyRuntime } from "@/lib/privacy/runtime";

import { AiConsole } from "../ai-console";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse("2026-11-17T08:00:00.000Z");
const AT = "2026-11-17T08:00:00.000Z" as IsoDate;
const PROMPT = "Summarize this short note without attaching any files.";
const SECRET = "sk-console-secret-value";

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

class FakeTransport implements AiTransport {
  readonly requests: AiTransportRequest[] = [];

  constructor(
    private readonly handler: (
      request: AiTransportRequest
    ) => AiTransportResponse | Promise<AiTransportResponse> = () =>
      jsonResponse(completion("Hello"))
  ) {}

  async send(request: AiTransportRequest): Promise<AiTransportResponse> {
    this.requests.push(request);
    return this.handler(request);
  }
}

function completion(text: string): unknown {
  return {
    model: "gpt-4.1-mini",
    choices: [{ message: { content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function jsonResponse(body: unknown): AiTransportResponse {
  return {
    status: 200,
    headers: new Headers(),
    body: null,
    text: async () => JSON.stringify(body),
  };
}

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

async function setup(
  options: {
    enabled?: boolean;
    transport?: FakeTransport;
    withCredential?: boolean;
  } = {}
): Promise<{
  ai: AiRuntime;
  credentials: CredentialRuntime;
  transport: FakeTransport;
}> {
  const aiStore = createMemoryAiStore();
  const privacy = await setupPrivacy();
  const transport = options.transport ?? new FakeTransport();
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
  const provider = await ai.createProvider(PROVIDER_INPUT);

  if (options.enabled ?? true) {
    await ai.setEnabled(true);
  }

  if (options.withCredential ?? true) {
    await credentials.createSessionCredential({
      providerId: provider.id,
      accountLabel: "Work key",
      secret: SECRET,
    });
  }

  cleanupRuntime = async () => {
    await ai.dispose();
    await credentials.dispose();
    await privacy.dispose();
  };

  return { ai, credentials, transport };
}

function render(ai: AiRuntime, credentials: CredentialRuntime) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root!.render(
      <LocaleProvider>
        <AiConsole ai={ai} credentials={credentials} />
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

async function waitFor(condition: () => boolean, label: string) {
  for (let index = 0; index < 500; index += 1) {
    if (condition()) {
      return;
    }

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }

  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForText(host: HTMLElement, text: string) {
  await waitFor(() => host.textContent?.includes(text) === true, text);
}

async function preparePrompt(host: HTMLElement) {
  await waitForText(host, "Review request");
  selectByText(fieldByTestId(host, "ai-console-provider"), "OpenAI Cloud");
  selectByText(fieldByTestId(host, "ai-console-model"), "gpt-4.1-mini");
  selectByText(fieldByTestId(host, "ai-console-credential"), "Work key");
  changeInput(fieldByTestId(host, "ai-console-prompt"), PROMPT);
  act(() => buttonByText(host, "Review request").click());
  await waitFor(() => openDialog(host) !== null, "consent dialog");
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

describe("AiConsole", () => {
  it("shows AI off and makes no network call", async () => {
    const { ai, credentials, transport } = await setup({ enabled: false });
    render(ai, credentials);
    await waitForText(container!, "AI is off");

    expect(container!.querySelector('[data-testid="ai-console-prompt"]')).toBeNull();
    expect(container!.querySelector('[data-testid="ai-console-review"]')).toBeNull();
    expect(transport.requests).toHaveLength(0);
  });

  it("prepares the exact consent preview without sending", async () => {
    const { ai, credentials, transport } = await setup();
    render(ai, credentials);
    await preparePrompt(container!);

    const dialog = openDialog(container!);
    expect(dialog?.textContent).toContain("OpenAI Cloud");
    expect(dialog?.textContent).toContain("https://api.openai.com");
    expect(dialog?.textContent).toContain("gpt-4.1-mini");
    expect(dialog?.textContent).toContain("D2");
    expect(dialog?.textContent).toContain(
      "No workspace files, notes, folders, or chat history are attached."
    );
    expect(fieldByTestId(dialog!, "ai-consent-prompt").textContent).toBe(PROMPT);
    expect(transport.requests).toHaveLength(0);
    expect(await ai.listConsents()).toHaveLength(0);
  });

  it("cancels without sending", async () => {
    const { ai, credentials, transport } = await setup();
    render(ai, credentials);
    await preparePrompt(container!);

    act(() => buttonByText(container!, "Cancel").click());
    await waitFor(() => openDialog(container!) === null, "dialog closed");

    expect(transport.requests).toHaveLength(0);
    expect(await ai.listConsents()).toHaveLength(0);
  });

  it("sends once after approval and blocks a double approval", async () => {
    let resolveResponse: (() => void) | undefined;
    const transport = new FakeTransport(
      () =>
        new Promise<AiTransportResponse>((resolve) => {
          resolveResponse = () => resolve(jsonResponse(completion("Hello from AI")));
        })
    );
    const { ai, credentials } = await setup({ transport });
    render(ai, credentials);
    await preparePrompt(container!);

    const approve = buttonByText(container!, "Approve and send");
    act(() => {
      approve.click();
      approve.click();
    });
    await waitForText(container!, "Sending...");
    await waitFor(() => resolveResponse !== undefined, "deferred response");

    if (resolveResponse === undefined) {
      throw new Error("Expected a deferred response");
    }

    resolveResponse();
    await waitForText(container!, "Hello from AI");

    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.body).toBe(
      JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: PROMPT }],
        stream: false,
      })
    );
    expect(transport.requests[0]?.credential?.kind).toBe("session");

    const consents = await ai.listConsents();
    expect(consents).toHaveLength(1);
    expect(consents[0]?.usedAt).not.toBeNull();
  });

  it("renders response HTML as text", async () => {
    const payload = '<img src=x onerror="alert(1)"><b>bold</b>';
    const { ai, credentials } = await setup({
      transport: new FakeTransport(() => jsonResponse(completion(payload))),
    });
    render(ai, credentials);
    await preparePrompt(container!);
    act(() => buttonByText(container!, "Approve and send").click());
    await waitFor(
      () => container!.querySelector('[data-testid="ai-console-response"]') !== null,
      "response"
    );

    const response = fieldByTestId<HTMLPreElement>(container!, "ai-console-response");
    expect(response.textContent).toContain(payload);
    expect(response.querySelector("img")).toBeNull();
    expect(response.querySelector("b")).toBeNull();
  });

  it("aborts an active request and does not retry", async () => {
    const transport = new FakeTransport(
      (request) =>
        new Promise<AiTransportResponse>((_resolve, reject) => {
          const abort = () => reject(new DOMException("Aborted", "AbortError"));

          if (request.signal.aborted) {
            abort();
            return;
          }

          request.signal.addEventListener("abort", abort, { once: true });
        })
    );
    const { ai, credentials } = await setup({ transport });
    render(ai, credentials);
    await preparePrompt(container!);
    act(() => buttonByText(container!, "Approve and send").click());
    await waitFor(() => transport.requests.length === 1, "transport request");
    await waitForText(container!, "Cancel request");
    act(() => buttonByText(container!, "Cancel request").click());
    await waitForText(container!, "Cancelled");

    expect(buttonByText(container!, "Review again")).toBeTruthy();
    expect(transport.requests).toHaveLength(1);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    expect(transport.requests).toHaveLength(1);
  });

  it("does not persist prompts or responses in localStorage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { ai, credentials } = await setup({
      transport: new FakeTransport(() => jsonResponse(completion("Persist nothing"))),
    });
    render(ai, credentials);
    await preparePrompt(container!);
    act(() => buttonByText(container!, "Approve and send").click());
    await waitForText(container!, "Persist nothing");

    expect(setItem).not.toHaveBeenCalled();
    expect(JSON.stringify(window.localStorage)).not.toContain(PROMPT);
    expect(JSON.stringify(window.localStorage)).not.toContain("Persist nothing");
  });
});
