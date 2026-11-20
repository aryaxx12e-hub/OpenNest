import { describe, expect, it, vi } from "vitest";

import {
  applyDocumentUpdate,
  createCollaborationDocument,
  encodeDocumentState,
  readDocumentText,
} from "@opennest/collaboration";

import {
  buildCollaborationUrl,
  createCollaborationProvider,
  readBrowserCollaborationConfig,
  type CollaborationMessageEvent,
  type CollaborationSocket,
} from "../provider";

class FakeSocket implements CollaborationSocket {
  readyState = 0;
  binaryType = "arraybuffer";
  readonly sent: Array<string | Uint8Array> = [];
  readonly url: string;
  private readonly listeners = new Map<
    string,
    Array<(event: CollaborationMessageEvent) => void>
  >();

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(
    type: string,
    listener: (event: CollaborationMessageEvent) => void
  ): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === 3) {
      return;
    }

    this.readyState = 3;
    this.emit("close", { code, reason });
  }

  open(): void {
    this.readyState = 1;
    this.emit("open", {});
  }

  receiveText(message: unknown): void {
    this.emit("message", { data: JSON.stringify(message) });
  }

  receiveBinary(data: Uint8Array): void {
    this.emit("message", { data });
  }

  private emit(type: string, event: CollaborationMessageEvent): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

interface Scheduled {
  callback: () => void;
  delay: number;
}

function stateOf(text: string): Uint8Array {
  return encodeDocumentState(createCollaborationDocument(text));
}

function presenceOf(names: string[]) {
  return {
    type: "presence",
    participants: names.map((name, index) => ({
      connectionId: `connection-${index}`,
      userId: `user-${index}`,
      displayName: name,
      color: "#2563eb",
      joinedAt: "2026-11-19T00:00:00.000Z",
      lastSeenAt: "2026-11-19T00:00:00.000Z",
    })),
  };
}

function setup(
  overrides: Partial<Parameters<typeof createCollaborationProvider>[0]> = {}
) {
  const sockets: FakeSocket[] = [];
  const scheduled: Scheduled[] = [];
  const onlineListeners = new Set<() => void>();
  let online = true;

  const provider = createCollaborationProvider({
    noteId: "note-1",
    shared: true,
    url: "https://example.test",
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    isOnline: () => online,
    subscribeToConnection: (listener) => {
      onlineListeners.add(listener);

      return () => onlineListeners.delete(listener);
    },
    schedule: (callback, delay) => {
      const entry = { callback, delay };
      scheduled.push(entry);

      return () => {
        const index = scheduled.indexOf(entry);

        if (index >= 0) {
          scheduled.splice(index, 1);
        }
      };
    },
    backoff: { baseMs: 100, maxMs: 400, jitterRatio: 0, random: () => 0.5 },
    heartbeatMs: 0,
    ...overrides,
  });

  return {
    provider,
    sockets,
    scheduled,
    setOnline(value: boolean) {
      online = value;
    },
    notifyOnline() {
      for (const listener of onlineListeners) {
        listener();
      }
    },
    runNext() {
      const next = scheduled.shift();

      if (next === undefined) {
        throw new Error("No reconnect was scheduled.");
      }

      next.callback();
    },
  };
}

describe("collaboration provider", () => {
  it("connects only when a note is open and the workspace is shared", () => {
    const localOnly = setup({ shared: false });
    localOnly.provider.start();

    expect(localOnly.sockets).toHaveLength(0);
    expect(localOnly.provider.getSnapshot().status).toBe("disabled");

    const noNote = setup({ noteId: "" });
    noNote.provider.start();

    expect(noNote.sockets).toHaveLength(0);
    expect(noNote.provider.getSnapshot().status).toBe("disabled");

    const shared = setup();
    shared.provider.start();

    expect(shared.sockets).toHaveLength(1);
    expect(shared.sockets[0]?.url).toBe(
      "wss://example.test/api/collaboration?noteId=note-1"
    );
  });

  it("keeps reconnect backoff bounded", () => {
    const fixture = setup({ backoff: { baseMs: 100, maxMs: 400, jitterRatio: 0 } });
    fixture.provider.start();

    const delays: number[] = [];

    for (let attempt = 0; attempt < 4; attempt += 1) {
      fixture.sockets.at(-1)?.open();
      fixture.sockets.at(-1)?.close(1006, "lost");
      delays.push(fixture.scheduled.at(-1)?.delay ?? 0);
      fixture.runNext();
    }

    expect(delays).toEqual([100, 200, 400, 400]);
    expect(Math.max(...delays)).toBeLessThanOrEqual(400);
  });

  it("honours read-only viewer state", () => {
    const fixture = setup();
    fixture.provider.start();
    const socket = fixture.sockets[0]!;
    socket.open();
    socket.receiveBinary(stateOf("Remote text"));
    socket.receiveText({ type: "ready", role: "viewer", readOnly: true });

    expect(fixture.provider.getSnapshot()).toMatchObject({
      status: "connected",
      role: "viewer",
      readOnly: true,
    });
    expect(fixture.provider.getText()).toBe("Remote text");
    expect(fixture.provider.setText("Local write")).toBe(false);
    expect(fixture.provider.getText()).toBe("Remote text");
    expect(
      socket.sent.filter(
        (message): message is Uint8Array => message instanceof Uint8Array
      )
    ).toHaveLength(0);
  });

  it("keeps local text when the connection drops and sends it on reconnect", () => {
    const fixture = setup();
    const serverDocument = createCollaborationDocument("Hello");
    const serverState = encodeDocumentState(serverDocument);
    fixture.provider.start();
    const first = fixture.sockets[0]!;
    first.open();
    first.receiveBinary(serverState);
    first.receiveText({ type: "ready", role: "editor", readOnly: false });

    expect(fixture.provider.getText()).toBe("Hello");
    first.close(1006, "lost");

    expect(fixture.provider.setText("Draft while offline")).toBe(true);
    expect(fixture.provider.getText()).toBe("Draft while offline");

    fixture.runNext();
    const second = fixture.sockets.at(-1)!;
    second.open();
    second.receiveBinary(serverState);
    second.receiveText({ type: "ready", role: "editor", readOnly: false });

    const updates = second.sent.filter(
      (message): message is Uint8Array => message instanceof Uint8Array
    );
    expect(updates.length).toBeGreaterThan(0);
    expect(fixture.provider.getText()).toBe("Draft while offline");

    const server = createCollaborationDocument();
    applyDocumentUpdate(server, serverState);

    for (const update of updates) {
      applyDocumentUpdate(server, update);
    }

    expect(readDocumentText(server)).toBe("Draft while offline");
  });

  it("seeds initial local text only when the server note is empty", () => {
    const fixture = setup({ initialText: "Local note" });
    fixture.provider.start();
    const socket = fixture.sockets[0]!;
    socket.open();
    socket.receiveBinary(stateOf(""));
    socket.receiveText({ type: "ready", role: "editor", readOnly: false });

    expect(fixture.provider.getText()).toBe("Local note");

    const server = createCollaborationDocument();

    for (const message of socket.sent) {
      if (message instanceof Uint8Array) {
        applyDocumentUpdate(server, message);
      }
    }

    expect(readDocumentText(server)).toBe("Local note");

    const remote = setup({ initialText: "Local note" });
    remote.provider.start();
    const remoteSocket = remote.sockets[0]!;
    remoteSocket.open();
    remoteSocket.receiveBinary(stateOf("Remote note"));
    remoteSocket.receiveText({ type: "ready", role: "editor", readOnly: false });

    expect(remote.provider.getText()).toBe("Remote note");
  });

  it("prefers text typed before the first server state", () => {
    const onTextChange = vi.fn();
    const fixture = setup({ onTextChange });
    fixture.provider.start();
    const socket = fixture.sockets[0]!;
    socket.open();
    expect(fixture.provider.setText("Typed while connecting")).toBe(true);
    socket.receiveBinary(stateOf("Remote text"));
    socket.receiveText({ type: "ready", role: "editor", readOnly: false });

    expect(fixture.provider.getText()).toBe("Typed while connecting");
    expect(onTextChange).not.toHaveBeenCalledWith("Remote text", "remote");
    expect(onTextChange).toHaveBeenCalledWith("Typed while connecting", "local");
  });

  it("drops pre-ready text when the server reports a viewer", () => {
    const fixture = setup();
    fixture.provider.start();
    const socket = fixture.sockets[0]!;
    socket.open();
    expect(fixture.provider.setText("Viewer typed early")).toBe(true);
    socket.receiveBinary(stateOf("Remote text"));
    socket.receiveText({ type: "ready", role: "viewer", readOnly: true });

    expect(fixture.provider.getText()).toBe("Remote text");
    expect(fixture.provider.setText("Still read-only")).toBe(false);
    expect(
      socket.sent.filter(
        (message): message is Uint8Array => message instanceof Uint8Array
      )
    ).toHaveLength(0);
  });

  it("updates presence and clears members on disconnect", () => {
    const fixture = setup();
    fixture.provider.start();
    const socket = fixture.sockets[0]!;
    socket.open();
    socket.receiveText(presenceOf(["Ada", "Budi"]));

    expect(
      fixture.provider.getSnapshot().participants.map((item) => item.displayName)
    ).toEqual(["Ada", "Budi"]);

    socket.receiveText(presenceOf(["Ada"]));
    expect(fixture.provider.getSnapshot().participants).toHaveLength(1);
    expect(fixture.provider.getSnapshot().participants[0]?.displayName).toBe("Ada");

    socket.close(1006, "lost");
    expect(fixture.provider.getSnapshot().participants).toHaveLength(0);
  });

  it("reports offline status and reconnects when the network returns", () => {
    const fixture = setup();
    fixture.provider.start();
    expect(fixture.provider.getSnapshot().status).toBe("connecting");

    fixture.setOnline(false);
    fixture.notifyOnline();
    expect(fixture.provider.getSnapshot().status).toBe("offline");

    fixture.setOnline(true);
    fixture.notifyOnline();
    expect(fixture.sockets).toHaveLength(2);
    expect(fixture.provider.getSnapshot().status).toBe("connecting");
  });
});

describe("collaboration configuration", () => {
  it("builds websocket URLs for the collaboration endpoint", () => {
    expect(buildCollaborationUrl("https://example.test", "note-1")).toBe(
      "wss://example.test/api/collaboration?noteId=note-1"
    );
    expect(buildCollaborationUrl("wss://example.test/prefix", "note 2")).toBe(
      "wss://example.test/prefix/api/collaboration?noteId=note+2"
    );
  });

  it("never enables collaboration without an explicit shared workspace", () => {
    expect(readBrowserCollaborationConfig(undefined, "true")).toBeNull();
    expect(readBrowserCollaborationConfig("https://example.test", "false")).toBeNull();
    expect(readBrowserCollaborationConfig("https://example.test", "true")).toEqual({
      shared: true,
      url: "https://example.test",
    });
  });
});

describe("collaboration text events", () => {
  it("does not notify when text is unchanged", () => {
    const onTextChange = vi.fn();
    const fixture = setup({ onTextChange });
    fixture.provider.start();
    const socket = fixture.sockets[0]!;
    socket.open();
    socket.receiveBinary(stateOf("Same"));
    socket.receiveText({ type: "ready", role: "editor", readOnly: false });

    expect(onTextChange).toHaveBeenCalledWith("Same", "remote");
    onTextChange.mockClear();
    fixture.provider.setText("Same");

    expect(onTextChange).not.toHaveBeenCalled();
    expect(fixture.provider.setText("Changed")).toBe(true);
    expect(onTextChange).toHaveBeenCalledWith("Changed", "local");
  });
});
