import type { ExtensionHostMessage } from "@opennest/extensions";

export interface ExtensionTransport {
  open(): Promise<void>;
  send(message: ExtensionHostMessage): Promise<void> | void;
  close(): Promise<void> | void;
}

export interface ExtensionTransportHandlers {
  readonly onMessage: (message: unknown) => void;
  readonly onFault: (error: unknown) => void;
}

export type ExtensionTransportFactory = (
  handlers: ExtensionTransportHandlers
) => ExtensionTransport;
