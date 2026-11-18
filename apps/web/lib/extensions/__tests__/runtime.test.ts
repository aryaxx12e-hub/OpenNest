import { describe, expect, it } from "vitest";

import { createMemoryStorage, type IsoDate, type Workspace } from "@opennest/core";
import {
  createExtensionPackage,
  createMemoryExtensionStore,
  type ExtensionHostMessage,
  type ExtensionManifest,
  type ExtensionStore,
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
import { createExtensionRuntime, type ExtensionRuntime } from "../runtime";
import type { ExtensionTransport } from "../transport";

const NOW = Date.parse("2026-11-18T08:00:00.000Z");
const AT = "2026-11-18T08:00:00.000Z" as IsoDate;
const EXTENSION_ID = "com.example.demo";
const BLOB_KEY = "33333333-3333-4333-8333-333333333333";

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
  closed = 0;

  async open(): Promise<void> {
    return undefined;
  }

  send(message: ExtensionHostMessage): void {
    this.sent.push(message);
  }

  async close(): Promise<void> {
    this.closed += 1;
  }
}

interface Fixture {
  runtime: ExtensionRuntime;
  store: ExtensionStore;
  workspace: Workspace;
  services: AppServices;
  grants: GrantRegistry;
  audit: AuditLog;
  transports: FakeTransport[];
  record: StoredExtension;
}

async function makeRecord(enabled = true): Promise<StoredExtension> {
  const pkg = await createExtensionPackage({
    manifest: MANIFEST,
    code: "opennest.ready();",
  });

  return {
    id: EXTENSION_ID,
    manifest: MANIFEST,
    code: "opennest.ready();",
    integrity: pkg.integrity,
    installedAt: NOW,
    updatedAt: NOW,
    enabled,
  };
}

async function setup(options?: { enabled?: boolean }): Promise<Fixture> {
  const storage = createMemoryStorage();
  const created = await createAppServices(storage, {
    defaultWorkspaceName: "My Library",
    clock: () => AT,
    generateBlobKey: () => BLOB_KEY,
  });
  const store = createMemoryExtensionStore();
  const record = await makeRecord(options?.enabled ?? true);
  await store.extensions.put(record);
  const privacyStore = createMemoryPrivacyStore();
  let generated = 0;
  const generateId = () => `id-${++generated}`;
  const grants = createGrantRegistry({
    store: privacyStore.grants,
    now: () => NOW,
    generateId,
  });
  const audit = createAuditLog({
    store: privacyStore.audit,
    now: () => NOW,
    generateId,
  });
  const transports: FakeTransport[] = [];
  const runtime = createExtensionRuntime({
    privacy: { grants, audit },
    services: created.services,
    store,
    workspace: created.workspace,
    hostVersion: "0.1.0",
    now: () => NOW,
    generateId,
    transportFactory: () => {
      const transport = new FakeTransport();
      transports.push(transport);

      return transport;
    },
  });

  return {
    runtime,
    store,
    workspace: created.workspace,
    services: created.services,
    grants,
    audit,
    transports,
    record,
  };
}

describe("extension runtime", () => {
  it("refuses to start in safe mode", async () => {
    const fixture = await setup();
    await fixture.runtime.setSafeMode(true);

    await expect(fixture.runtime.start(EXTENSION_ID)).rejects.toMatchObject({
      code: "safe_mode",
    });
    await expect(fixture.runtime.getSafeMode()).resolves.toBe(true);
  });

  it("refuses to start a disabled extension", async () => {
    const fixture = await setup({ enabled: false });

    await expect(fixture.runtime.start(EXTENSION_ID)).rejects.toMatchObject({
      code: "extension_disabled",
    });
  });

  it("keeps one active session and stops the previous one", async () => {
    const fixture = await setup();

    const first = await fixture.runtime.start(EXTENSION_ID);
    expect(fixture.runtime.getActive()).toBe(first);

    const second = await fixture.runtime.start(EXTENSION_ID);

    expect(fixture.runtime.getActive()).toBe(second);
    expect(first.status).toBe("stopped");
    expect(fixture.transports[0]?.closed).toBe(1);
    expect(fixture.transports[1]?.closed).toBe(0);

    await fixture.runtime.stop(EXTENSION_ID);
    expect(fixture.runtime.getActive()).toBeNull();
    expect(second.status).toBe("stopped");
  });

  it("stops the active session when disabled or when safe mode turns on", async () => {
    const fixture = await setup();
    const first = await fixture.runtime.start(EXTENSION_ID);

    await fixture.runtime.setEnabled(EXTENSION_ID, false);

    expect(first.status).toBe("stopped");
    expect(fixture.runtime.getActive()).toBeNull();
    await expect(fixture.runtime.start(EXTENSION_ID)).rejects.toMatchObject({
      code: "extension_disabled",
    });

    await fixture.runtime.setEnabled(EXTENSION_ID, true);
    const second = await fixture.runtime.start(EXTENSION_ID);

    await fixture.runtime.setSafeMode(true);

    expect(second.status).toBe("stopped");
    expect(fixture.runtime.getActive()).toBeNull();
  });

  it("stops the session and removes storage on uninstall", async () => {
    const fixture = await setup();
    await fixture.store.storage.set(EXTENSION_ID, "count", "1");
    const session = await fixture.runtime.start(EXTENSION_ID);

    await fixture.runtime.uninstall(EXTENSION_ID);

    expect(session.status).toBe("stopped");
    expect(fixture.runtime.getActive()).toBeNull();
    expect(await fixture.store.extensions.get(EXTENSION_ID)).toBeNull();
    expect(await fixture.store.storage.get(EXTENSION_ID, "count")).toBeNull();
  });

  it("disposes idempotently and rejects new sessions", async () => {
    const fixture = await setup();
    const session = await fixture.runtime.start(EXTENSION_ID);

    await fixture.runtime.dispose();
    await fixture.runtime.dispose();

    expect(session.status).toBe("stopped");
    await expect(fixture.runtime.start(EXTENSION_ID)).rejects.toMatchObject({
      code: "runtime_disposed",
    });
  });
});
