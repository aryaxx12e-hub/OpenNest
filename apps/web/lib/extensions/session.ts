import type { AppServices } from "@/lib/data/services";
import type { Workspace } from "@opennest/core";
import {
  EXTENSION_ERROR_CODES,
  ExtensionError,
  createExtensionPackage,
  validateExtensionUiTree,
  verifyExtensionIntegrity,
  type ExtensionErrorCode,
  type ExtensionHostResponse,
  type ExtensionStorageStore,
  type ExtensionWorkerMessage,
  type ExtensionWorkerUi,
  type StoredExtension,
  type VerifiedExtensionPackage,
} from "@opennest/extensions";
import {
  createCapabilityBroker,
  type AuditLog,
  type CapabilityBroker,
  type GrantRegistry,
  type Principal,
  type WorkspaceCapability,
} from "@opennest/privacy";

import {
  EXTENSION_AI_REQUEST_TIMEOUT_MS,
  type ExtensionAiCapability,
} from "./ai-capability";
import { createExtensionHostApi, type ExtensionHostApi } from "./host-api";
import { isExtensionMessageWithinLimit, workerToHostSchema } from "./protocol";
import type { ExtensionTransport } from "./transport";

export const EXTENSION_HEARTBEAT_INTERVAL_MS = 1_000;
export const EXTENSION_HEARTBEAT_TIMEOUT_MS = 5_000;
export const EXTENSION_REQUEST_TIMEOUT_MS = 5_000;
export const EXTENSION_SESSION_MAX_MS = 30 * 60 * 1_000;
export const EXTENSION_GRANT_TTL_MS = 60 * 60 * 1_000;
export const EXTENSION_MAX_REQUESTS_PER_MINUTE = 120;
export const EXTENSION_MAX_UI_UPDATES_PER_MINUTE = 30;

const ACTION_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

export type ExtensionSessionStatus = "starting" | "running" | "stopped" | "error";

export interface ExtensionSessionStatusEvent {
  readonly status: ExtensionSessionStatus;
  readonly code?: ExtensionErrorCode;
  readonly message?: string;
}

export interface ExtensionSessionPrivacy {
  readonly grants: GrantRegistry;
  readonly audit: AuditLog;
}

export interface CreateExtensionSessionInput {
  readonly record: StoredExtension;
  readonly workspace: Workspace;
  readonly privacy: ExtensionSessionPrivacy;
  readonly services: AppServices;
  readonly storage: ExtensionStorageStore;
  readonly ai?: ExtensionAiCapability | null;
  readonly transport: ExtensionTransport;
  readonly onUi: (tree: ExtensionWorkerUi["tree"]) => void;
  readonly onStatus: (event: ExtensionSessionStatusEvent) => void;
  readonly now: () => number;
  readonly generateId: () => string;
}

export type ExtensionSessionResult =
  | ExtensionHostResponse
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error: { readonly code: ExtensionErrorCode; readonly message: string };
    };

export interface ExtensionSession {
  readonly extensionId: string;
  readonly sessionId: string | null;
  readonly status: ExtensionSessionStatus;
  start(): Promise<void>;
  stop(reason?: string): Promise<void>;
  action(actionId: string): Promise<void>;
  handleWorkerMessage(message: unknown): Promise<ExtensionSessionResult>;
}

function principalFor(record: StoredExtension): Principal {
  return {
    id: `extension:${record.id}`,
    type: "extension",
    label: record.manifest.name,
  };
}

function errorCode(error: unknown): ExtensionErrorCode {
  if (error instanceof ExtensionError) {
    return error.code;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    EXTENSION_ERROR_CODES.includes(error.code as ExtensionErrorCode)
  ) {
    return error.code as ExtensionErrorCode;
  }

  return "protocol_error";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 2_000);
  }

  return "The extension request failed.";
}

function failure(
  code: ExtensionErrorCode,
  message: string,
  id?: string
): ExtensionHostResponse {
  return {
    type: "worker:response",
    id: id ?? "0",
    ok: false,
    error: { code, message: message.slice(0, 2_000) },
  };
}

export function createExtensionSession(
  input: CreateExtensionSessionInput
): ExtensionSession {
  const { record, workspace, privacy, services, storage, transport } = input;
  const extensionId = record.id;
  const principal = principalFor(record);

  let sessionId: string | null = null;
  let status: ExtensionSessionStatus = "stopped";
  let broker: CapabilityBroker | null = null;
  let hostApi: ExtensionHostApi | null = null;
  let hasStarted = false;
  let startSent = false;
  let terminatedAudited = false;
  let inFlight = false;
  let lastSeenAt = 0;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let durationTimer: ReturnType<typeof setTimeout> | null = null;
  const requests: number[] = [];
  const uiUpdates: number[] = [];

  function takeRateLimitSlot(entries: number[], limit: number, at: number): boolean {
    const cutoff = at - 60_000;

    while (entries.length > 0 && (entries[0] ?? at) <= cutoff) {
      entries.shift();
    }

    if (entries.length >= limit) {
      return false;
    }

    entries.push(at);

    return true;
  }

  function emit(event: ExtensionSessionStatusEvent): void {
    input.onStatus(event);
  }

  function clearTimers(): void {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    if (durationTimer !== null) {
      clearTimeout(durationTimer);
      durationTimer = null;
    }
  }

  async function auditTerminated(reason: string): Promise<void> {
    if (terminatedAudited) {
      return;
    }

    terminatedAudited = true;

    try {
      await privacy.audit.append({
        event: "extension.terminated",
        outcome: "info",
        principalId: principal.id,
        reason,
      });
    } catch {
      return;
    }
  }

  async function finish(
    nextStatus: "stopped" | "error",
    reason: string,
    error?: unknown
  ): Promise<void> {
    if (status === "stopped" || status === "error") {
      return;
    }

    status = nextStatus;
    clearTimers();
    emit({
      status: nextStatus,
      ...(error === undefined
        ? {}
        : { code: errorCode(error), message: errorMessage(error) }),
    });

    try {
      if (startSent) {
        await transport.send({ type: "host:terminate" });
      }
    } catch {
      // The transport is already gone.
    }

    try {
      await transport.close();
    } catch {
      // The transport is already gone.
    }

    try {
      if (broker !== null) {
        await broker.endSession();
      } else if (sessionId !== null) {
        await privacy.grants.clearSession(sessionId);
      }
    } catch {
      // Session cleanup is best effort after a failure.
    }

    await auditTerminated(reason);
  }

  function sendResponse(response: ExtensionHostResponse): ExtensionHostResponse {
    const outgoing = isExtensionMessageWithinLimit(response)
      ? response
      : failure(
          "response_too_large",
          "The host response exceeded the message size limit.",
          response.id
        );

    void transport.send(outgoing);

    return outgoing;
  }

  function respond(response: ExtensionHostResponse): ExtensionHostResponse {
    if (status === "starting" || status === "running") {
      return sendResponse(response);
    }

    return response;
  }

  async function handleRequest(
    message: Extract<ExtensionWorkerMessage, { type: "worker:request" }>
  ): Promise<ExtensionHostResponse> {
    if (status !== "starting" && status !== "running") {
      return respond(
        failure("session_expired", "The extension session is not running.", message.id)
      );
    }

    if (inFlight) {
      return respond(failure("busy", "Only one request can run at a time.", message.id));
    }

    const at = input.now();

    if (!takeRateLimitSlot(requests, EXTENSION_MAX_REQUESTS_PER_MINUTE, at)) {
      return respond(
        failure(
          "rate_limited",
          "The extension is sending requests too quickly.",
          message.id
        )
      );
    }

    inFlight = true;

    let timer: ReturnType<typeof setTimeout> | null = null;

    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new ExtensionError("timeout", "The request timed out.")),
          message.method === "ai.generate"
            ? EXTENSION_AI_REQUEST_TIMEOUT_MS
            : EXTENSION_REQUEST_TIMEOUT_MS
        );
      });
      if (hostApi === null) {
        throw new ExtensionError("runtime_disposed", "The host API is not available.");
      }

      const response = await Promise.race([hostApi.handle(message), timeout]).then(
        (result) => ({
          type: "worker:response" as const,
          id: message.id,
          ok: true as const,
          result,
        })
      );

      return respond(response);
    } catch (error) {
      return respond(failure(errorCode(error), errorMessage(error), message.id));
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
      }

      inFlight = false;
    }
  }

  function handleUi(message: Extract<ExtensionWorkerMessage, { type: "worker:ui" }>) {
    try {
      const tree = validateExtensionUiTree(message.tree);
      input.onUi(tree);

      return { ok: true as const };
    } catch (error) {
      return {
        ok: false as const,
        error: {
          code: errorCode(error),
          message: errorMessage(error),
        },
      };
    }
  }

  async function handleReady(): Promise<void> {
    if (status !== "starting") {
      return;
    }

    status = "running";
    emit({ status });

    try {
      await privacy.audit.append({
        event: "extension.started",
        outcome: "info",
        principalId: principal.id,
      });
    } catch {
      return;
    }
  }

  return {
    extensionId,
    get sessionId() {
      return sessionId;
    },
    get status() {
      return status;
    },

    async start() {
      if (hasStarted || status !== "stopped") {
        throw new ExtensionError("busy", "The extension session has already started.");
      }

      hasStarted = true;
      sessionId = input.generateId();
      status = "starting";
      terminatedAudited = false;
      emit({ status });

      let verified: VerifiedExtensionPackage;

      try {
        verified = await verifyExtensionIntegrity(
          await createExtensionPackage({
            manifest: record.manifest,
            code: record.code,
          })
        );

        if (verified.integrity !== record.integrity) {
          throw new ExtensionError(
            "integrity_mismatch",
            "The stored extension no longer matches its integrity hash."
          );
        }
      } catch (error) {
        try {
          await privacy.audit.append({
            event: "extension.integrity_failed",
            outcome: "denied",
            principalId: principal.id,
            reason: errorMessage(error),
          });
        } catch {
          // The original integrity failure is still the actionable error.
        }

        await finish("error", "integrity_failed", error);
        throw error;
      }

      const expiresAt = input.now() + EXTENSION_GRANT_TTL_MS;

      try {
        for (const capability of record.manifest.capabilities) {
          if (!capability.startsWith("workspace.")) {
            continue;
          }

          await privacy.grants.create({
            principalId: principal.id,
            capability: capability as WorkspaceCapability,
            scope: { kind: "workspace", workspaceId: workspace.id },
            purpose: `Run ${record.manifest.name}`,
            expiresAt,
            sessionOnly: true,
            sessionId,
          });
        }

        broker = createCapabilityBroker({
          principal,
          sessionId,
          grants: privacy.grants,
          audit: privacy.audit,
          now: input.now,
          generateId: input.generateId,
        });
        hostApi = createExtensionHostApi({
          extensionId,
          extensionName: record.manifest.name,
          workspace,
          services,
          broker,
          storage,
          ai: input.ai ?? null,
          capabilities: record.manifest.capabilities,
          now: input.now,
        });

        await transport.open();
        await transport.send({ type: "host:start", code: verified.code });
        startSent = true;
        lastSeenAt = input.now();

        heartbeatTimer = setInterval(() => {
          if (input.now() - lastSeenAt > EXTENSION_HEARTBEAT_TIMEOUT_MS) {
            void finish("error", "heartbeat_timeout", {
              code: "timeout",
              message: "The extension stopped responding.",
            });
          }
        }, EXTENSION_HEARTBEAT_INTERVAL_MS);
        durationTimer = setTimeout(() => {
          void finish("error", "session_expired", {
            code: "session_expired",
            message: "The extension session reached its time limit.",
          });
        }, EXTENSION_SESSION_MAX_MS);
      } catch (error) {
        await finish("error", "start_failed", error);
        throw error;
      }
    },

    async stop(reason = "stopped") {
      await finish("stopped", reason);
    },

    async action(actionId) {
      if (!ACTION_PATTERN.test(actionId)) {
        throw new ExtensionError("invalid_params", "The action ID is invalid.");
      }

      if (status !== "running") {
        throw new ExtensionError(
          "session_expired",
          "The extension session is not running."
        );
      }

      await transport.send({ type: "host:action", actionId });
    },

    async handleWorkerMessage(message) {
      if (status === "stopped" || status === "error") {
        return {
          ok: false as const,
          error: {
            code: "session_expired" as const,
            message: "The extension session is not running.",
          },
        };
      }

      lastSeenAt = input.now();

      if (!isExtensionMessageWithinLimit(message)) {
        await finish("error", "message_too_large", {
          code: "protocol_error",
          message: "The extension message exceeded the size limit.",
        });

        return {
          ok: false as const,
          error: {
            code: "protocol_error" as const,
            message: "The extension message exceeded the size limit.",
          },
        };
      }

      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "worker:ui"
      ) {
        if (
          !takeRateLimitSlot(uiUpdates, EXTENSION_MAX_UI_UPDATES_PER_MINUTE, input.now())
        ) {
          return {
            ok: false as const,
            error: {
              code: "rate_limited" as const,
              message: "The extension is updating its interface too quickly.",
            },
          };
        }

        return handleUi(message as ExtensionWorkerUi);
      }

      const parsed = workerToHostSchema.safeParse(message);

      if (!parsed.success) {
        return {
          ok: false as const,
          error: {
            code: "protocol_error" as const,
            message: "The extension sent an invalid message.",
          },
        };
      }

      if (parsed.data.type === "worker:ready") {
        await handleReady();

        return { ok: true as const };
      }

      if (parsed.data.type === "worker:heartbeat") {
        return { ok: true as const };
      }

      if (parsed.data.type === "worker:request") {
        return handleRequest(parsed.data);
      }

      if (parsed.data.type === "worker:error") {
        await finish("error", "worker_error", {
          code: "protocol_error",
          message: parsed.data.message,
        });

        return {
          ok: false as const,
          error: {
            code: "protocol_error" as const,
            message: parsed.data.message,
          },
        };
      }

      return {
        ok: false as const,
        error: {
          code: "protocol_error" as const,
          message: "The extension sent an unsupported message.",
        },
      };
    },
  };
}
