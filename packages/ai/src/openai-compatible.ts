import { endpointOrigin } from "./endpoint";
import { AiError } from "./errors";
import { hashPayload, joinEndpoint, validateAiRequest } from "./payload";
import {
  AI_MAX_REQUEST_BYTES,
  AI_MAX_RESPONSE_BYTES,
  AI_STREAM_TIMEOUT_MS,
  AI_TIMEOUT_MS,
} from "./transport";
import type {
  AiCompletion,
  AiEmbedding,
  AiPreparedPayload,
  AiProviderAdapter,
  AiProviderConfig,
  AiRequest,
  AiSendInput,
  AiStreamEvent,
  AiTransportRequest,
  AiTransportResponse,
  AiUsage,
} from "./types";

type TransportSpec = Omit<AiTransportRequest, "signal">;

export function createOpenAiCompatibleAdapter(
  config: AiProviderConfig
): AiProviderAdapter {
  let activeController: AbortController | null = null;

  async function prepare(request: AiRequest): Promise<AiPreparedPayload> {
    assertCapability(config, "chat");

    const validated = validateAiRequest(request, config);
    const body = JSON.stringify({
      model: validated.model,
      messages: validated.messages,
      stream: validated.stream,
      ...(validated.temperature === undefined
        ? {}
        : { temperature: validated.temperature }),
      ...(validated.maxTokens === undefined ? {} : { max_tokens: validated.maxTokens }),
    });
    const payloadBytes = byteLength(body);

    if (payloadBytes > AI_MAX_REQUEST_BYTES) {
      throw new AiError(
        "request_too_large",
        "The AI request exceeds the request size limit."
      );
    }

    const endpoint = joinEndpoint(config.endpoint, "/chat/completions");

    return {
      provider: config,
      request: validated,
      endpoint,
      origin: endpointOrigin(endpoint),
      body,
      payloadHash: await hashPayload(body),
      payloadBytes,
    };
  }

  async function withRequest<T>(
    input: AiSendInput,
    spec: TransportSpec,
    operation: (response: AiTransportResponse) => Promise<T>
  ): Promise<T> {
    const { controller, cleanup } = requestController(input.signal);
    activeController = controller;

    try {
      if (controller.signal.aborted) {
        throw new AiError("aborted", "The AI request was aborted.");
      }

      const response = await input.transport.send({
        ...spec,
        signal: controller.signal,
      });

      return await operation(response);
    } catch (error) {
      throw mapError(error, controller);
    } finally {
      cleanup();

      if (activeController === controller) {
        activeController = null;
      }
    }
  }

  return {
    config,
    prepare,
    async complete(input) {
      assertPrepared(input, config, false);
      assertCapability(config, "chat");

      return withRequest(
        input,
        requestSpec(input, input.prepared.endpoint, input.prepared.origin, "POST", {
          body: input.prepared.body,
        }),
        async (response) => {
          assertOk(response);
          return parseCompletion(await response.text(), input.prepared);
        }
      );
    },
    stream(input) {
      return streamRequest(input);
    },
    async embed(input) {
      assertCapability(config, "embedding");
      const text = input.prepared.request.messages
        .map((message) => message.content)
        .join("\n");
      const body = JSON.stringify({
        model: input.prepared.request.model,
        input: text,
      });
      const payloadBytes = byteLength(body);

      if (payloadBytes > AI_MAX_REQUEST_BYTES) {
        throw new AiError(
          "request_too_large",
          "The embedding request exceeds the request size limit."
        );
      }

      const endpoint = joinEndpoint(config.endpoint, "/embeddings");

      return withRequest(
        input,
        requestSpec(input, endpoint, endpointOrigin(endpoint), "POST", { body }),
        async (response) => {
          assertOk(response);
          return parseEmbedding(await response.text(), input.prepared);
        }
      );
    },
    async health(input) {
      const endpoint = joinEndpoint(config.endpoint, "/models");

      return withRequest(
        input,
        requestSpec(input, endpoint, endpointOrigin(endpoint), "GET", {
          body: null,
        }),
        async (response) => {
          const ok = response.status >= 200 && response.status < 300;
          const models = ok ? parseModels(await response.text()) : [];

          return { ok, status: response.status, models };
        }
      );
    },
    abort() {
      activeController?.abort();
      activeController = null;
    },
  };

  async function* streamRequest(
    input: AiSendInput
  ): AsyncGenerator<AiStreamEvent, void, void> {
    assertPrepared(input, config, true);
    assertCapability(config, "chat");

    const { controller, cleanup } = requestController(input.signal);
    activeController = controller;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    try {
      if (controller.signal.aborted) {
        throw new AiError("aborted", "The AI request was aborted.");
      }

      const response = await input.transport.send({
        ...requestSpec(
          input,
          input.prepared.endpoint,
          input.prepared.origin,
          "POST",
          { body: input.prepared.body },
          AI_STREAM_TIMEOUT_MS
        ),
        signal: controller.signal,
      });

      assertOk(response);

      if (response.body === null) {
        throw malformedResponse();
      }

      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let model = input.prepared.request.model;
      let finishReason: string | null = null;
      let usage: AiUsage | null = null;
      let done = false;

      while (!done) {
        const chunk = await reader.read();

        if (chunk.done) {
          break;
        }

        buffer += decoder.decode(chunk.value, { stream: true });
        buffer = buffer.replace(/\r\n/g, "\n");

        let boundary = buffer.indexOf("\n\n");

        while (boundary >= 0) {
          const rawEvent = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = sseData(rawEvent);

          if (data === "[DONE]") {
            done = true;
            break;
          }

          if (data !== null) {
            const parsed = parseStreamChunk(data);

            if (parsed.model !== null) {
              model = parsed.model;
            }

            if (parsed.finishReason !== undefined) {
              finishReason = parsed.finishReason;
            }

            if (parsed.usage !== null) {
              usage = parsed.usage;
            }

            if (parsed.delta !== null) {
              yield { type: "delta", text: parsed.delta };
            }
          }

          boundary = buffer.indexOf("\n\n");
        }
      }

      if (!done) {
        const data = sseData(buffer);

        if (data !== null && data !== "[DONE]") {
          const parsed = parseStreamChunk(data);

          if (parsed.model !== null) {
            model = parsed.model;
          }

          if (parsed.finishReason !== undefined) {
            finishReason = parsed.finishReason;
          }

          if (parsed.usage !== null) {
            usage = parsed.usage;
          }

          if (parsed.delta !== null) {
            yield { type: "delta", text: parsed.delta };
          }
        }
      }

      yield { type: "done", model, finishReason, usage };
    } catch (error) {
      throw mapError(error, controller);
    } finally {
      cleanup();

      if (activeController === controller) {
        activeController = null;
      }

      if (reader !== null) {
        try {
          await reader.cancel();
        } catch {
          // The stream may already be closed.
        }
      }
    }
  }
}

function requestSpec(
  input: AiSendInput,
  url: string,
  origin: string,
  method: "GET" | "POST",
  body: { body: string | null },
  timeoutMs: number = AI_TIMEOUT_MS
): TransportSpec {
  return {
    url,
    providerId: input.prepared.provider.id,
    allowedOrigin: origin,
    auth: input.prepared.provider.auth,
    method,
    headers:
      method === "POST"
        ? { "content-type": "application/json", accept: "application/json" }
        : { accept: "application/json" },
    body: body.body,
    credential: input.credential,
    timeoutMs,
    maxResponseBytes: AI_MAX_RESPONSE_BYTES,
  };
}

function requestController(signal: AbortSignal): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);

  if (signal.aborted) {
    controller.abort(signal.reason);
  } else {
    signal.addEventListener("abort", onAbort, { once: true });
  }

  return {
    controller,
    cleanup: () => signal.removeEventListener("abort", onAbort),
  };
}

function assertPrepared(
  input: AiSendInput,
  config: AiProviderConfig,
  expectedStream: boolean
): void {
  if (
    input.prepared.provider.id !== config.id ||
    input.prepared.request.stream !== expectedStream
  ) {
    throw new AiError(
      "invalid_request",
      "The prepared AI request does not match this adapter."
    );
  }
}

function assertCapability(
  config: AiProviderConfig,
  capability: "chat" | "embedding"
): void {
  if (!config.capabilities.includes(capability)) {
    throw new AiError(
      "unsupported_capability",
      "This provider does not support the requested capability."
    );
  }
}

function assertOk(response: AiTransportResponse): void {
  if (response.status === 401) {
    throw new AiError(
      "authentication_failed",
      "The AI provider rejected the credential."
    );
  }

  if (response.status === 403) {
    throw new AiError("permission_denied", "The AI provider denied the request.");
  }

  if (response.status === 429) {
    throw new AiError("rate_limited", "The AI provider rate limit was reached.");
  }

  if (response.status < 200 || response.status >= 300) {
    throw new AiError("provider_error", "The AI provider returned an error.");
  }
}

function parseCompletion(text: string, prepared: AiPreparedPayload): AiCompletion {
  const record = parseJsonRecord(text);
  const choices = record.choices;

  if (!Array.isArray(choices) || choices.length === 0) {
    throw malformedResponse();
  }

  const choice = asRecord(choices[0]);
  const message = isRecord(choice.message) ? choice.message : null;
  const content =
    typeof message?.content === "string"
      ? message.content
      : typeof choice.text === "string"
        ? choice.text
        : null;

  if (content === null) {
    throw malformedResponse();
  }

  return {
    text: content,
    model: typeof record.model === "string" ? record.model : prepared.request.model,
    finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : null,
    usage: parseUsage(record.usage),
  };
}

function parseEmbedding(text: string, prepared: AiPreparedPayload): AiEmbedding {
  const record = parseJsonRecord(text);
  const data = record.data;

  if (!Array.isArray(data) || data.length === 0) {
    throw malformedResponse();
  }

  const vectors = data.map((item) => {
    const embedding = asRecord(item).embedding;

    if (
      !Array.isArray(embedding) ||
      embedding.length === 0 ||
      embedding.some((value) => typeof value !== "number" || !Number.isFinite(value))
    ) {
      throw malformedResponse();
    }

    return [...embedding];
  });

  return {
    model: typeof record.model === "string" ? record.model : prepared.request.model,
    vectors,
    usage: parseUsage(record.usage),
  };
}

function parseModels(text: string): string[] {
  try {
    const record = parseJsonRecord(text);
    const data = record.data;

    if (!Array.isArray(data)) {
      return [];
    }

    return data.flatMap((item) => {
      if (!isRecord(item) || typeof item.id !== "string") {
        return [];
      }

      return [item.id];
    });
  } catch {
    return [];
  }
}

function parseStreamChunk(data: string): {
  delta: string | null;
  model: string | null;
  finishReason: string | null | undefined;
  usage: AiUsage | null;
} {
  const record = parseJsonRecord(data);
  const choices = record.choices;
  let delta: string | null = null;
  let finishReason: string | null | undefined;

  if (Array.isArray(choices) && choices.length > 0) {
    const choice = asRecord(choices[0]);
    const choiceDelta = isRecord(choice.delta) ? choice.delta : null;

    if (typeof choiceDelta?.content === "string" && choiceDelta.content.length > 0) {
      delta = choiceDelta.content;
    }

    if (choice.finish_reason === null || typeof choice.finish_reason === "string") {
      finishReason = choice.finish_reason;
    }
  }

  return {
    delta,
    model: typeof record.model === "string" ? record.model : null,
    finishReason,
    usage: parseUsage(record.usage),
  };
}

function parseUsage(value: unknown): AiUsage | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    promptTokens: tokenValue(value.prompt_tokens),
    completionTokens: tokenValue(value.completion_tokens),
    totalTokens: tokenValue(value.total_tokens),
  };
}

function tokenValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function sseData(rawEvent: string): string | null {
  const data = rawEvent
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();

  return data.length === 0 ? null : data;
}

function parseJsonRecord(text: string): Record<string, unknown> {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    throw malformedResponse();
  }

  if (!isRecord(value)) {
    throw malformedResponse();
  }

  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw malformedResponse();
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function malformedResponse(): AiError {
  return new AiError("malformed_response", "The AI provider response is not valid.");
}

function mapError(error: unknown, controller: AbortController): AiError {
  if (error instanceof AiError) {
    return error;
  }

  if (controller.signal.aborted) {
    return new AiError("aborted", "The AI request was aborted.", { cause: error });
  }

  return new AiError("network_error", "The AI request failed.", { cause: error });
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
