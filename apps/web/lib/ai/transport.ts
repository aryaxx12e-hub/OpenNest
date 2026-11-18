import {
  AI_MAX_REQUEST_BYTES,
  AiError,
  AI_MAX_RESPONSE_BYTES,
  isLoopbackEndpoint,
  type AiCredentialHandle,
  type AiTransport,
  type AiTransportRequest,
  type AiTransportResponse,
} from "@opennest/ai";

import { aiTransportError } from "./errors";

export interface BrowserAiTransportOptions {
  readonly resolveCredential: (handle: AiCredentialHandle) => Promise<string>;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

const ALLOWED_REQUEST_HEADERS = new Set(["accept", "content-type"]);

export function createBrowserAiTransport(
  options: BrowserAiTransportOptions
): AiTransport {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  return {
    async send(request) {
      validateTransportUrl(request.url, request.allowedOrigin);
      validateBodySize(request);

      const headers = await resolveHeaders(request, options.resolveCredential);
      const maxResponseBytes = responseByteLimit(request.maxResponseBytes);
      const { controller, finish, timedOut } = createRequestControl(request);

      try {
        const response = await fetchImpl(request.url, {
          method: request.method,
          headers,
          body: request.body,
          signal: controller.signal,
          credentials: "omit",
          referrerPolicy: "no-referrer",
          redirect: "error",
          cache: "no-store",
          mode: "cors",
        });

        if (response.redirected || (response.status >= 300 && response.status < 400)) {
          throw aiTransportError(
            "redirect_blocked",
            "The AI endpoint attempted to redirect the request."
          );
        }

        const responseHeaders = response.headers ?? new Headers();

        if (response.body === null) {
          finish();

          return {
            status: response.status,
            headers: responseHeaders,
            body: null,
            text: () => response.text(),
          };
        }

        const reader = response.body.getReader();
        let consumed = false;
        let body: ReadableStream<Uint8Array> | null = null;

        const result: {
          status: number;
          headers: Headers;
          text: () => Promise<string>;
        } = {
          status: response.status,
          headers: responseHeaders,
          async text() {
            if (consumed) {
              throw aiTransportError(
                "invalid_request",
                "The AI response body was already consumed."
              );
            }

            consumed = true;

            try {
              return await readText(reader, maxResponseBytes, controller, timedOut);
            } finally {
              finish();
            }
          },
        };

        Object.defineProperty(result, "body", {
          enumerable: true,
          get() {
            if (body === null) {
              body = limitedBody(
                reader,
                maxResponseBytes,
                controller,
                () => timedOut(),
                () => {
                  if (consumed) {
                    throw aiTransportError(
                      "invalid_request",
                      "The AI response body was already consumed."
                    );
                  }

                  consumed = true;
                },
                finish
              );
            }

            return body;
          },
        });

        return result as AiTransportResponse;
      } catch (error) {
        const mapped = mapFetchError(error, controller, timedOut);
        finish();
        throw mapped;
      }
    },
  };
}

function validateTransportUrl(url: string, allowedOrigin: string): void {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw invalidEndpoint();
  }

  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    parsed.hostname.length === 0 ||
    parsed.hostname.includes("*") ||
    (parsed.protocol === "http:" && !isLoopbackEndpoint(url))
  ) {
    throw invalidEndpoint();
  }

  if (parsed.origin !== allowedOrigin) {
    throw aiTransportError(
      "origin_mismatch",
      "The AI endpoint origin does not match the provider origin."
    );
  }
}

function invalidEndpoint(): Error {
  return aiTransportError(
    "invalid_endpoint",
    "The AI endpoint is not allowed by the browser transport."
  );
}

function validateBodySize(request: AiTransportRequest): void {
  const bytes =
    request.body === null ? 0 : new TextEncoder().encode(request.body).byteLength;

  if (bytes > AI_MAX_REQUEST_BYTES) {
    throw aiTransportError(
      "request_too_large",
      "The AI request exceeds the request size limit."
    );
  }
}

function responseByteLimit(requested: number): number {
  if (!Number.isSafeInteger(requested) || requested <= 0) {
    throw aiTransportError("invalid_request", "The AI response size limit is invalid.");
  }

  return Math.min(requested, AI_MAX_RESPONSE_BYTES);
}

async function resolveHeaders(
  request: AiTransportRequest,
  resolveCredential: BrowserAiTransportOptions["resolveCredential"]
): Promise<Headers> {
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    const normalized = name.toLowerCase();

    if (!ALLOWED_REQUEST_HEADERS.has(normalized)) {
      throw aiTransportError(
        "invalid_request",
        "The AI request contains a header the browser transport does not allow."
      );
    }

    headers.set(normalized, value);
  }

  if (request.auth === "none") {
    if (request.credential !== null) {
      throw aiTransportError(
        "unexpected_credential",
        "This provider does not accept a credential."
      );
    }

    return headers;
  }

  if (request.credential === null) {
    throw aiTransportError(
      "credential_missing",
      "This provider requires a session credential."
    );
  }

  if (request.credential.providerId !== request.providerId) {
    throw aiTransportError(
      "credential_provider_mismatch",
      "The credential belongs to another provider."
    );
  }

  let secret: string;

  try {
    secret = await resolveCredential(request.credential);
  } catch (error) {
    throw aiTransportError(
      "credential_missing",
      "The credential could not be resolved.",
      error
    );
  }

  if (secret.length === 0) {
    throw aiTransportError("credential_missing", "The credential is empty.");
  }

  if (request.auth === "bearer") {
    headers.set("authorization", `Bearer ${secret}`);
  } else {
    headers.set("x-api-key", secret);
  }

  return headers;
}

function createRequestControl(request: AiTransportRequest): {
  controller: AbortController;
  finish: () => void;
  timedOut: () => boolean;
} {
  if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs <= 0) {
    throw aiTransportError("invalid_request", "The AI request timeout is invalid.");
  }

  if (request.signal.aborted) {
    throw aiTransportError("aborted", "The AI request was aborted.");
  }

  const controller = new AbortController();
  let finished = false;
  let didTimeOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const onAbort = () => controller.abort(request.signal.reason);

  request.signal.addEventListener("abort", onAbort, { once: true });

  const finish = () => {
    if (finished) {
      return;
    }

    finished = true;

    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }

    request.signal.removeEventListener("abort", onAbort);
  };

  timer = setTimeout(() => {
    didTimeOut = true;
    controller.abort();
    finish();
  }, request.timeoutMs);

  return {
    controller,
    finish,
    timedOut: () => didTimeOut,
  };
}

function mapFetchError(
  error: unknown,
  controller: AbortController,
  timedOut: () => boolean
): Error {
  if (error instanceof AiError) {
    return error;
  }

  if (timedOut()) {
    return aiTransportError("timeout", "The AI request timed out.");
  }

  if (controller.signal.aborted) {
    return aiTransportError("aborted", "The AI request was aborted.");
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return aiTransportError("aborted", "The AI request was aborted.");
  }

  return aiTransportError(
    "network_error",
    "The AI request could not reach the provider."
  );
}

async function readText(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxBytes: number,
  controller: AbortController,
  timedOut: () => boolean
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;

  try {
    while (true) {
      const chunk = await reader.read();

      if (chunk.done) {
        break;
      }

      total += chunk.value.byteLength;

      if (total > maxBytes) {
        controller.abort();
        await reader.cancel().catch(() => undefined);

        throw aiTransportError(
          "response_too_large",
          "The AI response exceeds the response size limit."
        );
      }

      text += decoder.decode(chunk.value, { stream: true });
    }

    text += decoder.decode();

    return text;
  } catch (error) {
    throw mapReadError(error, controller, timedOut);
  }
}

function limitedBody(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxBytes: number,
  controller: AbortController,
  timedOut: () => boolean,
  claim: () => void,
  finish: () => void
): ReadableStream<Uint8Array> {
  let total = 0;
  let claimed = false;

  return new ReadableStream<Uint8Array>({
    async pull(streamController) {
      if (!claimed) {
        try {
          claim();
        } catch (error) {
          streamController.error(error);
          return;
        }

        claimed = true;
      }

      try {
        const chunk = await reader.read();

        if (chunk.done) {
          finish();
          streamController.close();
          return;
        }

        total += chunk.value.byteLength;

        if (total > maxBytes) {
          controller.abort();
          finish();
          await reader.cancel().catch(() => undefined);

          streamController.error(
            aiTransportError(
              "response_too_large",
              "The AI response exceeds the response size limit."
            )
          );
          return;
        }

        streamController.enqueue(chunk.value);
      } catch (error) {
        finish();
        streamController.error(mapReadError(error, controller, timedOut));
      }
    },
    async cancel() {
      finish();
      await reader.cancel().catch(() => undefined);
    },
  });
}

function mapReadError(
  error: unknown,
  controller: AbortController,
  timedOut: () => boolean
): Error {
  if (error instanceof AiError) {
    return error;
  }

  if (timedOut()) {
    return aiTransportError("timeout", "The AI request timed out.");
  }

  if (controller.signal.aborted) {
    return aiTransportError("aborted", "The AI request was aborted.");
  }

  return aiTransportError("network_error", "The AI response could not be read.");
}
