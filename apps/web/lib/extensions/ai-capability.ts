import { AiError, type AiCompletion, type AiProviderConfig } from "@opennest/ai";
import { ExtensionError } from "@opennest/extensions";
import { MAX_CONSENT_TTL_MS, type AuditLog, type DataClass } from "@opennest/privacy";
import { z } from "zod";

import type {
  AiCredentialChoice,
  AiPreparedRequest,
  AiRequestInput,
} from "../ai/runtime";

export const EXTENSION_AI_MAX_PROMPT_BYTES = 32 * 1024;
export const EXTENSION_AI_MAX_RESPONSE_BYTES = 48 * 1024;
export const EXTENSION_AI_REQUEST_TIMEOUT_MS = MAX_CONSENT_TTL_MS + 10_000;

const DATA_CLASSES: readonly DataClass[] = ["D2"];
const generateParamsSchema = z.strictObject({
  prompt: z.string().min(1),
  maxTokens: z.number().int().min(1).max(4_096).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

export interface ExtensionAiRuntime {
  isEnabled(): Promise<boolean>;
  listProviders(): Promise<AiProviderConfig[]>;
  prepare(input: AiRequestInput): Promise<AiPreparedRequest>;
  approveAndSend(
    input: AiPreparedRequest,
    options?: { signal?: AbortSignal }
  ): Promise<AiCompletion>;
}

export interface ExtensionAiSelection {
  readonly providerId: string;
  readonly model: string;
  readonly credential: AiCredentialChoice | null;
}

export interface ExtensionAiConsentRequest {
  readonly extensionId: string;
  readonly extensionName: string;
  readonly providerId: string;
  readonly providerLabel: string;
  readonly model: string;
  readonly origin: string;
  readonly dataClasses: readonly DataClass[];
  readonly payloadHash: string;
  readonly payloadBytes: number;
  readonly prompt: string;
  readonly expiresAt: number;
}

export interface ExtensionAiGenerateResult {
  readonly text: string;
  readonly model: string;
  readonly finishReason: string | null;
}

export interface ExtensionAiCapability {
  generate(
    extension: { readonly id: string; readonly name: string },
    params: unknown
  ): Promise<ExtensionAiGenerateResult>;
}

export interface CreateExtensionAiCapabilityInput {
  readonly ai: ExtensionAiRuntime;
  readonly audit: Pick<AuditLog, "append">;
  readonly workspaceId: string;
  readonly requestConsent: (request: ExtensionAiConsentRequest) => Promise<boolean>;
  readonly selectProvider?: (
    providers: readonly AiProviderConfig[]
  ) => ExtensionAiSelection | null;
  readonly now?: () => number;
}

function defaultSelection(
  providers: readonly AiProviderConfig[]
): ExtensionAiSelection | null {
  const provider = providers.find(
    (candidate) => candidate.capabilities.includes("chat") && candidate.models.length > 0
  );
  const model = provider?.models[0];

  if (provider === undefined || model === undefined) {
    return null;
  }

  return { providerId: provider.id, model, credential: null };
}

export function createExtensionAiCapability(
  input: CreateExtensionAiCapabilityInput
): ExtensionAiCapability {
  const now = input.now ?? (() => Date.now());
  const selectProvider = input.selectProvider ?? defaultSelection;

  async function record(
    extension: { readonly id: string },
    event: "ai.requested" | "ai.completed" | "ai.failed",
    outcome: "allowed" | "denied" | "completed" | "failed",
    reason: string | null
  ): Promise<void> {
    try {
      await input.audit.append({
        event,
        outcome,
        principalId: `extension:${extension.id}`,
        capability: "ai.generate",
        scopeDigest: null,
        reason,
      });
    } catch {
      return;
    }
  }

  return {
    async generate(extension, params) {
      const parsed = generateParamsSchema.safeParse(params);

      if (!parsed.success) {
        throw new ExtensionError(
          "invalid_params",
          "The AI request parameters are invalid."
        );
      }

      if (
        new TextEncoder().encode(parsed.data.prompt).byteLength >
        EXTENSION_AI_MAX_PROMPT_BYTES
      ) {
        throw new ExtensionError(
          "invalid_params",
          "The AI prompt exceeded the extension limit."
        );
      }

      let enabled = false;

      try {
        enabled = await input.ai.isEnabled();
      } catch {
        await record(extension, "ai.failed", "failed", "ai_unavailable");
        throw new ExtensionError("ai_unavailable", "AI is not available.");
      }

      if (!enabled) {
        await record(extension, "ai.requested", "denied", "ai_disabled");
        throw new ExtensionError("ai_unavailable", "AI is not available.");
      }

      let providers: AiProviderConfig[];

      try {
        providers = await input.ai.listProviders();
      } catch {
        await record(extension, "ai.failed", "failed", "ai_unavailable");
        throw new ExtensionError("ai_unavailable", "AI is not available.");
      }

      let selection: ExtensionAiSelection | null;

      try {
        selection = selectProvider(providers);
      } catch {
        selection = null;
      }

      if (selection === null) {
        await record(extension, "ai.requested", "denied", "no_provider");
        throw new ExtensionError("ai_unavailable", "AI is not available.");
      }

      const provider = providers.find(
        (candidate) => candidate.id === selection.providerId
      );

      if (
        provider === undefined ||
        !provider.capabilities.includes("chat") ||
        !provider.models.includes(selection.model)
      ) {
        await record(extension, "ai.requested", "denied", "no_provider");
        throw new ExtensionError("ai_unavailable", "AI is not available.");
      }

      let prepared: AiPreparedRequest;

      try {
        prepared = await input.ai.prepare({
          providerId: selection.providerId,
          model: selection.model,
          messages: [{ role: "user", content: parsed.data.prompt }],
          dataClasses: DATA_CLASSES,
          purpose: `Extension ${extension.name}`,
          credential: selection.credential,
          stream: false,
          ...(parsed.data.maxTokens === undefined
            ? {}
            : { maxTokens: parsed.data.maxTokens }),
          ...(parsed.data.temperature === undefined
            ? {}
            : { temperature: parsed.data.temperature }),
        });
      } catch {
        await record(extension, "ai.failed", "failed", "provider_error");
        throw new ExtensionError("ai_failed", "The AI request failed.");
      }

      let approved = false;

      try {
        approved = await input.requestConsent({
          extensionId: extension.id,
          extensionName: extension.name,
          providerId: provider.id,
          providerLabel: provider.label,
          model: selection.model,
          origin: prepared.prepared.origin,
          dataClasses: prepared.dataClasses,
          payloadHash: prepared.prepared.payloadHash,
          payloadBytes: prepared.prepared.payloadBytes,
          prompt: parsed.data.prompt,
          expiresAt: Math.min(prepared.expiresAt, now() + MAX_CONSENT_TTL_MS),
        });
      } catch {
        approved = false;
      }

      if (!approved) {
        await record(extension, "ai.requested", "denied", "consent_denied");
        throw new ExtensionError(
          "consent_required",
          "The host did not approve the AI request."
        );
      }

      await record(extension, "ai.requested", "allowed", null);

      let completion: AiCompletion;

      try {
        completion = await input.ai.approveAndSend(prepared);
      } catch (error) {
        await record(
          extension,
          "ai.failed",
          "failed",
          error instanceof AiError ? error.code : "provider_error"
        );
        throw new ExtensionError("ai_failed", "The AI request failed.");
      }

      if (
        new TextEncoder().encode(completion.text).byteLength >
        EXTENSION_AI_MAX_RESPONSE_BYTES
      ) {
        await record(extension, "ai.failed", "failed", "response_too_large");
        throw new ExtensionError(
          "response_too_large",
          "The AI response exceeded the extension limit."
        );
      }

      await record(extension, "ai.completed", "completed", null);

      return {
        text: completion.text,
        model: completion.model,
        finishReason: completion.finishReason,
      };
    },
  };
}
