import { endpointOrigin } from "./endpoint";
import { AiError } from "./errors";
import { hashPayload, joinEndpoint, validateAiRequest } from "./payload";
import type {
  AiCompletion,
  AiEmbedding,
  AiHealth,
  AiPreparedPayload,
  AiProviderAdapter,
  AiProviderConfig,
  AiRequest,
  AiSendInput,
  AiStreamEvent,
} from "./types";

export interface MockAiProviderAdapterOptions {
  readonly config: AiProviderConfig;
  readonly completion?: AiCompletion;
  readonly stream?: readonly AiStreamEvent[];
  readonly error?: AiError;
}

export function createMockAiProviderAdapter(
  options: MockAiProviderAdapterOptions
): AiProviderAdapter {
  const { config } = options;
  let aborted = false;

  async function prepare(request: AiRequest): Promise<AiPreparedPayload> {
    const validated = validateAiRequest(request, config);
    const body = JSON.stringify({
      model: validated.model,
      messages: validated.messages,
      stream: validated.stream,
    });
    const endpoint = joinEndpoint(config.endpoint, "/chat/completions");

    return {
      provider: config,
      request: validated,
      endpoint,
      origin: endpointOrigin(endpoint),
      body,
      payloadHash: await hashPayload(body),
      payloadBytes: new TextEncoder().encode(body).length,
    };
  }

  function assertReady(): void {
    if (options.error !== undefined) {
      throw options.error;
    }

    if (aborted) {
      throw new AiError("aborted", "The mock AI request was aborted.");
    }
  }

  return {
    config,
    prepare,
    async complete(input) {
      assertReady();

      return (
        options.completion ?? {
          text: "",
          model: input.prepared.request.model,
          finishReason: "stop",
          usage: null,
        }
      );
    },
    stream(input) {
      return streamEvents(input);
    },
    async embed(input): Promise<AiEmbedding> {
      assertReady();

      return {
        model: input.prepared.request.model,
        vectors: [[0.1, 0.2]],
        usage: null,
      };
    },
    async health(): Promise<AiHealth> {
      assertReady();

      return { ok: true, status: 200, models: [...config.models] };
    },
    abort() {
      aborted = true;
    },
  };

  async function* streamEvents(
    input: AiSendInput
  ): AsyncGenerator<AiStreamEvent, void, void> {
    assertReady();
    const events =
      options.stream === undefined
        ? [
            {
              type: "done" as const,
              model: input.prepared.request.model,
              finishReason: "stop",
              usage: null,
            },
          ]
        : options.stream;

    for (const event of events) {
      assertReady();
      yield event;
    }
  }
}
