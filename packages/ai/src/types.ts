export type AiProviderKind = "local" | "remote" | "custom" | "mcp";
export type AiAuthType = "none" | "bearer" | "x-api-key";
export type AiCapability = "chat" | "embedding" | "vision" | "tools";

export interface AiProviderConfig {
  readonly id: string;
  readonly label: string;
  readonly kind: AiProviderKind;
  readonly adapter: "openai-compatible";
  readonly endpoint: string;
  readonly models: readonly string[];
  readonly capabilities: readonly AiCapability[];
  readonly auth: AiAuthType;
  readonly dataPolicyUrl: string | null;
  readonly maxContextTokens: number | null;
  readonly maxOutputTokens: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type AiProviderInput = Omit<AiProviderConfig, "id" | "createdAt" | "updatedAt">;

export interface AiProviderStore {
  list(): Promise<AiProviderConfig[]>;
  get(id: string): Promise<AiProviderConfig | null>;
  put(config: AiProviderConfig): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

export interface AiProviderRegistry {
  list(): Promise<AiProviderConfig[]>;
  get(id: string): Promise<AiProviderConfig | null>;
  create(input: AiProviderInput): Promise<AiProviderConfig>;
  update(id: string, input: AiProviderInput): Promise<AiProviderConfig>;
  remove(id: string): Promise<void>;
}

export type AiMessageRole = "system" | "user" | "assistant";

export interface AiMessage {
  readonly role: AiMessageRole;
  readonly content: string;
}

export interface AiRequest {
  readonly model: string;
  readonly messages: readonly AiMessage[];
  readonly stream: boolean;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface AiProviderPreset {
  readonly id: "openai-compatible" | "ollama" | "lm-studio" | "custom";
  readonly label: string;
  readonly config: AiProviderInput;
}

export interface AiCredentialHandle {
  readonly kind: "session" | "vault";
  readonly id: string;
  readonly providerId: string;
}

export interface AiTransportRequest {
  readonly url: string;
  readonly providerId: string;
  readonly allowedOrigin: string;
  readonly auth: AiAuthType;
  readonly method: "GET" | "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
  readonly credential: AiCredentialHandle | null;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
}

export interface AiTransportResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array> | null;
  readonly text: () => Promise<string>;
}

export interface AiTransport {
  send(request: AiTransportRequest): Promise<AiTransportResponse>;
}

export interface AiPreparedPayload {
  readonly provider: AiProviderConfig;
  readonly request: AiRequest;
  readonly endpoint: string;
  readonly origin: string;
  readonly body: string;
  readonly payloadHash: string;
  readonly payloadBytes: number;
}

export interface AiSendInput {
  readonly prepared: AiPreparedPayload;
  readonly transport: AiTransport;
  readonly credential: AiCredentialHandle | null;
  readonly signal: AbortSignal;
}

export interface AiUsage {
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly totalTokens: number | null;
}

export interface AiCompletion {
  readonly text: string;
  readonly model: string;
  readonly finishReason: string | null;
  readonly usage: AiUsage | null;
}

export type AiStreamEvent =
  | { readonly type: "delta"; readonly text: string }
  | {
      readonly type: "done";
      readonly model: string;
      readonly finishReason: string | null;
      readonly usage: AiUsage | null;
    };

export interface AiEmbedding {
  readonly model: string;
  readonly vectors: readonly (readonly number[])[];
  readonly usage: AiUsage | null;
}

export interface AiHealth {
  readonly ok: boolean;
  readonly status: number;
  readonly models: readonly string[];
}

export interface AiProviderAdapter {
  readonly config: AiProviderConfig;
  prepare(request: AiRequest): Promise<AiPreparedPayload>;
  complete(input: AiSendInput): Promise<AiCompletion>;
  stream(input: AiSendInput): AsyncIterable<AiStreamEvent>;
  embed(input: AiSendInput): Promise<AiEmbedding>;
  health(input: AiSendInput): Promise<AiHealth>;
  abort(): void;
}
