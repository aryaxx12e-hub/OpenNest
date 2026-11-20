import type { SyncOutboxRow, SyncStore } from "@opennest/sync";
import {
  MAX_SYNC_BATCH_OPERATIONS,
  MAX_SYNC_PULL_OPERATIONS,
  SYNC_PROTOCOL_VERSION,
  pullRequestSchema,
  pushRequestSchema,
  type AppliedOperation,
  type PullRequest,
  type PushRequest,
  type SyncCursor,
} from "@opennest/sync-protocol";

import { nextRetryDelay, type BackoffOptions } from "./backoff";
import { SyncRequestError, type SyncRequest } from "./request";

export type SyncStatus =
  "disabled" | "connecting" | "online" | "offline" | "syncing" | "error";

export interface SyncClientSnapshot {
  status: SyncStatus;
  lastError: string | null;
  pendingCount: number;
}

export type SyncRunResult =
  | { status: "disabled" }
  | { status: "offline" }
  | { status: "online" }
  | { status: "error"; error: unknown; retryable: boolean };

export interface SyncClientOptions {
  workspaceId: string;
  store: SyncStore;
  request: SyncRequest;
  enabled?: boolean;
  isOnline?: () => boolean;
  now?: () => Date;
  subscribeToConnection?: (listener: () => void) => () => void;
  scheduleRetry?: (callback: () => void, delayMs: number) => () => void;
  backoff?: BackoffOptions;
  onRemoteOperations?: (operations: readonly AppliedOperation[]) => Promise<void>;
}

export interface SyncClient {
  start(): void;
  stop(): void;
  syncNow(): Promise<SyncRunResult>;
  getSnapshot(): SyncClientSnapshot;
  subscribe(listener: () => void): () => void;
}

function defaultIsOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

function defaultScheduleRetry(callback: () => void, delayMs: number): () => void {
  const timer = setTimeout(callback, delayMs);

  return () => clearTimeout(timer);
}

function isTerminal(error: unknown): boolean {
  return error instanceof SyncRequestError && !error.retryable;
}

function errorCode(error: unknown): string {
  if (error instanceof SyncRequestError) {
    return error.code;
  }

  return "sync_failed";
}

function parsePushRequest(input: unknown): PushRequest {
  const parsed = pushRequestSchema.safeParse(input);

  if (!parsed.success) {
    throw new SyncRequestError(400, "invalid_request", false);
  }

  return parsed.data;
}

function parsePullRequest(input: unknown): PullRequest {
  const parsed = pullRequestSchema.safeParse(input);

  if (!parsed.success) {
    throw new SyncRequestError(400, "invalid_request", false);
  }

  return parsed.data;
}

function canSend(row: SyncOutboxRow): boolean {
  return row.state === "pending" || row.state === "retry";
}

export function createSyncClient(options: SyncClientOptions): SyncClient {
  const {
    workspaceId,
    store,
    request,
    enabled = true,
    isOnline = defaultIsOnline,
    now = () => new Date(),
    subscribeToConnection = () => () => undefined,
    scheduleRetry = defaultScheduleRetry,
    backoff,
    onRemoteOperations,
  } = options;

  const listeners = new Set<() => void>();
  let snapshot: SyncClientSnapshot = {
    status: enabled ? "connecting" : "disabled",
    lastError: null,
    pendingCount: 0,
  };
  let started = false;
  let unsubscribeConnection: (() => void) | null = null;
  let cancelRetry: (() => void) | null = null;
  let inFlight: Promise<SyncRunResult> | null = null;
  let retryAttempt = 0;

  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function update(next: Partial<SyncClientSnapshot>): void {
    snapshot = { ...snapshot, ...next };
    notify();
  }

  function clearRetry(): void {
    cancelRetry?.();
    cancelRetry = null;
  }

  function isoNow(): string {
    return now().toISOString();
  }

  async function refreshPendingCount(): Promise<void> {
    const rows = await store.listOutbox(workspaceId);
    update({ pendingCount: rows.length });
  }

  function scheduleNextRetry(): void {
    clearRetry();
    const delay = nextRetryDelay(retryAttempt, backoff);
    retryAttempt += 1;
    cancelRetry = scheduleRetry(() => {
      cancelRetry = null;

      if (started && enabled && isOnline()) {
        void syncNow();
      }
    }, delay);
  }

  async function pushOutbox(): Promise<SyncRunResult | null> {
    for (;;) {
      const rows = (await store.listOutbox(workspaceId))
        .filter(canSend)
        .sort((left, right) => left.localSequence - right.localSequence)
        .slice(0, MAX_SYNC_BATCH_OPERATIONS);

      if (rows.length === 0) {
        return null;
      }

      const requestBody = parsePushRequest({
        protocolVersion: SYNC_PROTOCOL_VERSION,
        workspaceId,
        operations: rows.map((row) => ({
          opId: row.opId,
          entityType: row.entityType,
          entityId: row.entityId,
          operation: row.operation,
          baseEntityRevision: row.baseEntityRevision,
          baseWorkspaceRevision: row.baseWorkspaceRevision,
          fieldPatches: row.fieldPatches,
          payloadHash: row.payloadHash,
          deviceId: row.deviceId,
          localSequence: row.localSequence,
          createdAt: row.createdAt,
        })),
      });
      const response = await request.push(requestBody);

      for (const applied of response.applied) {
        await store.deleteOutbox(applied.opId);
      }

      for (const conflict of response.conflicts) {
        await store.putConflict({
          conflictId: conflict.conflictId,
          workspaceId,
          entityType: conflict.entityType,
          entityId: conflict.entityId,
          fieldPath: conflict.fieldPath,
          localFieldRevision: conflict.localFieldRevision,
          remoteFieldRevision: conflict.remoteFieldRevision,
          localOpId: conflict.localOpId,
          remoteOpId: conflict.remoteOpId,
          localValue: conflict.localValue,
          remoteValue: conflict.remoteValue,
          localDeviceId: conflict.localDeviceId,
          remoteDeviceId: conflict.remoteDeviceId,
          createdAt: conflict.createdAt,
          state: "open",
          resolution: null,
          resolvedAt: null,
          resolvedByDeviceId: null,
        });
      }

      await refreshPendingCount();

      const rejected = response.rejected[0];

      if (rejected !== undefined) {
        const error = new SyncRequestError(409, rejected.code, false);
        update({ status: "error", lastError: rejected.code });
        return { status: "error", error, retryable: false };
      }

      if (response.applied.length === 0) {
        return null;
      }
    }
  }

  async function pullRemote(deviceId: string): Promise<void> {
    if (onRemoteOperations === undefined) {
      return;
    }

    const state = await store.getOrCreateWorkspaceState(workspaceId, deviceId, isoNow());
    let cursor = state.lastServerCursor as SyncCursor | null;
    let currentState = state;

    for (;;) {
      const requestBody = parsePullRequest({
        protocolVersion: SYNC_PROTOCOL_VERSION,
        workspaceId,
        cursor,
        limit: MAX_SYNC_PULL_OPERATIONS,
      });
      const response = await request.pull(requestBody);
      const remote = response.operations.filter(
        (operation) => operation.deviceId !== deviceId
      );

      if (remote.length > 0) {
        await onRemoteOperations(remote);
      }

      currentState = {
        ...currentState,
        lastServerCursor: response.nextCursor,
      };
      await store.putWorkspaceState(currentState);

      if (response.nextCursor === null) {
        return;
      }

      if (response.nextCursor === cursor) {
        throw new SyncRequestError(502, "invalid_response", false);
      }

      cursor = response.nextCursor;
    }
  }

  async function run(): Promise<SyncRunResult> {
    clearRetry();
    update({ status: "syncing", lastError: null });

    try {
      const device = await store.getOrCreateDevice(workspaceId, isoNow());
      await store.getOrCreateWorkspaceState(workspaceId, device.deviceId, isoNow());

      const pushResult = await pushOutbox();

      if (pushResult !== null) {
        return pushResult;
      }

      await pullRemote(device.deviceId);
      await refreshPendingCount();
      retryAttempt = 0;
      update({ status: "online", lastError: null });

      return { status: "online" };
    } catch (error) {
      if (!isOnline()) {
        update({ status: "offline", lastError: errorCode(error) });
        return { status: "offline" };
      }

      if (isTerminal(error)) {
        update({ status: "error", lastError: errorCode(error) });
        return { status: "error", error, retryable: false };
      }

      update({ status: "connecting", lastError: errorCode(error) });
      scheduleNextRetry();
      return { status: "error", error, retryable: true };
    }
  }

  async function syncNow(): Promise<SyncRunResult> {
    if (!enabled) {
      update({ status: "disabled" });
      return { status: "disabled" };
    }

    if (inFlight !== null) {
      return inFlight;
    }

    clearRetry();

    if (!isOnline()) {
      update({ status: "offline" });
      return { status: "offline" };
    }

    inFlight = run().finally(() => {
      inFlight = null;
    });

    return inFlight;
  }

  return {
    start() {
      if (!enabled) {
        update({ status: "disabled" });
        return;
      }

      if (started) {
        return;
      }

      started = true;
      unsubscribeConnection = subscribeToConnection(() => {
        if (isOnline()) {
          retryAttempt = 0;
          void syncNow();
        } else {
          clearRetry();
          update({ status: "offline" });
        }
      });
      void refreshPendingCount().catch(() => undefined);
      void syncNow();
    },

    stop() {
      started = false;
      clearRetry();
      unsubscribeConnection?.();
      unsubscribeConnection = null;
    },

    syncNow,

    getSnapshot() {
      return snapshot;
    },

    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}
