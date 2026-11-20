import type { AppServices } from "@/lib/data/services";
import type { Workspace } from "@opennest/core";
import {
  ExtensionError,
  createExtensionRegistry,
  type ExtensionRegistry,
  type ExtensionStore,
  type ExtensionUiNode,
  type StoredExtension,
} from "@opennest/extensions";

import type { ExtensionAiCapability } from "./ai-capability";

import {
  createExtensionSession,
  type ExtensionSession,
  type ExtensionSessionPrivacy,
  type ExtensionSessionStatusEvent,
} from "./session";
import type { ExtensionTransportFactory } from "./transport";

export interface ExtensionRuntimeHandlers {
  readonly onUi?: (tree: ExtensionUiNode) => void;
  readonly onStatus?: (event: ExtensionSessionStatusEvent) => void;
}

export interface CreateExtensionRuntimeInput {
  readonly privacy: ExtensionSessionPrivacy;
  readonly services: AppServices;
  readonly store: ExtensionStore;
  readonly workspace: Workspace;
  readonly hostVersion: string;
  readonly now: () => number;
  readonly generateId: () => string;
  readonly transportFactory: ExtensionTransportFactory;
  readonly ai?: ExtensionAiCapability | null;
}

export interface ExtensionRuntime {
  readonly registry: ExtensionRegistry;
  start(id: string, handlers?: ExtensionRuntimeHandlers): Promise<ExtensionSession>;
  stop(id?: string): Promise<void>;
  stopAll(): Promise<void>;
  action(actionId: string): Promise<void>;
  getActive(): ExtensionSession | null;
  setEnabled(id: string, enabled: boolean): Promise<StoredExtension>;
  uninstall(id: string): Promise<void>;
  setSafeMode(enabled: boolean): Promise<void>;
  getSafeMode(): Promise<boolean>;
  dispose(): Promise<void>;
}

export function createExtensionRuntime(
  input: CreateExtensionRuntimeInput
): ExtensionRuntime {
  const { privacy, services, store, workspace } = input;
  let active: ExtensionSession | null = null;
  let disposed = false;

  const registry = createExtensionRegistry({
    store,
    hostVersion: input.hostVersion,
    now: input.now,
    audit: async (record) => {
      await privacy.audit.append({
        event: record.event,
        outcome: record.outcome,
        principalId: record.principalId ?? null,
        reason: record.reason ?? null,
      });
    },
  });

  async function stopActive(reason: string): Promise<void> {
    const current = active;
    active = null;

    if (current !== null) {
      await current.stop(reason);
    }
  }

  return {
    registry,

    async start(id, handlers = {}) {
      if (disposed) {
        throw new ExtensionError(
          "runtime_disposed",
          "The extension runtime is disposed."
        );
      }

      if (await registry.getSafeMode()) {
        throw new ExtensionError("safe_mode", "Extensions are disabled by safe mode.");
      }

      const record = await registry.get(id);

      if (record === null) {
        throw new ExtensionError(
          "extension_not_found",
          "The extension is not installed."
        );
      }

      if (!record.enabled) {
        throw new ExtensionError(
          "extension_disabled",
          "The extension is disabled. Enable it before running."
        );
      }

      await stopActive("replaced");

      let session: ExtensionSession | null = null;
      const transport = input.transportFactory({
        onMessage: (message) => {
          void session?.handleWorkerMessage(message);
        },
        onFault: () => {
          void session?.stop("transport_fault");
        },
      });

      session = createExtensionSession({
        record,
        workspace,
        privacy,
        services,
        storage: store.storage,
        ai: input.ai ?? null,
        transport,
        onUi: handlers.onUi ?? (() => undefined),
        onStatus: (event) => {
          if (
            session !== null &&
            active === session &&
            (event.status === "stopped" || event.status === "error")
          ) {
            active = null;
          }

          handlers.onStatus?.(event);
        },
        now: input.now,
        generateId: input.generateId,
      });
      active = session;

      try {
        await session.start();
      } catch (error) {
        if (active === session) {
          active = null;
        }

        throw error;
      }

      return session;
    },

    async stop(id) {
      if (active === null) {
        return;
      }

      if (id !== undefined && active.extensionId !== id) {
        return;
      }

      await stopActive("stopped");
    },

    async stopAll() {
      await stopActive("stopped");
    },

    async action(actionId) {
      if (active === null) {
        throw new ExtensionError("session_expired", "No extension session is running.");
      }

      await active.action(actionId);
    },

    getActive() {
      return active;
    },

    async setEnabled(id, enabled) {
      const updated = await registry.setEnabled(id, enabled);

      if (!enabled && active?.extensionId === id) {
        await stopActive("disabled");
      }

      return updated;
    },

    async uninstall(id) {
      if (active?.extensionId === id) {
        await stopActive("uninstalled");
      }

      await registry.uninstall(id);
    },

    async setSafeMode(enabled) {
      if (enabled) {
        await stopActive("safe_mode");
      }

      await registry.setSafeMode(enabled);
    },

    getSafeMode() {
      return registry.getSafeMode();
    },

    async dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      await stopActive("disposed");
    },
  };
}
