import { describe, expect, it, vi } from "vitest";

import {
  CRYPTO_CHANNEL_NAME,
  createTabCoordinator,
  type TabCoordinatorEvent,
} from "../tab-coordinator";

class FakeBroadcastChannel {
  messages: unknown[] = [];
  closed = false;
  private readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null
  ): void {
    if (type === "message" && typeof listener === "function") {
      this.listeners.add(listener as (event: MessageEvent<unknown>) => void);
    }
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null
  ): void {
    if (type === "message" && typeof listener === "function") {
      this.listeners.delete(listener as (event: MessageEvent<unknown>) => void);
    }
  }

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  close(): void {
    this.closed = true;
  }

  emit(data: unknown): void {
    for (const listener of this.listeners) {
      listener({ data } as MessageEvent<unknown>);
    }
  }
}

function createChannel(): FakeBroadcastChannel {
  return new FakeBroadcastChannel();
}

function asBroadcastChannel(channel: FakeBroadcastChannel): BroadcastChannel {
  return channel as unknown as BroadcastChannel;
}

describe("tab coordinator", () => {
  it("notifies listeners about lock and reset events and ignores malformed events", () => {
    const channel = createChannel();
    const coordinator = createTabCoordinator({
      createChannel: (name) => {
        expect(name).toBe(CRYPTO_CHANNEL_NAME);
        return asBroadcastChannel(channel);
      },
    });
    const events: TabCoordinatorEvent[] = [];
    const unsubscribe = coordinator.subscribe((event) => events.push(event));

    channel.emit({ type: "lock" });
    channel.emit({ type: "reset" });
    channel.emit({ type: "unknown" });
    channel.emit(null);

    expect(events).toEqual([{ type: "lock" }, { type: "reset" }]);

    coordinator.notifyLock();
    coordinator.notifyReset();

    expect(channel.messages).toEqual([{ type: "lock" }, { type: "reset" }]);

    unsubscribe();
    channel.emit({ type: "lock" });

    expect(events).toHaveLength(2);

    coordinator.close();

    expect(channel.closed).toBe(true);
  });

  it("does not throw when channels are unavailable or fail to open", () => {
    const unavailable = createTabCoordinator({ createChannel: () => null });
    const failing = createTabCoordinator({
      createChannel: () => {
        throw new Error("blocked");
      },
    });

    expect(() => {
      unavailable.notifyLock();
      unavailable.notifyReset();
      unavailable.close();
      failing.notifyLock();
      failing.notifyReset();
      failing.close();
    }).not.toThrow();
  });

  it("stops delivering events after close", () => {
    const channel = createChannel();
    const coordinator = createTabCoordinator({
      createChannel: () => asBroadcastChannel(channel),
    });
    const listener = vi.fn();

    coordinator.subscribe(listener);
    coordinator.close();
    channel.emit({ type: "lock" });

    expect(listener).not.toHaveBeenCalled();
  });
});
