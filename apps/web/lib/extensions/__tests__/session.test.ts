import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryStorage, type IsoDate, type Workspace } from "@opennest/core";
import {
  createExtensionPackage,
  type ExtensionHostMessage,
  type ExtensionManifest,
  type StoredExtension,
} from "@opennest/extensions";
import {
  createAuditLog,
  createGrantRegistry,
  createMemoryPrivacyStore,
  type AuditLog,
  type GrantRegistry,
} from "@opennest/privacy";

import { createAppServices, type AppServices } from "@/lib/data/services";
import {
  createExtensionSession,
  EXTENSION_MAX_UI_UPDATES_PER_MINUTE,
  type ExtensionSessionStatusEvent,
} from "../session";
import type { ExtensionTransport } from "../transport";

const NOW = Date.parse("2026-11-18T08:00:00.000Z");
const AT = "2026-11-18T08:00:00.000Z" as IsoDate;
const EXTENSION_ID = "com.example.demo";
const PRINCIPAL_ID = `extension:${EXTENSION_ID}`;
const BLOB_KEY = "22222222-2222-4222-8222-222222222222";

const MANIFEST: ExtensionManifest = {
  id: EXTENSION_ID,
  name: "Demo extension",
  version: "1.0.0",
  publisher: "Example",
  description: "A demo extension.",
  tier: 1,
  entry: "index.js",
  capabilities: ["workspace.read.metadata"],
  dataScopes: ["notes", "files", "folders", "tags"],
  networkOrigins: [],
  minHostVersion: "0.1.0",
};

class FakeTransport implements ExtensionTransport {
  readonly sent: ExtensionHostMessage[] = [];
  opened = 0;
  closed = 0;

  async open(): Promise<void> {
    this.opened += 1;
  }

  send(message: ExtensionHostMessage): void {
    this.sent.push(message);
  }

  async close(): Promise<void> {
    this.closed += 1;
  }
}

interface Fixture {
  record: StoredExtension;
  workspace: Workspace;
  services: AppServices;
  grants: GrantRegistry;
  audit: AuditLog;
  transport: FakeTransport;
}

async function makeRecord(
  manifest: ExtensionManifest = MANIFEST,
  code = "opennest.ready();"
): Promise<StoredExtension> {
  const pkg = await createExtensionPackage({ manifest, code });

  return {
    id: manifest.id,
    manifest,
    code,
    integrity: pkg.integrity,
    installedAt: NOW,
    updatedAt: NOW,
    enabled: true,
  };
}

async function setup(options?: {
  record?: StoredExtension;
  services?: AppServices;
  clock?: { value: number };
}): Promise<Fixture> {
  const record = options?.record ?? (await makeRecord());
  const storage = createMemoryStorage();
  const created = await createAppServices(storage, {
    defaultWorkspaceName: "My Library",
    clock: () => AT,
    generateBlobKey: () => BLOB_KEY,
  });
  const privacyStore = createMemoryPrivacyStore();
  let generated = 0;
  const generateId = () => `id-${++generated}`;
  const grants = createGrantRegistry({
    store: privacyStore.grants,
    now: () => options?.clock?.value ?? NOW,
    generateId,
  });
  const audit = createAuditLog({
    store: privacyStore.audit,
    now: () => options?.clock?.value ?? NOW,
    generateId,
  });

  return {
    record,
    workspace: created.workspace,
    services: options?.services ?? created.services,
    grants,
    audit,
    transport: new FakeTransport(),
  };
}

function makeSession(
  fixture: Fixture,
  overrides?: {
    onUi?: (tree: unknown) => void;
    onStatus?: (event: ExtensionSessionStatusEvent) => void;
    clock?: { value: number };
  }
) {
  return createExtensionSession({
    record: fixture.record,
    workspace: fixture.workspace,
    privacy: { grants: fixture.grants, audit: fixture.audit },
    services: fixture.services,
    storage: {
      get: async () => null,
      set: async () => undefined,
      delete: async () => undefined,
      keys: async () => [],
      clear: async () => undefined,
      usage: async () => 0,
    },
    transport: fixture.transport,
    onUi: overrides?.onUi ?? (() => undefined),
    onStatus: overrides?.onStatus ?? (() => undefined),
    now: () => overrides?.clock?.value ?? NOW,
    generateId: () => "session-1",
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("extension session", () => {
  it("creates session grants, starts the transport, and answers host requests", async () => {
    const fixture = await setup();
    const statuses: ExtensionSessionStatusEvent[] = [];
    const session = makeSession(fixture, {
      onStatus: (event) => statuses.push(event),
    });

    await session.start();

    expect(fixture.transport.opened).toBe(1);
    expect(fixture.transport.sent).toContainEqual({
      type: "host:start",
      code: fixture.record.code,
    });
    expect(await fixture.grants.list()).toEqual([
      expect.objectContaining({
        principalId: PRINCIPAL_ID,
        capability: "workspace.read.metadata",
        sessionOnly: true,
        sessionId: "session-1",
      }),
    ]);

    await session.handleWorkerMessage({ type: "worker:ready" });

    expect(statuses.map((event) => event.status)).toEqual(["starting", "running"]);
    const audit = await fixture.audit.list();
    expect(audit.map((entry) => entry.event)).toContain("extension.started");

    const response = await session.handleWorkerMessage({
      type: "worker:request",
      id: "1",
      method: "workspace.summary",
      params: {},
    });

    expect(response).toMatchObject({ type: "worker:response", id: "1", ok: true });
    expect(fixture.transport.sent).toContainEqual(
      expect.objectContaining({ type: "worker:response", id: "1", ok: true })
    );
    expect(fixture.transport.sent).toContainEqual(
      expect.objectContaining({
        type: "worker:response",
        id: "1",
        ok: true,
        result: { notes: 0, files: 0, folders: 0, tags: 0 },
      })
    );

    await session.stop();

    expect(fixture.transport.closed).toBe(1);
    expect(await fixture.grants.list()).toEqual([]);
    expect((await fixture.audit.list()).map((entry) => entry.event)).toContain(
      "extension.terminated"
    );
  });

  it("rejects a host response that exceeds the message limit", async () => {
    const record = await makeRecord({
      ...MANIFEST,
      capabilities: ["workspace.read.content"],
    });
    const fixture = await setup({ record });
    const note = await fixture.services.note.create({
      workspaceId: fixture.workspace.id,
      folderId: null,
      title: "Large note",
      content: "x".repeat(70 * 1_024),
    });
    const session = makeSession(fixture);

    await session.start();
    await session.handleWorkerMessage({ type: "worker:ready" });

    const response = await session.handleWorkerMessage({
      type: "worker:request",
      id: "1",
      method: "workspace.readNote",
      params: { noteId: note.id },
    });

    expect(response).toMatchObject({
      type: "worker:response",
      id: "1",
      ok: false,
      error: { code: "response_too_large" },
    });
    expect(fixture.transport.sent).toContainEqual({
      type: "worker:response",
      id: "1",
      ok: false,
      error: {
        code: "response_too_large",
        message: "The host response exceeded the message size limit.",
      },
    });
  });

  it("allows only one request in flight", async () => {
    const storage = createMemoryStorage();
    const created = await createAppServices(storage, {
      defaultWorkspaceName: "My Library",
      clock: () => AT,
      generateBlobKey: () => BLOB_KEY,
    });
    let release: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const enteredGate = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const baseList = created.services.note.list.bind(created.services.note);
    const services: AppServices = {
      ...created.services,
      note: {
        ...created.services.note,
        list: async (...args) => {
          entered();
          await gate;

          return baseList(...args);
        },
      },
    };
    const fixture = await setup({ services });
    const session = makeSession(fixture);

    await session.start();
    await session.handleWorkerMessage({ type: "worker:ready" });

    const first = session.handleWorkerMessage({
      type: "worker:request",
      id: "1",
      method: "workspace.summary",
      params: {},
    });

    await enteredGate;

    const second = await session.handleWorkerMessage({
      type: "worker:request",
      id: "2",
      method: "workspace.summary",
      params: {},
    });

    expect(second).toMatchObject({
      type: "worker:response",
      id: "2",
      ok: false,
      error: { code: "busy" },
    });
    expect(fixture.transport.sent).toContainEqual(
      expect.objectContaining({ type: "worker:response", id: "2", ok: false })
    );

    release();
    await expect(first).resolves.toMatchObject({ ok: true });
  });

  it("validates UI trees and limits message size", async () => {
    const fixture = await setup();
    const onUi = vi.fn();
    const session = makeSession(fixture, { onUi });

    await session.start();

    const invalid = await session.handleWorkerMessage({
      type: "worker:ui",
      tree: { type: "html" } as never,
    });

    expect(invalid).toMatchObject({ ok: false, error: { code: "ui_invalid" } });
    expect(onUi).not.toHaveBeenCalled();

    await session.handleWorkerMessage({
      type: "worker:ui",
      tree: { type: "heading", text: "Summary" },
    });

    expect(onUi).toHaveBeenCalledWith({ type: "heading", text: "Summary" });

    await expect(
      session.handleWorkerMessage({
        type: "worker:ui",
        tree: { type: "text", text: "x".repeat(70 * 1_024) },
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "protocol_error" } });
  });

  it("rate limits UI updates without replacing the last surface", async () => {
    const fixture = await setup();
    const onUi = vi.fn();
    const session = makeSession(fixture, { onUi });

    await session.start();

    for (let index = 0; index < EXTENSION_MAX_UI_UPDATES_PER_MINUTE; index += 1) {
      await expect(
        session.handleWorkerMessage({
          type: "worker:ui",
          tree: { type: "text", text: `Update ${index}` },
        })
      ).resolves.toEqual({ ok: true });
    }

    await expect(
      session.handleWorkerMessage({
        type: "worker:ui",
        tree: { type: "text", text: "One update too many" },
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "rate_limited" } });
    expect(onUi).toHaveBeenCalledTimes(EXTENSION_MAX_UI_UPDATES_PER_MINUTE);
    expect(onUi).not.toHaveBeenCalledWith({
      type: "text",
      text: "One update too many",
    });
  });

  it("rejects a record whose code no longer matches its integrity", async () => {
    const valid = await makeRecord();
    const fixture = await setup({ record: { ...valid, code: "tampered();" } });
    const session = makeSession(fixture);

    await expect(session.start()).rejects.toMatchObject({ code: "integrity_mismatch" });

    expect(fixture.transport.opened).toBe(0);
    expect(await fixture.grants.list()).toEqual([]);
    expect((await fixture.audit.list()).map((entry) => entry.event)).toContain(
      "extension.integrity_failed"
    );
  });

  it("times out a hung host request", async () => {
    vi.useFakeTimers();
    const clock = { value: NOW };
    const storage = createMemoryStorage();
    const created = await createAppServices(storage, {
      defaultWorkspaceName: "My Library",
      clock: () => AT,
      generateBlobKey: () => BLOB_KEY,
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const baseList = created.services.note.list.bind(created.services.note);
    const services: AppServices = {
      ...created.services,
      note: {
        ...created.services.note,
        list: async (...args) => {
          await gate;

          return baseList(...args);
        },
      },
    };
    const fixture = await setup({ services, clock });
    const session = makeSession(fixture, { clock });

    await session.start();

    const pending = session.handleWorkerMessage({
      type: "worker:request",
      id: "1",
      method: "workspace.summary",
      params: {},
    });

    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { code: "timeout" },
    });

    release();
  });

  it("stops when worker heartbeats stop", async () => {
    vi.useFakeTimers();
    const clock = { value: NOW };
    const fixture = await setup({ clock });
    const statuses: ExtensionSessionStatusEvent[] = [];
    const session = makeSession(fixture, {
      clock,
      onStatus: (event) => statuses.push(event),
    });

    await session.start();
    await session.handleWorkerMessage({ type: "worker:ready" });

    clock.value = NOW + 6_000;
    await vi.advanceTimersByTimeAsync(1_000);

    expect(statuses.at(-1)).toMatchObject({
      status: "error",
      code: "timeout",
    });
    expect(fixture.transport.closed).toBe(1);
  });

  it("forwards host actions only while running", async () => {
    const fixture = await setup();
    const session = makeSession(fixture);

    await session.start();
    await session.handleWorkerMessage({ type: "worker:ready" });
    await session.action("refresh");

    expect(fixture.transport.sent).toContainEqual({
      type: "host:action",
      actionId: "refresh",
    });

    await session.stop();

    await expect(session.action("refresh")).rejects.toMatchObject({
      code: "session_expired",
    });
  });
});
