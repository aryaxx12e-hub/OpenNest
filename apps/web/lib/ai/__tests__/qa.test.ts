import { describe, expect, it, vi } from "vitest";

import {
  AI_MAX_REQUEST_BYTES,
  AI_MAX_RESPONSE_BYTES,
  AiError,
  type AiCompletion,
  type AiPreparedPayload,
  type AiProviderConfig,
  type AiRequest,
} from "@opennest/ai";

import type { AiPreparedRequest, AiRequestInput } from "../runtime";
import { createQa, readBrowserQaConfig } from "../qa";
import type { Passage } from "../retrieval/types";

const NOW = Date.parse("2026-11-19T08:00:00.000Z");
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

const PASSAGES: Passage[] = [
  {
    id: "note:note-1:0-18:abc",
    kind: "note",
    sourceId: "note-1",
    sourceTitle: "Belanja",
    text: "Belanja sayur dan buah.",
    start: 0,
    end: 21,
  },
  {
    id: "file:file-1:0-18:def",
    kind: "file",
    sourceId: "file-1",
    sourceTitle: "Daftar.txt",
    text: "Beras dan telur.",
    start: 0,
    end: 16,
  },
];

function requestFor(input: AiRequestInput): AiRequest {
  return {
    model: input.model,
    messages: input.messages,
    stream: input.stream,
  };
}

function preparedFor(input: AiRequestInput, now: number): AiPreparedRequest {
  const request = requestFor(input);
  const body = JSON.stringify(request);
  const prepared: AiPreparedPayload = {
    provider: PROVIDER,
    request,
    endpoint: PROVIDER.endpoint,
    origin: new URL(PROVIDER.endpoint).origin,
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
    expiresAt: now + 5 * 60 * 1000,
  };
}

function setup(options: { answer?: string; now?: () => number } = {}) {
  const prep = vi.fn(async (input: AiRequestInput) =>
    preparedFor(input, options.now?.() ?? NOW)
  );
  const approve = vi.fn(
    async (
      _input: AiPreparedRequest,
      sendOptions?: { signal?: AbortSignal }
    ): Promise<AiCompletion> => {
      if (sendOptions?.signal?.aborted) {
        throw new AiError("aborted", "The request was aborted.");
      }

      return {
        text: options.answer ?? "Jawaban [[note:note-1:0-18:abc]]",
        model: "gpt-4.1-mini",
        finishReason: "stop",
        usage: null,
      };
    }
  );
  const ai = {
    isEnabled: vi.fn(async () => true),
    listProviders: vi.fn(async () => [PROVIDER]),
    prepare: prep,
    approveAndSend: approve,
  };
  const qa = createQa({
    ai,
    enabled: true,
    now: options.now ?? (() => NOW),
  });

  return { qa, ai, prep, approve };
}

function question(overrides: Record<string, unknown> = {}) {
  return {
    providerId: PROVIDER.id,
    model: PROVIDER.models[0]!,
    question: "Apa yang perlu dibeli?",
    passages: PASSAGES,
    credential: { kind: "session" as const, id: "credential-1", providerId: PROVIDER.id },
    ...overrides,
  };
}

describe("document Q&A", () => {
  it("prepares locally and sends only after explicit approval", async () => {
    const { qa, approve } = setup();
    const prepared = await qa.prepare(question());

    expect(approve).not.toHaveBeenCalled();

    await qa.send(prepared);

    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve.mock.calls[0]?.[0]).toBe(prepared.request);
  });

  it("binds the prompt to only the selected passages", async () => {
    const { qa, prep } = setup();
    const prepared = await qa.prepare(question());
    const messages =
      prep.mock.calls[0]?.[0].messages.map((message) => message.content) ?? [];

    expect(prepared.request.dataClasses).toEqual(["D2"]);
    expect(messages.join("\n")).toContain(PASSAGES[0]!.id);
    expect(messages.join("\n")).toContain(PASSAGES[1]!.id);
    expect(messages.join("\n")).toContain("Belanja sayur dan buah.");
    expect(messages.join("\n")).toContain("Beras dan telur.");
    expect(messages.join("\n")).not.toContain("passage that was not selected");
  });

  it("rejects an expired consent before calling the provider", async () => {
    let now = NOW;
    const { qa, approve } = setup({ now: () => now });
    const prepared = await qa.prepare(question());
    now += 5 * 60 * 1000 + 1;

    await expect(qa.send(prepared)).rejects.toMatchObject({ code: "consent_expired" });
    expect(approve).not.toHaveBeenCalled();
  });

  it("uses D2 and rejects D3", async () => {
    const { qa, prep } = setup();

    await expect(qa.prepare(question({ dataClasses: ["D3"] }))).rejects.toMatchObject({
      code: "invalid_data_class",
    });
    expect(prep).not.toHaveBeenCalled();
  });

  it("rejects a payload that changed after approval", async () => {
    const { qa, approve } = setup();
    const prepared = await qa.prepare(question());
    const changed = {
      ...prepared,
      request: {
        ...prepared.request,
        prepared: { ...prepared.request.prepared, payloadHash: "b".repeat(64) },
      },
    };

    await expect(qa.send(changed)).rejects.toMatchObject({
      code: "payload_changed",
    });
    expect(approve).not.toHaveBeenCalled();
  });

  it("rejects an oversized request before preparing", async () => {
    const { qa, prep } = setup();
    const huge = "x".repeat(AI_MAX_REQUEST_BYTES + 1);

    await expect(
      qa.prepare(question({ passages: [{ ...PASSAGES[0]!, text: huge }] }))
    ).rejects.toMatchObject({ code: "request_too_large" });
    expect(prep).not.toHaveBeenCalled();
  });

  it("rejects an oversized response", async () => {
    const { qa } = setup({ answer: "x".repeat(AI_MAX_RESPONSE_BYTES + 1) });
    const prepared = await qa.prepare(question());

    await expect(qa.send(prepared)).rejects.toMatchObject({
      code: "response_too_large",
    });
  });

  it("forwards cancellation to the provider", async () => {
    const { qa, approve } = setup();
    const prepared = await qa.prepare(question());
    const controller = new AbortController();
    controller.abort();

    await expect(qa.send(prepared, { signal: controller.signal })).rejects.toMatchObject({
      code: "aborted",
    });
    expect(approve.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it("marks an uncited answer unsupported", async () => {
    const { qa } = setup({ answer: "Jawaban tanpa sumber." });
    const prepared = await qa.prepare(question());
    const answer = await qa.send(prepared);

    expect(answer.unsupported).toBe(true);
    expect(answer.citations).toEqual([]);
  });

  it("returns citations linked to selected note and file passages", async () => {
    const { qa } = setup({
      answer: `Sayur lebih murah [[${PASSAGES[0]!.id}]] dan telur [[${PASSAGES[1]!.id}]].`,
    });
    const prepared = await qa.prepare(question());
    const answer = await qa.send(prepared);

    expect(answer.unsupported).toBe(false);
    expect(answer.citations.map((citation) => citation.kind)).toEqual(["note", "file"]);
    expect(answer.citations.map((citation) => citation.sourceId)).toEqual([
      "note-1",
      "file-1",
    ]);
    expect(answer.text).not.toContain("[[");
  });

  it("stays off when the feature flag is off, AI is off, or no provider exists", async () => {
    const disabled = setup();
    const qaDisabled = createQa({ ai: disabled.ai, enabled: false, now: () => NOW });

    await expect(qaDisabled.prepare(question())).rejects.toMatchObject({
      code: "disabled",
    });

    const aiOff = setup();
    aiOff.ai.isEnabled.mockResolvedValue(false);
    const qaOff = createQa({ ai: aiOff.ai, enabled: true, now: () => NOW });

    await expect(qaOff.prepare(question())).rejects.toMatchObject({
      code: "disabled",
    });

    const noProvider = setup();
    noProvider.ai.listProviders.mockResolvedValue([]);
    const qaNoProvider = createQa({
      ai: noProvider.ai,
      enabled: true,
      now: () => NOW,
    });

    await expect(qaNoProvider.prepare(question())).rejects.toMatchObject({
      code: "no_provider",
    });
  });

  it("reads the feature flag", () => {
    expect(readBrowserQaConfig("true")).toEqual({ enabled: true });
    expect(readBrowserQaConfig("false")).toEqual({ enabled: false });
    expect(readBrowserQaConfig(undefined)).toEqual({ enabled: false });
  });
});
