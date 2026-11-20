import {
  AI_MAX_REQUEST_BYTES,
  AI_MAX_RESPONSE_BYTES,
  type AiCompletion,
  type AiProviderConfig,
} from "@opennest/ai";
import { MAX_CONSENT_TTL_MS, type DataClass } from "@opennest/privacy";

import type { AiPreparedRequest, AiRequestInput } from "./runtime";
import { validateCitations } from "./retrieval/citations";
import type { Passage } from "./retrieval/types";

export type QaErrorCode =
  | "disabled"
  | "no_provider"
  | "invalid_question"
  | "invalid_passages"
  | "invalid_data_class"
  | "request_too_large"
  | "consent_expired"
  | "payload_changed"
  | "response_too_large";

export class QaError extends Error {
  readonly code: QaErrorCode;

  constructor(code: QaErrorCode, message?: string) {
    super(message ?? code);
    this.name = "QaError";
    this.code = code;
  }
}

export interface QaAi {
  isEnabled(): Promise<boolean>;
  listProviders(): Promise<AiProviderConfig[]>;
  prepare(input: AiRequestInput): Promise<AiPreparedRequest>;
  approveAndSend(
    input: AiPreparedRequest,
    options?: { signal?: AbortSignal }
  ): Promise<AiCompletion>;
}

export interface QaPrepareInput {
  readonly providerId: string;
  readonly model: string;
  readonly question: string;
  readonly passages: readonly Passage[];
  readonly credential: AiRequestInput["credential"];
  readonly dataClasses?: readonly DataClass[];
}

export interface QaPrepared {
  readonly request: AiPreparedRequest;
  readonly question: string;
  readonly prompt: string;
  readonly passages: readonly Passage[];
  readonly payloadHash: string;
  readonly payloadBytes: number;
  readonly expiresAt: number;
}

export interface QaAnswer {
  readonly text: string;
  readonly citations: readonly Passage[];
  readonly unsupported: boolean;
}

export interface Qa {
  prepare(input: QaPrepareInput): Promise<QaPrepared>;
  send(prepared: QaPrepared, options?: { signal?: AbortSignal }): Promise<QaAnswer>;
}

export interface CreateQaInput {
  readonly ai: QaAi;
  readonly enabled?: boolean;
  readonly now?: () => number;
}

const DATA_CLASSES: readonly DataClass[] = ["D2"];
const PURPOSE = "Document Q&A";

export function readBrowserQaConfig(
  value: string | undefined = process.env.NEXT_PUBLIC_OPENNEST_AI_QA
): { enabled: boolean } {
  return { enabled: value === "true" };
}

export function buildQaPrompt(question: string, passages: readonly Passage[]): string {
  const sources = passages
    .map(
      (passage, index) =>
        `${index + 1}. [${passage.id}] (${passage.kind}: ${passage.sourceTitle})\n${passage.text}`
    )
    .join("\n\n");

  return `Answer only from the passages below. Cite every claim with the passage id in double brackets, like [[id]]. If the passages do not support an answer, say that the answer is not supported by the selected sources.\n\n${sources}\n\nQuestion: ${question}`;
}

export function createQa(input: CreateQaInput): Qa {
  const now = input.now ?? (() => Date.now());
  const enabled = input.enabled ?? readBrowserQaConfig().enabled;

  return {
    async prepare(prepareInput) {
      if (!enabled) {
        throw new QaError("disabled", "Document Q&A is turned off.");
      }

      if (!(await input.ai.isEnabled())) {
        throw new QaError("disabled", "AI is turned off.");
      }

      const question = prepareInput.question.trim();

      if (question.length === 0) {
        throw new QaError("invalid_question", "Enter a question first.");
      }

      if (prepareInput.passages.length === 0) {
        throw new QaError("invalid_passages", "Select at least one note or text file.");
      }

      const dataClasses = prepareInput.dataClasses ?? DATA_CLASSES;

      if (
        dataClasses.length !== 1 ||
        dataClasses[0] !== "D2" ||
        dataClasses.some((dataClass) => dataClass === "D3")
      ) {
        throw new QaError("invalid_data_class", "Document Q&A may only send D2 content.");
      }

      const providers = await input.ai.listProviders();
      const provider = providers.find(
        (candidate) => candidate.id === prepareInput.providerId
      );

      if (provider === undefined || !provider.capabilities.includes("chat")) {
        throw new QaError("no_provider", "No chat provider is configured.");
      }

      const prompt = buildQaPrompt(question, prepareInput.passages);

      if (new TextEncoder().encode(prompt).byteLength > AI_MAX_REQUEST_BYTES) {
        throw new QaError(
          "request_too_large",
          "The selected sources are too large to send."
        );
      }

      const request = await input.ai.prepare({
        providerId: prepareInput.providerId,
        model: prepareInput.model,
        messages: [
          {
            role: "system",
            content:
              "You answer questions about the user's local notes and files. Use only the supplied passages and cite them with [[passage-id]].",
          },
          { role: "user", content: prompt },
        ],
        dataClasses: DATA_CLASSES,
        purpose: PURPOSE,
        credential: prepareInput.credential,
        stream: false,
      });

      if (request.prepared.payloadBytes > AI_MAX_REQUEST_BYTES) {
        throw new QaError(
          "request_too_large",
          "The selected sources are too large to send."
        );
      }

      return {
        request,
        question,
        prompt,
        passages: [...prepareInput.passages],
        payloadHash: request.prepared.payloadHash,
        payloadBytes: request.prepared.payloadBytes,
        expiresAt: Math.min(request.expiresAt, now() + MAX_CONSENT_TTL_MS),
      };
    },
    async send(prepared, options = {}) {
      if (now() >= prepared.expiresAt) {
        throw new QaError(
          "consent_expired",
          "This consent expired. Review and approve the request again."
        );
      }

      if (prepared.request.prepared.payloadHash !== prepared.payloadHash) {
        throw new QaError("payload_changed", "The approved payload changed.");
      }

      const completion = await input.ai.approveAndSend(prepared.request, {
        signal: options.signal,
      });

      if (new TextEncoder().encode(completion.text).byteLength > AI_MAX_RESPONSE_BYTES) {
        throw new QaError("response_too_large", "The answer was too large to display.");
      }

      const validation = validateCitations(completion.text, prepared.passages);

      return {
        text: validation.answer.trim(),
        citations: validation.citations,
        unsupported: validation.unsupported,
      };
    },
  };
}
