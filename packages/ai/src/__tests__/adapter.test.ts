import { describe, expect, it } from "vitest";

import { AiError } from "../errors";
import { createMockAiProviderAdapter } from "../mock";
import { createOpenAiCompatibleAdapter } from "../openai-compatible";
import type {
  AiCompletion,
  AiCredentialHandle,
  AiProviderConfig,
  AiRequest,
  AiStreamEvent,
  AiTransport,
  AiTransportRequest,
  AiTransportResponse,
} from "../types";

const PROVIDER: AiProviderConfig = {
  id: "openai",
  label: "OpenAI",
  kind: "remote",
  adapter: "openai-compatible",
  endpoint: "https://api.openai.com/v1",
  models: ["gpt-4.1-mini", "embed-model"],
  capabilities: ["chat", "embedding"],
  auth: "bearer",
  dataPolicyUrl: "https://openai.com/policies/privacy-policy",
  maxContextTokens: 128_000,
  maxOutputTokens: 4_096,
  createdAt: 1,
  updatedAt: 1,
};

const CREDENTIAL: AiCredentialHandle = {
  kind: "session",
  id: "credential-1",
  providerId: "openai",
};

const COMPLETION: AiCompletion = {
  text: "Hello",
  model: "gpt-4.1-mini",
  finishReason: "stop",
  usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4 },
};

function request(overrides: Partial<AiRequest> = {}): AiRequest {
  return {
    model: "gpt-4.1-mini",
    messages: [{ role: "user", content: "Hi" }],
    stream: false,
    ...overrides,
  };
}

class FakeTransport implements AiTransport {
  readonly requests: AiTransportRequest[] = [];

  constructor(
    private readonly handler: (
      request: AiTransportRequest
    ) => AiTransportResponse | Promise<AiTransportResponse>
  ) {}

  async send(request: AiTransportRequest): Promise<AiTransportResponse> {
    this.requests.push(request);
    return this.handler(request);
  }
}

function jsonResponse(body: unknown, status = 200): AiTransportResponse {
  return {
    status,
    headers: new Headers(),
    body: null,
    text: async () => JSON.stringify(body),
  };
}

function textResponse(body: string, status = 200): AiTransportResponse {
  return {
    status,
    headers: new Headers(),
    body: null,
    text: async () => body,
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

describe("OpenAI-compatible adapter", () => {
  it("prepares and completes a request with the exact body", async () => {
    const adapter = createOpenAiCompatibleAdapter(PROVIDER);
    const prepared = await adapter.prepare(request());
    const transport = new FakeTransport(() =>
      jsonResponse({
        model: "gpt-4.1-mini",
        choices: [{ message: { content: "Hello" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      })
    );

    const completion = await adapter.complete({
      prepared,
      transport,
      credential: CREDENTIAL,
      signal: new AbortController().signal,
    });

    expect(completion).toEqual(COMPLETION);
    expect(transport.requests[0]).toMatchObject({
      url: "https://api.openai.com/v1/chat/completions",
      providerId: "openai",
      allowedOrigin: "https://api.openai.com",
      auth: "bearer",
      method: "POST",
      body: prepared.body,
      credential: CREDENTIAL,
    });
    expect(JSON.parse(prepared.body)).toMatchObject({
      model: "gpt-4.1-mini",
      stream: false,
    });
  });

  it("streams text deltas and a final event from SSE", async () => {
    const adapter = createOpenAiCompatibleAdapter(PROVIDER);
    const prepared = await adapter.prepare(request({ stream: true }));
    const transport = new FakeTransport(() =>
      sseResponse([
        'data: {"model":"gpt-4.1-mini","choices":[{"delta":{"content":"Hel"},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
        "data: [DONE]\n\n",
      ])
    );

    const events: AiStreamEvent[] = [];

    for await (const event of adapter.stream({
      prepared,
      transport,
      credential: CREDENTIAL,
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "delta", text: "Hel" },
      { type: "delta", text: "lo" },
      {
        type: "done",
        model: "gpt-4.1-mini",
        finishReason: "stop",
        usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
      },
    ]);
    expect(transport.requests[0]?.body).toBe(prepared.body);
  });

  it("aborts the active request", async () => {
    const adapter = createOpenAiCompatibleAdapter(PROVIDER);
    const prepared = await adapter.prepare(request());
    let receivedSignal: AbortSignal | null = null;
    const transport = new FakeTransport(
      (transportRequest) =>
        new Promise((_, reject) => {
          receivedSignal = transportRequest.signal;
          transportRequest.signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        })
    );

    const pending = adapter.complete({
      prepared,
      transport,
      credential: CREDENTIAL,
      signal: new AbortController().signal,
    });

    expect(receivedSignal).not.toBeNull();
    adapter.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
  });

  it("maps malformed responses and HTTP failures to safe errors", async () => {
    const adapter = createOpenAiCompatibleAdapter(PROVIDER);
    const prepared = await adapter.prepare(request());

    await expect(
      adapter.complete({
        prepared,
        transport: new FakeTransport(() => textResponse("not-json")),
        credential: CREDENTIAL,
        signal: new AbortController().signal,
      })
    ).rejects.toMatchObject({ code: "malformed_response" });

    for (const [status, code] of [
      [401, "authentication_failed"],
      [403, "permission_denied"],
      [429, "rate_limited"],
      [500, "provider_error"],
    ] as const) {
      const error = await adapter
        .complete({
          prepared,
          transport: new FakeTransport(() =>
            textResponse("sensitive provider body", status)
          ),
          credential: CREDENTIAL,
          signal: new AbortController().signal,
        })
        .catch((caught: unknown) => caught);

      expect(error).toMatchObject({ code });
      expect((error as Error).message).not.toContain("sensitive provider body");
    }
  });

  it("embeds inputs and validates finite vectors", async () => {
    const adapter = createOpenAiCompatibleAdapter(PROVIDER);
    const prepared = await adapter.prepare(request());
    const transport = new FakeTransport(() =>
      jsonResponse({
        model: "embed-model",
        data: [{ embedding: [0.1, -0.2, 0.3] }],
        usage: { prompt_tokens: 2, total_tokens: 2 },
      })
    );

    const embedding = await adapter.embed({
      prepared,
      transport,
      credential: CREDENTIAL,
      signal: new AbortController().signal,
    });

    expect(embedding).toEqual({
      model: "embed-model",
      vectors: [[0.1, -0.2, 0.3]],
      usage: { promptTokens: 2, completionTokens: null, totalTokens: 2 },
    });
    expect(transport.requests[0]?.url).toBe("https://api.openai.com/v1/embeddings");

    const broken = await adapter
      .embed({
        prepared,
        transport: new FakeTransport(() =>
          jsonResponse({ data: [{ embedding: [0.1, Number.POSITIVE_INFINITY] }] })
        ),
        credential: CREDENTIAL,
        signal: new AbortController().signal,
      })
      .catch((caught: unknown) => caught);

    expect(broken).toMatchObject({ code: "malformed_response" });
  });

  it("checks health through the transport without throwing on HTTP failure", async () => {
    const adapter = createOpenAiCompatibleAdapter(PROVIDER);
    const prepared = await adapter.prepare(request());
    const healthy = await adapter.health({
      prepared,
      transport: new FakeTransport(() =>
        jsonResponse({ data: [{ id: "gpt-4.1-mini" }, { id: "embed-model" }] })
      ),
      credential: CREDENTIAL,
      signal: new AbortController().signal,
    });

    expect(healthy).toEqual({
      ok: true,
      status: 200,
      models: ["gpt-4.1-mini", "embed-model"],
    });

    const unhealthy = await adapter.health({
      prepared,
      transport: new FakeTransport(() => jsonResponse({ error: "down" }, 503)),
      credential: CREDENTIAL,
      signal: new AbortController().signal,
    });

    expect(unhealthy).toEqual({ ok: false, status: 503, models: [] });
  });
});

describe("mock AI adapter", () => {
  it("supports scripted complete, stream, error, and abort cases", async () => {
    const done: AiStreamEvent = {
      type: "done",
      model: "gpt-4.1-mini",
      finishReason: "stop",
      usage: null,
    };
    const mock = createMockAiProviderAdapter({
      config: PROVIDER,
      completion: COMPLETION,
      stream: [{ type: "delta", text: "Hi" }, done],
    });
    const prepared = await mock.prepare(request());
    const input = {
      prepared,
      transport: new FakeTransport(() => jsonResponse({})),
      credential: CREDENTIAL,
      signal: new AbortController().signal,
    };

    await expect(mock.complete(input)).resolves.toEqual(COMPLETION);

    const events: AiStreamEvent[] = [];

    for await (const event of mock.stream(input)) {
      events.push(event);
    }

    expect(events).toEqual([{ type: "delta", text: "Hi" }, done]);

    mock.abort();
    await expect(mock.complete(input)).rejects.toMatchObject({ code: "aborted" });

    const broken = createMockAiProviderAdapter({
      config: PROVIDER,
      error: new AiError("provider_error", "Provider down."),
    });
    await expect(broken.complete(input)).rejects.toMatchObject({
      code: "provider_error",
    });
  });
});
