import { describe, expect, it } from "vitest";

import {
  createMemoryAiProviderStore,
  type AiProviderConfig,
  type AiTransport,
  type AiTransportRequest,
  type AiTransportResponse,
} from "@opennest/ai";
import {
  createAuditLog,
  createCapabilityBroker,
  createConsentRegistry,
  createGrantRegistry,
  createMemoryPrivacyStore,
  createSequenceIds,
  type CapabilityRequest,
  type ConsentRecord,
} from "@opennest/privacy";

import {
  createAiRuntime,
  type AiCredentialChoice,
  type AiPrivacyDependencies,
  type AiRequestInput,
  type AiRuntime,
  type AiRuntimeSettings,
} from "../runtime";

const NOW = Date.parse("2026-11-17T08:00:00.000Z");
const SECRET = "sk-runtime-secret-value";
const PROMPT = `Please summarize this private note: ${SECRET}`;

const PROVIDER: AiProviderConfig = {
  id: "openai",
  label: "OpenAI",
  kind: "remote",
  adapter: "openai-compatible",
  endpoint: "https://api.openai.com/v1",
  models: ["gpt-4.1-mini"],
  capabilities: ["chat"],
  auth: "bearer",
  dataPolicyUrl: "https://openai.com/policies/privacy-policy",
  maxContextTokens: 128_000,
  maxOutputTokens: 4_096,
  createdAt: 1,
  updatedAt: 1,
};

const CREDENTIAL: AiCredentialChoice = {
  kind: "session",
  id: "credential-1",
  providerId: "openai",
};

class FakeTransport implements AiTransport {
  readonly requests: AiTransportRequest[] = [];

  constructor(
    private readonly handler: (
      request: AiTransportRequest
    ) => AiTransportResponse | Promise<AiTransportResponse> = () =>
      jsonResponse(completionBody())
  ) {}

  async send(request: AiTransportRequest): Promise<AiTransportResponse> {
    this.requests.push(request);
    return this.handler(request);
  }
}

interface SetupOptions {
  enabled?: boolean;
  provider?: AiProviderConfig | null;
  transport?: FakeTransport;
  tamperConsent?: (consent: ConsentRecord) => ConsentRecord;
  captureRequests?: CapabilityRequest[];
}

interface SetupResult {
  runtime: AiRuntime;
  privacy: AiPrivacyDependencies;
  settings: AiRuntimeSettings;
  transport: FakeTransport;
  advance: (milliseconds: number) => void;
}

async function setup(options: SetupOptions = {}): Promise<SetupResult> {
  let at = NOW;
  const now = () => at;
  const generateId = createSequenceIds("id");
  const store = createMemoryPrivacyStore();
  const grants = createGrantRegistry({ store: store.grants, now, generateId });
  const audit = createAuditLog({ store: store.audit, now, generateId });
  const baseConsents = createConsentRegistry({
    store: store.consents,
    now,
    generateId,
  });
  const consents =
    options.tamperConsent === undefined
      ? baseConsents
      : {
          ...baseConsents,
          async create(input: Parameters<typeof baseConsents.create>[0]) {
            const created = await baseConsents.create(input);
            const tampered = options.tamperConsent!(created);
            await store.consents.put(tampered);
            return tampered;
          },
        };
  const sessionId = "session-1";
  const principal = {
    id: "built-in:local",
    type: "built-in" as const,
    label: "OpenNest",
  };
  const baseBroker = createCapabilityBroker({
    principal,
    sessionId,
    grants,
    audit,
    now,
    generateId,
  });
  const broker =
    options.captureRequests === undefined
      ? baseBroker
      : {
          ...baseBroker,
          async request(request: CapabilityRequest) {
            options.captureRequests!.push(request);
            return baseBroker.request(request);
          },
        };
  const privacy: AiPrivacyDependencies = {
    sessionId,
    principal,
    consents,
    grants,
    audit,
    broker,
    async revokeConsent(id) {
      await consents.revoke(id, now());
      const linked = (await grants.list()).filter(
        (grant) => grant.auditRef === id && !grant.builtIn && grant.status === "active"
      );

      for (const grant of linked) {
        await broker.revoke(grant.id);
      }
    },
  };
  const providers = createMemoryAiProviderStore();

  if (options.provider !== null) {
    await providers.put(options.provider ?? PROVIDER);
  }

  let enabled = options.enabled ?? true;
  const settings: AiRuntimeSettings = {
    async getEnabled() {
      return enabled;
    },
    async setEnabled(next) {
      enabled = next;
    },
    providers,
  };
  const transport = options.transport ?? new FakeTransport();
  const runtime = createAiRuntime({
    privacy,
    settings,
    transport,
    now,
  });

  return {
    runtime,
    privacy,
    settings,
    transport,
    advance: (milliseconds) => {
      at += milliseconds;
    },
  };
}

function input(overrides: Partial<AiRequestInput> = {}): AiRequestInput {
  return {
    providerId: "openai",
    model: "gpt-4.1-mini",
    messages: [{ role: "user", content: PROMPT }],
    dataClasses: ["D1"],
    purpose: "Run the selected AI request",
    credential: CREDENTIAL,
    stream: false,
    ...overrides,
  };
}

function completionBody(): unknown {
  return {
    model: "gpt-4.1-mini",
    choices: [{ message: { content: "Hello" }, finish_reason: "stop" }],
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

function sseResponse(chunks: readonly string[]): AiTransportResponse {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }

      controller.close();
    },
  });

  return {
    status: 200,
    headers: new Headers(),
    body,
    text: async () => "",
  };
}

describe("AI runtime", () => {
  it("prepares without network or consent and sends only after approval", async () => {
    const env = await setup();
    const prepared = await env.runtime.prepare(input());

    expect(env.transport.requests).toHaveLength(0);
    expect(await env.privacy.consents.list()).toEqual([]);
    expect(await env.privacy.grants.list()).toEqual([]);

    const completion = await env.runtime.approveAndSend(prepared);

    expect(completion.text).toBe("Hello");
    expect(env.transport.requests).toHaveLength(1);

    const consent = (await env.privacy.consents.list())[0];
    expect(consent?.usedAt).toBe(NOW);
    expect(consent?.expiresAt).toBe(NOW + 5 * 60 * 1000);
    expect((await env.privacy.grants.list()).map((grant) => grant.capability)).toEqual(
      expect.arrayContaining([
        "ai.invoke:openai",
        "network.connect:https://api.openai.com",
        "credential.use:openai",
      ])
    );
    const audit = (await env.privacy.audit.list()).map((entry) => entry.event);
    expect(audit[0]).toBe("ai.requested");
    expect(audit.at(-1)).toBe("ai.completed");
  });

  it("rejects disabled AI, unknown providers, models, data classes, and credentials", async () => {
    const disabled = await setup({ enabled: false });
    await expect(disabled.runtime.prepare(input())).rejects.toMatchObject({
      code: "ai_disabled",
    });

    const missing = await setup({ provider: null });
    await expect(missing.runtime.prepare(input())).rejects.toMatchObject({
      code: "unknown_provider",
    });

    const env = await setup();
    await expect(
      env.runtime.prepare(input({ model: "other-model" }))
    ).rejects.toMatchObject({ code: "model_not_allowed" });
    await expect(
      env.runtime.prepare(input({ dataClasses: ["D3"] }))
    ).rejects.toMatchObject({ code: "invalid_data_class" });
    await expect(env.runtime.prepare(input({ credential: null }))).rejects.toMatchObject({
      code: "credential_missing",
    });
    await expect(
      env.runtime.prepare(
        input({ credential: { ...CREDENTIAL, providerId: "anthropic" } })
      )
    ).rejects.toMatchObject({ code: "credential_provider_mismatch" });
  });

  it("rejects payload substitution after review", async () => {
    const env = await setup();
    const prepared = await env.runtime.prepare(input());
    const wrongHash = {
      ...prepared,
      prepared: { ...prepared.prepared, payloadHash: "b".repeat(64) },
    };
    const wrongOrigin = {
      ...prepared,
      prepared: { ...prepared.prepared, origin: "https://evil.example" },
    };

    await expect(env.runtime.approveAndSend(wrongHash)).rejects.toMatchObject({
      code: "payload_changed",
    });
    await expect(env.runtime.approveAndSend(wrongOrigin)).rejects.toMatchObject({
      code: "payload_changed",
    });
  });

  it("fails a replay with consent_used", async () => {
    const env = await setup();
    const prepared = await env.runtime.prepare(input());

    await env.runtime.approveAndSend(prepared);

    await expect(env.runtime.approveAndSend(prepared)).rejects.toMatchObject({
      code: "consent_used",
    });
  });

  it("fails when the consent model or origin does not match", async () => {
    const modelEnv = await setup({
      tamperConsent: (consent) => ({ ...consent, model: "other-model" }),
    });
    const modelPrepared = await modelEnv.runtime.prepare(input());

    await expect(modelEnv.runtime.approveAndSend(modelPrepared)).rejects.toMatchObject({
      code: "consent_mismatch",
    });

    const originEnv = await setup({
      tamperConsent: (consent) => ({
        ...consent,
        endpointOrigin: "https://evil.example",
      }),
    });
    const originPrepared = await originEnv.runtime.prepare(input());

    await expect(originEnv.runtime.approveAndSend(originPrepared)).rejects.toMatchObject({
      code: "consent_mismatch",
    });
  });

  it("confirms credential use with a high-risk scope digest", async () => {
    const captured: CapabilityRequest[] = [];
    const env = await setup({ captureRequests: captured });
    const prepared = await env.runtime.prepare(input());

    await env.runtime.approveAndSend(prepared);

    const request = captured.find(
      (entry) => entry.capability === "credential.use:openai"
    );

    expect(request?.confirmation).toMatchObject({ itemCount: 1 });
    expect(request?.confirmation?.scopeDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("aborts the transport and audits ai.aborted", async () => {
    let started: () => void = () => undefined;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const transport = new FakeTransport(
      (request) =>
        new Promise<AiTransportResponse>((_resolve, reject) => {
          started();
          request.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        })
    );
    const env = await setup({ transport });
    const prepared = await env.runtime.prepare(input());
    const controller = new AbortController();
    const pending = env.runtime.approveAndSend(prepared, {
      signal: controller.signal,
    });

    await startedPromise;
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(transport.requests[0]?.signal.aborted).toBe(true);
    expect((await env.privacy.audit.list()).at(-1)?.event).toBe("ai.aborted");
  });

  it("aborts active requests when AI is disabled", async () => {
    let started: () => void = () => undefined;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const transport = new FakeTransport(
      (request) =>
        new Promise<AiTransportResponse>((_resolve, reject) => {
          started();
          request.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        })
    );
    const env = await setup({ transport });
    const prepared = await env.runtime.prepare(input());
    const pending = env.runtime.approveAndSend(prepared);

    await startedPromise;
    await env.runtime.setEnabled(false);

    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(transport.requests[0]?.signal.aborted).toBe(true);
    await expect(env.runtime.isEnabled()).resolves.toBe(false);
  });

  it("audits failed requests with a safe reason code", async () => {
    const transport = new FakeTransport(() => ({
      status: 500,
      headers: new Headers(),
      body: null,
      text: async () => "",
    }));
    const env = await setup({ transport });
    const prepared = await env.runtime.prepare(input());

    await expect(env.runtime.approveAndSend(prepared)).rejects.toMatchObject({
      code: "provider_error",
    });

    const last = (await env.privacy.audit.list()).at(-1);
    expect(last?.event).toBe("ai.failed");
    expect(last?.reason).toBe("provider_error");
  });

  it("keeps prompts and secrets out of consent and audit records", async () => {
    const env = await setup();
    const prepared = await env.runtime.prepare(input());
    await env.runtime.approveAndSend(prepared);

    const consents = JSON.stringify(await env.privacy.consents.list());
    const audit = JSON.stringify(await env.privacy.audit.list());

    expect(consents).not.toContain(SECRET);
    expect(consents).not.toContain(PROMPT);
    expect(audit).not.toContain(SECRET);
    expect(audit).not.toContain(PROMPT);
  });

  it("streams events and audits completion", async () => {
    const transport = new FakeTransport(() =>
      sseResponse([
        'data: {"model":"gpt-4.1-mini","choices":[{"delta":{"content":"Hi"}}]}\n\n',
        'data: {"model":"gpt-4.1-mini","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
        "data: [DONE]\n\n",
      ])
    );
    const env = await setup({ transport });
    const prepared = await env.runtime.prepare(input({ stream: true }));
    const events = [];

    for await (const event of env.runtime.approveAndStream(prepared)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "delta", text: "Hi" },
      {
        type: "done",
        model: "gpt-4.1-mini",
        finishReason: "stop",
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      },
    ]);
    expect((await env.privacy.audit.list()).at(-1)?.event).toBe("ai.completed");
  });
});
