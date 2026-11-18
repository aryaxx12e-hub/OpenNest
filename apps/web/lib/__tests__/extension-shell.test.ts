import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

interface FakePort {
  onmessage: ((event: { data: unknown }) => void) | null;
  close: () => void;
  postMessage: (message: unknown) => void;
  start: () => void;
}

interface FakeWorker {
  posted: unknown[];
  onerror: ((event: { preventDefault: () => void }) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onmessageerror: (() => void) | null;
  postMessage: (message: unknown) => void;
  terminate: () => void;
}

interface ShellMessageEvent {
  readonly source: unknown;
  readonly origin: string;
  readonly data: unknown;
  readonly ports: readonly FakePort[];
}

function createShell() {
  const source = readFileSync(
    path.join(process.cwd(), "apps/web/public/extension-sandbox.js"),
    "utf8"
  );
  const listeners = new Map<string, (event: ShellMessageEvent) => void>();
  const workers: FakeWorker[] = [];
  const ready: unknown[] = [];
  const parent = {
    postMessage(message: unknown) {
      ready.push(message);
    },
  };
  const port: FakePort = {
    onmessage: null,
    close: vi.fn(),
    postMessage: vi.fn(),
    start: vi.fn(),
  };

  class WorkerMock implements FakeWorker {
    onerror: FakeWorker["onerror"] = null;
    onmessage: FakeWorker["onmessage"] = null;
    onmessageerror: FakeWorker["onmessageerror"] = null;
    readonly posted: unknown[] = [];

    constructor() {
      workers.push(this);
    }

    postMessage(message: unknown) {
      this.posted.push(message);
    }

    terminate() {}
  }

  runInNewContext(source, {
    Blob: class {
      constructor(readonly parts: string[]) {}
    },
    URL: {
      createObjectURL: () => "blob:shell",
      revokeObjectURL: () => undefined,
    },
    Worker: WorkerMock,
    TextEncoder,
    clearInterval: () => undefined,
    console,
    parent,
    setInterval: () => 1,
    window: {
      addEventListener(type: string, listener: (event: ShellMessageEvent) => void) {
        listeners.set(type, listener);
      },
    },
  });

  listeners.get("message")?.({
    source: parent,
    origin: "https://app.test",
    data: { type: "opennest:init", hostOrigin: "https://app.test" },
    ports: [port],
  });
  port.onmessage?.({ data: { type: "host:start", code: "opennest.ready();" } });

  return { port, ready, workers };
}

describe("extension sandbox shell", () => {
  it("forwards host responses to the extension worker", () => {
    const { port, workers } = createShell();
    const response = {
      type: "worker:response",
      id: "1",
      ok: true,
      result: { notes: 1 },
    };

    expect(workers).toHaveLength(1);
    port.onmessage?.({ data: response });
    expect(workers[0]?.posted).toContainEqual(response);
  });

  it("announces that the shell is ready before initialization", () => {
    const { ready } = createShell();

    expect(ready).toContainEqual({ type: "shell:ready" });
  });
});
