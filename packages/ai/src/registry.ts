import { validateEndpoint } from "./endpoint";
import { AiError } from "./errors";
import type {
  AiAuthType,
  AiCapability,
  AiProviderConfig,
  AiProviderInput,
  AiProviderKind,
  AiProviderRegistry,
  AiProviderStore,
} from "./types";

const PROVIDER_INPUT_KEYS = new Set([
  "label",
  "kind",
  "adapter",
  "endpoint",
  "models",
  "capabilities",
  "auth",
  "dataPolicyUrl",
  "maxContextTokens",
  "maxOutputTokens",
]);

const PROVIDER_KINDS = new Set<AiProviderKind>(["local", "remote", "custom", "mcp"]);
const AUTH_TYPES = new Set<AiAuthType>(["none", "bearer", "x-api-key"]);
const CAPABILITIES = new Set<AiCapability>(["chat", "embedding", "vision", "tools"]);
const MAX_MODELS = 100;
const MAX_CONTEXT_TOKENS = 2_000_000;
const MAX_OUTPUT_TOKENS = 1_000_000;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export interface CreateAiProviderRegistryOptions {
  store: AiProviderStore;
  now?: () => number;
  generateId?: () => string;
}

export function createAiProviderRegistry(
  options: CreateAiProviderRegistryOptions
): AiProviderRegistry {
  const { store } = options;
  const now = options.now ?? (() => Date.now());
  const generateId =
    options.generateId ?? (() => `provider_${globalThis.crypto.randomUUID()}`);

  return {
    list() {
      return store.list();
    },
    get(id) {
      return store.get(id);
    },
    async create(input) {
      const validated = validateProviderInput(input);
      const id = generateId();

      if (!isValidProviderId(id)) {
        throw new AiError("invalid_provider_id", "The provider ID is not valid.");
      }

      const at = now();
      const config: AiProviderConfig = {
        ...validated,
        id,
        createdAt: at,
        updatedAt: at,
      };

      await store.put(config);

      return config;
    },
    async update(id, input) {
      const existing = await store.get(id);

      if (existing === null) {
        throw new AiError("unknown_provider", "The AI provider does not exist.");
      }

      const validated = validateProviderInput(input);
      const updated: AiProviderConfig = {
        ...validated,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: now(),
      };

      await store.put(updated);

      return updated;
    },
    async remove(id) {
      await store.delete(id);
    },
  };
}

export function validateProviderInput(input: AiProviderInput): AiProviderInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new AiError("invalid_provider", "The AI provider is not valid.");
  }

  for (const key of Object.keys(input)) {
    if (!PROVIDER_INPUT_KEYS.has(key)) {
      throw new AiError(
        "invalid_provider",
        "The AI provider contains an unsupported field."
      );
    }
  }

  if (!PROVIDER_KINDS.has(input.kind)) {
    throw new AiError("unsupported_provider_kind", "The provider kind is not supported.");
  }

  if (input.kind === "mcp") {
    throw new AiError(
      "unsupported_provider_kind",
      "MCP providers are not supported in this release."
    );
  }

  if (input.adapter !== "openai-compatible") {
    throw new AiError("invalid_adapter", "The provider adapter is not supported.");
  }

  if (
    typeof input.label !== "string" ||
    input.label.length === 0 ||
    input.label.length > 120 ||
    input.label.trim() !== input.label ||
    CONTROL_CHARACTERS.test(input.label)
  ) {
    throw new AiError("invalid_label", "The provider label is not valid.");
  }

  const endpoint = validateEndpoint(input.endpoint, input.kind);
  const models = validateModels(input.models);
  const capabilities = validateCapabilities(input.capabilities);

  if (!AUTH_TYPES.has(input.auth)) {
    throw new AiError("invalid_auth", "The provider authentication type is not valid.");
  }

  const dataPolicyUrl = validateDataPolicyUrl(input.dataPolicyUrl);
  const maxContextTokens = validateTokenLimit(input.maxContextTokens, MAX_CONTEXT_TOKENS);
  const maxOutputTokens = validateTokenLimit(input.maxOutputTokens, MAX_OUTPUT_TOKENS);

  if (
    maxContextTokens !== null &&
    maxOutputTokens !== null &&
    maxOutputTokens > maxContextTokens
  ) {
    throw new AiError(
      "invalid_token_limit",
      "The output token limit cannot exceed the context limit."
    );
  }

  return {
    label: input.label,
    kind: input.kind,
    adapter: input.adapter,
    endpoint,
    models,
    capabilities,
    auth: input.auth,
    dataPolicyUrl,
    maxContextTokens,
    maxOutputTokens,
  };
}

function validateModels(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MODELS) {
    throw new AiError(
      "invalid_models",
      "The provider must contain between one and one hundred models."
    );
  }

  const seen = new Set<string>();

  for (const model of value) {
    if (!isValidModel(model)) {
      throw new AiError("invalid_models", "A provider model is not valid.");
    }

    if (seen.has(model)) {
      throw new AiError("duplicate_model", "Provider models must be unique.");
    }

    seen.add(model);
  }

  return [...value];
}

function validateCapabilities(value: readonly AiCapability[]): readonly AiCapability[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AiError(
      "invalid_capability",
      "The provider must declare at least one capability."
    );
  }

  const seen = new Set<AiCapability>();

  for (const capability of value) {
    if (!CAPABILITIES.has(capability)) {
      throw new AiError("invalid_capability", "A provider capability is not valid.");
    }

    if (capability === "tools") {
      throw new AiError(
        "unsupported_capability",
        "Tool capabilities are not supported in this release."
      );
    }

    if (seen.has(capability)) {
      throw new AiError("duplicate_capability", "Provider capabilities must be unique.");
    }

    seen.add(capability);
  }

  return [...value];
}

function validateDataPolicyUrl(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || value.length === 0) {
    throw new AiError("invalid_data_policy_url", "The data policy URL is not valid.");
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new AiError("invalid_data_policy_url", "The data policy URL is not valid.");
  }

  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0 ||
    url.hostname.length === 0 ||
    url.hostname.includes("*")
  ) {
    throw new AiError(
      "invalid_data_policy_url",
      "The data policy URL must be an HTTPS URL."
    );
  }

  return url.toString();
}

function validateTokenLimit(value: number | null, maximum: number): number | null {
  if (value === null) {
    return null;
  }

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value <= 0 ||
    value > maximum
  ) {
    throw new AiError("invalid_token_limit", "A token limit is not valid.");
  }

  return value;
}

function isValidProviderId(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 300 &&
    value.trim() === value &&
    !value.includes("*") &&
    !value.includes("..") &&
    !/[\u0000-\u001f\u007f\s/\\#?]/.test(value)
  );
}

function isValidModel(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 200 &&
    value.trim() === value &&
    !value.includes("*") &&
    !CONTROL_CHARACTERS.test(value) &&
    !/\s/.test(value)
  );
}
