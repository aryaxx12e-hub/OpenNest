import type { ExtensionHostMessage } from "@opennest/extensions";

import { shellReadySchema } from "./protocol";
import { buildExtensionSandboxDocument } from "./sandbox-document";
import type { ExtensionTransport, ExtensionTransportHandlers } from "./transport";

export const EXTENSION_FRAME_READY_TIMEOUT_MS = 10_000;

export interface FrameTransportInput extends ExtensionTransportHandlers {
  readonly container: HTMLElement;
  readonly origin: string;
}

export interface ShellMessageGuardInput {
  readonly source: unknown;
  readonly origin: string;
  readonly expectedSource: Window | null;
}

export function isTrustedShellMessage(input: ShellMessageGuardInput): boolean {
  return (
    input.expectedSource !== null &&
    input.source === input.expectedSource &&
    input.origin === "null"
  );
}

export function createFrameTransport(input: FrameTransportInput): ExtensionTransport {
  let iframe: HTMLIFrameElement | null = null;
  let channel: MessageChannel | null = null;
  let port: MessagePort | null = null;
  let listener: ((event: MessageEvent<unknown>) => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let openPromise: Promise<void> | null = null;
  let rejectOpen: ((error: unknown) => void) | null = null;
  let state: "idle" | "opening" | "open" | "closed" = "idle";

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function cleanup(): void {
    clearTimer();

    if (listener !== null) {
      window.removeEventListener("message", listener);
      listener = null;
    }

    if (port !== null) {
      port.onmessage = null;
      port.onmessageerror = null;

      try {
        port.close();
      } catch {
        // The port may already be closed or transferred.
      }

      port = null;
    }

    channel = null;

    if (iframe !== null) {
      iframe.remove();
      iframe = null;
    }
  }

  function fail(error: unknown, notify: boolean): void {
    if (state === "closed") {
      return;
    }

    state = "closed";
    cleanup();
    const reject = rejectOpen;
    rejectOpen = null;
    reject?.(error);

    if (notify) {
      input.onFault(error);
    }
  }

  function isCurrentShell(event: MessageEvent<unknown>): boolean {
    return (
      iframe !== null &&
      isTrustedShellMessage({
        source: event.source,
        origin: event.origin,
        expectedSource: iframe.contentWindow,
      })
    );
  }

  async function open(): Promise<void> {
    if (state === "closed") {
      throw new Error("The extension frame is closed.");
    }

    if (state === "open") {
      return;
    }

    if (openPromise !== null) {
      return openPromise;
    }

    const sandboxDocument = buildExtensionSandboxDocument(input.origin);
    channel = new MessageChannel();
    const nextChannel = channel;
    const nextPort = nextChannel.port1;
    port = nextPort;
    state = "opening";

    openPromise = new Promise<void>((resolve, reject) => {
      rejectOpen = reject;

      const nextIframe = document.createElement("iframe");
      iframe = nextIframe;
      nextIframe.width = "1";
      nextIframe.height = "1";
      nextIframe.tabIndex = -1;
      nextIframe.setAttribute("aria-hidden", "true");
      nextIframe.setAttribute("sandbox", "allow-scripts");
      nextIframe.style.position = "fixed";
      nextIframe.style.left = "-10000px";
      nextIframe.style.top = "0";
      nextIframe.style.width = "1px";
      nextIframe.style.height = "1px";
      nextIframe.style.border = "0";
      nextIframe.style.opacity = "0";
      nextIframe.style.pointerEvents = "none";

      nextPort.onmessage = (event) => {
        if (state === "open") {
          input.onMessage(event.data);
        }
      };
      nextPort.onmessageerror = () => {
        fail(new Error("The extension frame sent an unreadable message."), true);
      };

      listener = (event) => {
        if (state !== "opening" || !isCurrentShell(event)) {
          return;
        }

        if (!shellReadySchema.safeParse(event.data).success) {
          return;
        }

        clearTimer();
        const target = iframe?.contentWindow;

        if (target === null || target === undefined) {
          fail(new Error("The extension frame is not available."), true);
          return;
        }

        target.postMessage({ type: "opennest:init", hostOrigin: input.origin }, "*", [
          nextChannel.port2,
        ]);
        nextPort.start();
        state = "open";
        rejectOpen = null;
        resolve();
      };

      window.addEventListener("message", listener);
      nextIframe.srcdoc = sandboxDocument;
      input.container.append(nextIframe);

      timer = setTimeout(() => {
        if (state === "opening") {
          fail(new Error("The extension frame did not become ready."), false);
        }
      }, EXTENSION_FRAME_READY_TIMEOUT_MS);
    });

    return openPromise;
  }

  function send(message: ExtensionHostMessage): void {
    if (state !== "open" || port === null) {
      throw new Error("The extension frame is not open.");
    }

    port.postMessage(message);
  }

  function close(): void {
    if (state === "closed") {
      return;
    }

    state = "closed";
    cleanup();
    const reject = rejectOpen;
    rejectOpen = null;
    reject?.(new Error("The extension frame was closed."));
    openPromise = null;
  }

  return { open, send, close };
}
