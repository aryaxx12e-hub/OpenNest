export const CRYPTO_CHANNEL_NAME = "opennest:crypto";

export type TabCoordinatorEvent = { type: "lock" } | { type: "reset" };

export interface TabCoordinator {
  subscribe(listener: (event: TabCoordinatorEvent) => void): () => void;
  notifyLock(): void;
  notifyReset(): void;
  close(): void;
}

export interface CreateTabCoordinatorOptions {
  createChannel?: (name: string) => BroadcastChannel | null;
}

function parseEvent(value: unknown): TabCoordinatorEvent | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const type = (value as Record<string, unknown>).type;

  return type === "lock" || type === "reset" ? { type } : null;
}

export function createTabCoordinator(
  options: CreateTabCoordinatorOptions = {}
): TabCoordinator {
  const listeners = new Set<(event: TabCoordinatorEvent) => void>();
  let channel: BroadcastChannel | null = null;

  if (options.createChannel !== undefined) {
    try {
      channel = options.createChannel(CRYPTO_CHANNEL_NAME);
    } catch {
      channel = null;
    }
  } else if (typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel(CRYPTO_CHANNEL_NAME);
    } catch {
      channel = null;
    }
  }

  const onMessage = (event: MessageEvent<unknown>) => {
    const parsed = parseEvent(event.data);

    if (parsed === null) {
      return;
    }

    for (const listener of listeners) {
      listener(parsed);
    }
  };

  channel?.addEventListener("message", onMessage);

  function post(event: TabCoordinatorEvent): void {
    if (channel === null) {
      return;
    }

    try {
      channel.postMessage(event);
    } catch {
      return;
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    notifyLock() {
      post({ type: "lock" });
    },
    notifyReset() {
      post({ type: "reset" });
    },
    close() {
      listeners.clear();
      channel?.removeEventListener("message", onMessage);

      try {
        channel?.close();
      } catch {
        return;
      }
    },
  };
}
