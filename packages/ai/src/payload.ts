import { AiError } from "./errors";
import type { AiMessage, AiProviderConfig, AiRequest } from "./types";

export const MAX_AI_MESSAGES = 200;
export const MAX_AI_MESSAGE_BYTES = 64 * 1024;

const MESSAGE_ROLES = new Set(["system", "user", "assistant"]);

export function validateAiRequest(
  request: AiRequest,
  provider: AiProviderConfig
): AiRequest {
  if (typeof request !== "object" || request === null) {
    throw new AiError("invalid_request", "The AI request is not valid.");
  }

  if (typeof request.model !== "string" || !isValidModel(request.model)) {
    throw new AiError("invalid_model", "The model is not valid.");
  }

  if (!provider.models.includes(request.model)) {
    throw new AiError(
      "model_not_allowed",
      "The model is not configured for this provider."
    );
  }

  if (
    !Array.isArray(request.messages) ||
    request.messages.length === 0 ||
    request.messages.length > MAX_AI_MESSAGES
  ) {
    throw new AiError(
      "invalid_request",
      "The AI request must contain a valid list of messages."
    );
  }

  const messages = request.messages.map((message) => validateMessage(message));

  if (typeof request.stream !== "boolean") {
    throw new AiError("invalid_request", "The stream flag is not valid.");
  }

  if (
    request.temperature !== undefined &&
    (typeof request.temperature !== "number" ||
      !Number.isFinite(request.temperature) ||
      request.temperature < 0 ||
      request.temperature > 2)
  ) {
    throw new AiError("invalid_temperature", "The temperature must be between 0 and 2.");
  }

  if (
    request.maxTokens !== undefined &&
    (!Number.isInteger(request.maxTokens) ||
      request.maxTokens <= 0 ||
      (provider.maxOutputTokens !== null &&
        request.maxTokens > provider.maxOutputTokens) ||
      (provider.maxContextTokens !== null &&
        request.maxTokens > provider.maxContextTokens))
  ) {
    throw new AiError("invalid_max_tokens", "The maximum token count is not allowed.");
  }

  return {
    model: request.model,
    messages,
    stream: request.stream,
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
  };
}

export function joinEndpoint(endpoint: string, path: string): string {
  const base = endpoint.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;

  if (
    suffix.length === 0 ||
    suffix.startsWith("//") ||
    suffix.includes("?") ||
    suffix.includes("#")
  ) {
    throw new AiError("invalid_endpoint", "The AI endpoint path is not valid.");
  }

  return `${base}${suffix}`;
}

export async function hashPayload(body: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body)
  );

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function validateMessage(message: AiMessage): AiMessage {
  if (
    typeof message !== "object" ||
    message === null ||
    !MESSAGE_ROLES.has(message.role) ||
    typeof message.content !== "string" ||
    message.content.length === 0 ||
    new TextEncoder().encode(message.content).length > MAX_AI_MESSAGE_BYTES
  ) {
    throw new AiError("invalid_message", "The AI message is not valid.");
  }

  return { role: message.role, content: message.content };
}

function isValidModel(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 200 &&
    value.trim() === value &&
    !value.includes("*") &&
    !/[\u0000-\u001f\u007f\s]/.test(value)
  );
}
