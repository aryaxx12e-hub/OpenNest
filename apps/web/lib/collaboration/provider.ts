import {
  applyDocumentUpdate,
  createCollaborationDocument,
  documentText,
  readDocumentText,
} from "@opennest/collaboration";
import { mergeUpdates, type Doc } from "yjs";

import { nextRetryDelay, type BackoffOptions } from "@/lib/sync/backoff";

export const COLLABORATION_PATH = "/api/collaboration";
export const MAX_COLLABORATION_UPDATE_BYTES = 256 * 1024;
const DEFAULT_HEARTBEAT_MS = 15_000;
const LOCAL_ORIGIN = Symbol("opennest-collaboration-local");

export type CollaborationRole = "owner" | "editor" | "viewer";

export type CollaborationStatus =
  "disabled" | "connecting" | "connected" | "reconnecting" | "offline" | "error";

export type CollaborationTextSource = "local" | "remote";

export interface CollaborationParticipant {
  connectionId: string;
  userId: string;
  displayName: string;
  color: string;
  joinedAt: string;
  lastSeenAt: string;
}

export interface CollaborationSnapshot {
  status: CollaborationStatus;
  role: CollaborationRole | null;
  readOnly: boolean;
  participants: readonly CollaborationParticipant[];
  lastError: string | null;
}

export interface CollaborationMessageEvent {
  data?: unknown;
  code?: number;
  reason?: string;
}

export interface CollaborationSocket {
  binaryType?: string;
  readonly readyState: number;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: string,
    listener: (event: CollaborationMessageEvent) => void
  ): void;
}

export interface CollaborationProviderOptions {
  noteId: string;
  shared: boolean;
  url?: string | null;
  initialText?: string;
  createSocket?: (url: string) => CollaborationSocket;
  createDocument?: () => Doc;
  isOnline?: () => boolean;
  subscribeToConnection?: (listener: () => void) => () => void;
  schedule?: (callback: () => void, delayMs: number) => () => void;
  backoff?: BackoffOptions;
  heartbeatMs?: number;
  onTextChange?: (text: string, source: CollaborationTextSource) => void;
}

export interface CollaborationProvider {
  start(): void;
  stop(): void;
  destroy(): void;
  getSnapshot(): CollaborationSnapshot;
  subscribe(listener: () => void): () => void;
  getText(): string;
  setText(text: string): boolean;
}

export interface BrowserCollaborationConfig {
  shared: true;
  url: string;
}

function defaultIsOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

function defaultSchedule(callback: () => void, delayMs: number): () => void {
  const timer = setTimeout(callback, delayMs);

  return () => clearTimeout(timer);
}

function defaultSubscribeToConnection(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);

  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

function defaultCreateSocket(url: string): CollaborationSocket {
  if (typeof WebSocket === "undefined") {
    throw new Error("WebSocket is unavailable.");
  }

  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";

  return {
    get binaryType() {
      return socket.binaryType;
    },
    set binaryType(value: string) {
      socket.binaryType = value as BinaryType;
    },
    get readyState() {
      return socket.readyState;
    },
    send(data) {
      socket.send(data);
    },
    close(code, reason) {
      socket.close(code, reason);
    },
    addEventListener(type, listener) {
      socket.addEventListener(type, (event) => {
        if (event instanceof MessageEvent) {
          listener({ data: event.data });
          return;
        }

        if (event instanceof CloseEvent) {
          listener({ code: event.code, reason: event.reason });
          return;
        }

        listener({});
      });
    },
  };
}

function normalizeBaseUrl(baseUrl: string): URL {
  const url = new URL(baseUrl, "http://localhost");

  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("The collaboration URL must use HTTP, HTTPS, WS, or WSS.");
  }

  return url;
}

export function buildCollaborationUrl(baseUrl: string, noteId: string): string {
  const url = normalizeBaseUrl(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");

  url.pathname = path.endsWith(COLLABORATION_PATH)
    ? path
    : `${path}${COLLABORATION_PATH}`;
  url.searchParams.set("noteId", noteId);

  return url.toString();
}

export function readBrowserCollaborationConfig(
  urlValue?: string,
  sharedValue?: string
): BrowserCollaborationConfig | null {
  const url =
    urlValue ??
    (typeof process === "undefined"
      ? undefined
      : process.env.NEXT_PUBLIC_OPENNEST_COLLABORATION_URL);
  const shared =
    sharedValue ??
    (typeof process === "undefined"
      ? undefined
      : process.env.NEXT_PUBLIC_OPENNEST_SHARED_WORKSPACE);

  if (shared !== "true" || url === undefined || url.trim().length === 0) {
    return null;
  }

  return { shared: true, url: url.trim() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isParticipant(value: unknown): value is CollaborationParticipant {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.connectionId === "string" &&
    typeof value.userId === "string" &&
    typeof value.displayName === "string" &&
    typeof value.color === "string" &&
    typeof value.joinedAt === "string" &&
    typeof value.lastSeenAt === "string"
  );
}

function parseParticipants(value: unknown): CollaborationParticipant[] | null {
  if (!Array.isArray(value) || !value.every(isParticipant)) {
    return null;
  }

  return value.map((participant) => ({ ...participant }));
}

function parseRole(value: unknown): CollaborationRole | null {
  return value === "owner" || value === "editor" || value === "viewer" ? value : null;
}

function binaryPayload(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }

  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }

  return null;
}

export function createCollaborationProvider(
  options: CollaborationProviderOptions
): CollaborationProvider {
  const noteId = options.noteId.trim();
  const baseUrl = options.url?.trim() ?? "";
  const enabled = options.shared && noteId.length > 0 && baseUrl.length > 0;
  const createSocket = options.createSocket ?? defaultCreateSocket;
  const isOnline = options.isOnline ?? defaultIsOnline;
  const subscribeToConnection =
    options.subscribeToConnection ?? defaultSubscribeToConnection;
  const schedule = options.schedule ?? defaultSchedule;
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const onTextChange = options.onTextChange;
  const document = (options.createDocument ?? createCollaborationDocument)();

  const listeners = new Set<() => void>();
  let snapshot: CollaborationSnapshot = {
    status: enabled ? "connecting" : "disabled",
    role: null,
    readOnly: false,
    participants: [],
    lastError: null,
  };
  let started = false;
  let socket: CollaborationSocket | null = null;
  let ready = false;
  let receivedServerState = false;
  let pendingLocalText: string | null = null;
  let hasPendingLocalText = false;
  let pendingUpdates: Uint8Array[] = [];
  let lastServerText = "";
  let retryAttempt = 0;
  let cancelRetry: (() => void) | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let unsubscribeConnection: (() => void) | null = null;
  let lastNotifiedText = "";
  let suppressTextNotification = false;

  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function update(next: Partial<CollaborationSnapshot>): void {
    snapshot = { ...snapshot, ...next };
    notify();
  }

  function notifyText(source: CollaborationTextSource): void {
    const text = readDocumentText(document);

    if (text === lastNotifiedText) {
      return;
    }

    lastNotifiedText = text;
    onTextChange?.(text, source);
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function sendPresence(): void {
    if (!ready || socket === null) {
      return;
    }

    try {
      socket.send(JSON.stringify({ type: "presence" }));
    } catch {
      socket.close(1011, "Presence could not be sent.");
    }
  }

  function startHeartbeat(): void {
    stopHeartbeat();

    if (heartbeatMs <= 0) {
      return;
    }

    sendPresence();
    heartbeatTimer = setInterval(sendPresence, heartbeatMs);
  }

  function onDocumentUpdate(update: Uint8Array, origin: unknown): void {
    const local = origin === LOCAL_ORIGIN;

    if (local) {
      if (ready && socket !== null) {
        try {
          socket.send(update);
        } catch {
          pendingUpdates.push(new Uint8Array(update));
          socket.close(1011, "The update could not be sent.");
        }
      } else {
        pendingUpdates.push(new Uint8Array(update));
      }
    }

    if (!suppressTextNotification) {
      notifyText(local ? "local" : "remote");
    }
  }

  document.on("update", onDocumentUpdate);

  function replaceText(text: string, local: boolean): boolean {
    if (readDocumentText(document) === text) {
      return false;
    }

    document.transact(
      () => {
        const target = documentText(document);

        if (target.length > 0) {
          target.delete(0, target.length);
        }

        if (text.length > 0) {
          target.insert(0, text);
        }
      },
      local ? LOCAL_ORIGIN : null
    );

    return true;
  }

  function flushPending(): void {
    if (!ready || socket === null || pendingUpdates.length === 0) {
      return;
    }

    const updates = pendingUpdates;
    pendingUpdates = [];
    const merged = mergeUpdates(updates);

    if (merged.byteLength > MAX_COLLABORATION_UPDATE_BYTES) {
      pendingUpdates = updates;
      update({ lastError: "too_large" });
      return;
    }

    try {
      socket.send(merged);
    } catch {
      pendingUpdates = updates;
      socket.close(1011, "Queued updates could not be sent.");
    }
  }

  function applyServerState(state: Uint8Array): void {
    const localDraft = pendingLocalText;
    const overridesServer = hasPendingLocalText;
    const firstState = !receivedServerState;

    suppressTextNotification = overridesServer;

    try {
      applyDocumentUpdate(document, state);
    } catch {
      update({ lastError: "invalid_update" });
      return;
    } finally {
      suppressTextNotification = false;
    }

    receivedServerState = true;
    lastServerText = readDocumentText(document);

    if (overridesServer) {
      replaceText(localDraft ?? "", true);
    } else if (
      firstState &&
      lastServerText.length === 0 &&
      options.initialText !== undefined &&
      options.initialText.length > 0
    ) {
      replaceText(options.initialText, true);
    } else {
      notifyText("remote");
    }

    pendingLocalText = null;
    hasPendingLocalText = false;
  }

  function handleMessage(event: CollaborationMessageEvent): void {
    const binary = binaryPayload(event.data);

    if (binary !== null) {
      applyServerState(binary);
      return;
    }

    if (typeof event.data !== "string") {
      return;
    }

    let message: unknown;

    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (!isRecord(message)) {
      return;
    }

    if (message.type === "presence") {
      const participants = parseParticipants(message.participants);

      if (participants !== null) {
        update({ participants });
      }

      return;
    }

    if (message.type === "ready") {
      const role = parseRole(message.role);

      if (role === null) {
        update({ lastError: "invalid_ready" });
        return;
      }

      const readOnly = message.readOnly === true || role === "viewer";

      if (readOnly) {
        pendingLocalText = null;
        hasPendingLocalText = false;
        pendingUpdates = [];

        if (receivedServerState && readDocumentText(document) !== lastServerText) {
          replaceText(lastServerText, false);
        }
      }

      ready = true;
      retryAttempt = 0;
      update({
        status: "connected",
        role,
        readOnly,
        lastError: null,
      });
      startHeartbeat();
      flushPending();
      return;
    }

    if (message.type === "error" && typeof message.code === "string") {
      update({ lastError: message.code });
    }
  }

  function scheduleReconnect(): void {
    if (!started || !enabled || cancelRetry !== null) {
      return;
    }

    if (!isOnline()) {
      update({ status: "offline", participants: [] });
      return;
    }

    const delay = nextRetryDelay(retryAttempt, options.backoff);
    retryAttempt += 1;
    update({ status: "reconnecting" });
    cancelRetry = schedule(() => {
      cancelRetry = null;

      if (started && enabled && isOnline()) {
        connect();
      }
    }, delay);
  }

  function handleClose(closed: CollaborationSocket): void {
    if (socket !== closed) {
      return;
    }

    socket = null;
    ready = false;
    stopHeartbeat();

    if (!started) {
      update({ status: "disabled", participants: [] });
      return;
    }

    update({ participants: [] });
    scheduleReconnect();
  }

  function connect(): void {
    if (!started || !enabled) {
      return;
    }

    if (!isOnline()) {
      update({ status: "offline" });
      return;
    }

    cancelRetry?.();
    cancelRetry = null;
    ready = false;
    stopHeartbeat();

    let next: CollaborationSocket;

    try {
      next = createSocket(buildCollaborationUrl(baseUrl, noteId));
    } catch {
      update({ status: "error", lastError: "connection_failed" });
      scheduleReconnect();
      return;
    }

    socket = next;
    update({
      status: retryAttempt === 0 ? "connecting" : "reconnecting",
      lastError: null,
    });

    next.addEventListener("open", () => {
      if (socket === next && started) {
        update({ status: "connecting" });
      }
    });
    next.addEventListener("message", (event) => {
      if (socket === next && started) {
        handleMessage(event);
      }
    });
    next.addEventListener("close", () => {
      handleClose(next);
    });
    next.addEventListener("error", () => {
      if (socket === next) {
        update({ status: "error", lastError: "connection_error" });
      }
    });
  }

  function stopProvider(): void {
    started = false;
    cancelRetry?.();
    cancelRetry = null;
    unsubscribeConnection?.();
    unsubscribeConnection = null;
    stopHeartbeat();
    ready = false;

    const active = socket;
    socket = null;

    if (active !== null) {
      active.close(1000, "Collaboration stopped.");
    }

    update({
      status: "disabled",
      participants: [],
      role: null,
      readOnly: false,
      lastError: null,
    });
  }

  return {
    start() {
      if (started) {
        return;
      }

      started = true;
      retryAttempt = 0;

      if (!enabled) {
        update({ status: "disabled" });
        return;
      }

      unsubscribeConnection = subscribeToConnection(() => {
        if (!started) {
          return;
        }

        if (isOnline()) {
          retryAttempt = 0;
          cancelRetry?.();
          cancelRetry = null;
          connect();
        } else {
          cancelRetry?.();
          cancelRetry = null;
          update({ status: "offline", participants: [] });
          ready = false;
          stopHeartbeat();

          const active = socket;
          socket = null;

          if (active !== null) {
            active.close(1000, "Offline.");
          }
        }
      });

      connect();
    },

    stop: stopProvider,

    destroy() {
      stopProvider();
      document.off("update", onDocumentUpdate);
      document.destroy();
    },

    getSnapshot() {
      return snapshot;
    },

    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },

    getText() {
      if (!receivedServerState && hasPendingLocalText) {
        return pendingLocalText ?? "";
      }

      return readDocumentText(document);
    },

    setText(text) {
      if (!enabled || snapshot.readOnly) {
        return false;
      }

      if (!receivedServerState) {
        pendingLocalText = text;
        hasPendingLocalText = true;
        return true;
      }

      replaceText(text, true);

      return true;
    },
  };
}
