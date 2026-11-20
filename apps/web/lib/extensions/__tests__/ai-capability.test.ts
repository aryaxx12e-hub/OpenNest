import { describe, expect, it, vi } from "vitest";

import {
  AiError,
  type AiCompletion,
  type AiPreparedPayload,
  type AiProviderConfig,
} from "@opennest/ai";
import { createMemoryPrivacyStore } from "@opennest/privacy";
import { createAuditLog } from "@opennest/privacy";

import type { AiPreparedRequest, AiRequestInput } from "../../ai/runtime";
import {
  createExtensionAiCapability,
  EXTENSION_AI_MAX_PROMPT_BYTES,
  EXTENSION_AI_MAX_RESPONSE_BYTES,
} from "../ai-capability";
import { createExtensionHostApi } from "../host-api";
import { workerToHostSchema } from "../protocol";

const NOW = Date.parse("2026-11-19T08:00:00.000Z");
const WORKSPACE_ID = "workspace-1";
const EXTENSION = { id: "com.example.ai", name: "AI helper" };
const PROVIDER: AiProviderConfig = {
  id: "openai",
  label: "OpenAI",
  kind: "remote",
  adapter: "openai-compatible",
  endpoint: "https://api.openai.com/v1",
  models: ["gpt-4.1-mini"],
  capabilities: ["chat"],
  auth: "bearer",
  dataPolicyUrl: null,
  maxContextTokens: 128_000,
  maxOutputTokens: 4_096,
  createdAt: 1,
  updatedAt: 1,
};

function requestFor(input: AiRequestInput): AiPreparedRequest {
  const body = JSON.stringify(input.messages);
  const prepared: AiPreparedPayload = {
    provider: PROVIDER,
    request: {
      model: input.model,
      messages: input.messages,
      stream: false,
    },
    endpoint: PROVIDER.endpoint,
    origin: "https://api.openai.com",
    body,
    payloadHash: "a".repeat(64),
    payloadBytes: new TextEncoder().encode(body).byteLength,
  };

  return {
    prepared,
    provider: PROVIDER,
    dataClasses: input.dataClasses,
    purpose: input.purpose,
    credential: input.credential,
    expiresAt: NOW + 5 * 60 * 1000,
  };
}

function setup(options: { enabled?: boolean; answer?: string } = {}) {
  const prepare = vi.fn(async (input: AiRequestInput) => requestFor(input));
  const approve = vi.fn(async (): Promise<AiCompletion> => ({
    text: options.answer ?? "Ringkasan.",
    model: "gpt-4.1-mini",
    finishReason: "stop",
    usage: null,
  }));
  const ai = {
    isEnabled: vi.fn(async () => options.enabled ?? true),
    listProviders: vi.fn(async () => [PROVIDER]),
    prepare,
    approveAndSend: approve,
  };
  const audit = createAuditLog({
    store: createMemoryPrivacyStore().audit,
    now: () => NOW,
    generateId: (() => {
      let id = 0;
      return () => `audit-${++id}`;
    })(),
  });
  const consent = vi.fn(async () => true);
  const capability = createExtensionAiCapability({
    ai,
    audit,
    workspaceId: WORKSPACE_ID,
    requestConsent: consent,
    selectProvider: () => ({
      providerId: PROVIDER.id,
      model: "gpt-4.1-mini",
      credential: null,
    }),
    now: () => NOW,
  });

  return { ai, audit, consent, capability, prepare, approve };
}

describe("extension AI capability", () => {
  it("returns only text metadata and never provider or credential handles", async () => {
    const { capability, prepare } = setup();
    const result = await capability.generate(EXTENSION, {
      prompt: "Summarize the selected notes.",
      maxTokens: 256,
      temperature: 0.2,
    });

    expect(result).toEqual({
      text: "Ringkasan.",
      model: "gpt-4.1-mini",
      finishReason: "stop",
    });
    expect(JSON.stringify(result)).not.toContain("openai");
    expect(JSON.stringify(result)).not.toContain("credential");
    expect(JSON.stringify(result)).not.toContain("api.openai.com");
    expect(prepare.mock.calls[0]?.[0]).toMatchObject({
      providerId: PROVIDER.id,
      model: "gpt-4.1-mini",
      dataClasses: ["D2"],
      credential: null,
      stream: false,
    });
    expect(prepare.mock.calls[0]?.[0].messages).toEqual([
      { role: "user", content: "Summarize the selected notes." },
    ]);
  });

  it("requires a fresh host consent for every call", async () => {
    const { capability, consent, approve } = setup();
    consent.mockResolvedValueOnce(false);

    await expect(
      capability.generate(EXTENSION, { prompt: "First question" })
    ).rejects.toMatchObject({ code: "consent_required" });
    expect(approve).not.toHaveBeenCalled();
    expect(consent).toHaveBeenCalledTimes(1);

    await capability.generate(EXTENSION, { prompt: "Second question" });

    expect(consent).toHaveBeenCalledTimes(2);
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown methods and extra parameters", async () => {
    const { capability, prepare } = setup();

    await expect(
      capability.generate(EXTENSION, { prompt: "Hello", method: "ai.secrets" })
    ).rejects.toMatchObject({ code: "invalid_params" });
    expect(prepare).not.toHaveBeenCalled();
    expect(
      workerToHostSchema.safeParse({
        type: "worker:request",
        id: "1",
        method: "ai.credentials",
        params: {},
      }).success
    ).toBe(false);
  });

  it("enforces prompt and response byte limits", async () => {
    const request = setup();
    await expect(
      request.capability.generate(EXTENSION, {
        prompt: "x".repeat(EXTENSION_AI_MAX_PROMPT_BYTES + 1),
      })
    ).rejects.toMatchObject({ code: "invalid_params" });
    expect(request.prepare).not.toHaveBeenCalled();

    const response = setup({
      answer: "y".repeat(EXTENSION_AI_MAX_RESPONSE_BYTES + 1),
    });
    await expect(
      response.capability.generate(EXTENSION, { prompt: "Hello" })
    ).rejects.toMatchObject({ code: "response_too_large" });
  });

  it("records only metadata in the audit log", async () => {
    const prompt = "Private prompt that must not enter the audit log.";
    const answer = "Private answer that must not enter the audit log.";
    const { capability, audit } = setup({ answer });

    await capability.generate(EXTENSION, { prompt });

    const entries = await audit.list();
    const serialized = JSON.stringify(entries);

    expect(entries.map((entry) => entry.event)).toContain("ai.requested");
    expect(entries.map((entry) => entry.event)).toContain("ai.completed");
    expect(entries.map((entry) => entry.capability)).toContain("ai.generate");
    expect(serialized).not.toContain(prompt);
    expect(serialized).not.toContain(answer);
    expect(serialized).not.toContain("credential");
  });

  it("stays off by default and hides provider failures", async () => {
    const off = setup({ enabled: false });
    await expect(
      off.capability.generate(EXTENSION, { prompt: "Hello" })
    ).rejects.toMatchObject({ code: "ai_unavailable" });
    expect(off.consent).not.toHaveBeenCalled();
    expect(off.prepare).not.toHaveBeenCalled();

    const failed = setup();
    failed.prepare.mockRejectedValue(
      new AiError("authentication_failed", "sk-provider-secret was rejected")
    );
    await expect(
      failed.capability.generate(EXTENSION, { prompt: "Hello" })
    ).rejects.toMatchObject({
      code: "ai_failed",
      message: expect.not.stringContaining("sk-provider-secret"),
    });

    const unavailable = setup();
    unavailable.ai.isEnabled.mockRejectedValue(
      new AiError("ai_disabled", "sk-provider-secret is disabled")
    );
    await expect(
      unavailable.capability.generate(EXTENSION, { prompt: "Hello" })
    ).rejects.toMatchObject({
      code: "ai_unavailable",
      message: expect.not.stringContaining("sk-provider-secret"),
    });
  });

  it("rejects ai.generate when the host capability is off or not declared", async () => {
    const { capability } = setup();
    const base = {
      extensionId: EXTENSION.id,
      extensionName: EXTENSION.name,
      workspace: { id: WORKSPACE_ID } as never,
      services: {} as never,
      broker: {} as never,
      storage: {
        get: async () => null,
        set: async () => undefined,
        delete: async () => undefined,
        keys: async () => [],
        clear: async () => undefined,
        usage: async () => 0,
      },
      now: () => NOW,
    };

    const off = createExtensionHostApi({
      ...base,
      ai: null,
      capabilities: ["ai.generate"],
    });
    await expect(
      off.handle({ id: "1", method: "ai.generate", params: { prompt: "Hello" } })
    ).rejects.toMatchObject({ code: "ai_unavailable" });

    const undeclared = createExtensionHostApi({
      ...base,
      ai: capability,
      capabilities: ["workspace.read.metadata"],
    });
    await expect(
      undeclared.handle({
        id: "2",
        method: "ai.generate",
        params: { prompt: "Hello" },
      })
    ).rejects.toMatchObject({ code: "unknown_method" });
  });
});
