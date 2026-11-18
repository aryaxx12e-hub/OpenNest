import type { ExtensionHostMethod } from "./api";
import type { ExtensionErrorCode } from "./errors";
import type { ExtensionUiNode } from "./ui";

export interface ExtensionWorkerReady {
  readonly type: "worker:ready";
}

export interface ExtensionWorkerHeartbeat {
  readonly type: "worker:heartbeat";
}

export interface ExtensionWorkerRequest {
  readonly type: "worker:request";
  readonly id: string;
  readonly method: ExtensionHostMethod;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface ExtensionWorkerUi {
  readonly type: "worker:ui";
  readonly tree: ExtensionUiNode;
}

export interface ExtensionWorkerError {
  readonly type: "worker:error";
  readonly code: string;
  readonly message: string;
}

export type ExtensionWorkerMessage =
  | ExtensionWorkerReady
  | ExtensionWorkerHeartbeat
  | ExtensionWorkerRequest
  | ExtensionWorkerUi
  | ExtensionWorkerError;

export interface ExtensionHostResponseSuccess {
  readonly type: "worker:response";
  readonly id: string;
  readonly ok: true;
  readonly result: unknown;
}

export interface ExtensionHostResponseFailure {
  readonly type: "worker:response";
  readonly id: string;
  readonly ok: false;
  readonly error: {
    readonly code: ExtensionErrorCode;
    readonly message: string;
  };
}

export type ExtensionHostResponse =
  ExtensionHostResponseSuccess | ExtensionHostResponseFailure;

export interface ExtensionHostAction {
  readonly type: "host:action";
  readonly actionId: string;
}

export interface ExtensionHostStart {
  readonly type: "host:start";
  readonly code: string;
}

export interface ExtensionHostTerminate {
  readonly type: "host:terminate";
}

export type ExtensionHostMessage =
  | ExtensionHostResponse
  | ExtensionHostAction
  | ExtensionHostStart
  | ExtensionHostTerminate;

export interface ExtensionShellReady {
  readonly type: "shell:ready";
}

export interface ExtensionSandboxInit {
  readonly type: "opennest:init";
  readonly hostOrigin: string;
}
