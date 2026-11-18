import { describe, expect, it } from "vitest";

import type { ExtensionManifest } from "../manifest";
import { createMemoryExtensionStore } from "../memory-store";
import { createExtensionPackage } from "../package";
import {
  createExtensionRegistry,
  type ExtensionAudit,
  type ExtensionAuditRecord,
} from "../registry";

const CODE = "opennest.register(() => ({}));";

function manifest(overrides: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    id: "com.example.demo",
    name: "Demo extension",
    version: "1.0.0",
    publisher: "Example",
    description: "A small test extension.",
    tier: 1,
    entry: "main.js",
    capabilities: ["workspace.read.metadata"],
    dataScopes: ["notes"],
    networkOrigins: [],
    minHostVersion: "0.1.0",
    ...overrides,
  };
}

async function packageText(
  overrides: Partial<ExtensionManifest> = {},
  code = CODE
): Promise<string> {
  return JSON.stringify(
    await createExtensionPackage({ manifest: manifest(overrides), code })
  );
}

function setup() {
  const store = createMemoryExtensionStore();
  const events: string[] = [];
  const audit: ExtensionAudit = (record: ExtensionAuditRecord) => {
    events.push(record.event);
  };
  const registry = createExtensionRegistry({
    store,
    audit,
    now: () => 100,
    hostVersion: "0.1.0",
  });

  return { store, registry, events };
}

describe("extension registry lifecycle", () => {
  it("prepares and installs a fresh extension with consent", async () => {
    const { registry, events } = setup();
    const preview = await registry.prepareInstall(await packageText());

    expect(preview.action).toBe("install");
    expect(preview.requiredCapabilities).toEqual(["workspace.read.metadata"]);
    expect(preview.requiresConsent).toBe(true);
    expect(preview.manifest.version).toBe("1.0.0");

    const installed = await registry.install(preview, preview.requiredCapabilities);

    expect(installed.enabled).toBe(true);
    expect(installed.installedAt).toBe(100);
    expect(await registry.list()).toHaveLength(1);
    expect(events).toContain("extension.installed");
  });

  it("requires all requested capabilities before a fresh install", async () => {
    const { registry, store } = setup();
    const preview = await registry.prepareInstall(await packageText());

    await expect(registry.install(preview, [])).rejects.toMatchObject({
      code: "consent_required",
    });
    expect(await store.extensions.get("com.example.demo")).toBeNull();
  });

  it("prepares updates with only the newly requested capabilities", async () => {
    const { registry, events } = setup();
    const first = await registry.prepareInstall(await packageText());
    await registry.install(first, first.requiredCapabilities);

    const update = await registry.prepareInstall(
      await packageText({
        version: "2.0.0",
        capabilities: ["workspace.read.metadata", "workspace.read.content"],
      })
    );

    expect(update.action).toBe("update");
    expect(update.requiresConsent).toBe(true);
    expect(update.requiredCapabilities).toEqual(["workspace.read.content"]);

    await expect(
      registry.install(update, ["workspace.read.metadata"])
    ).rejects.toMatchObject({ code: "consent_required" });

    const installed = await registry.install(update, ["workspace.read.content"]);

    expect(installed.manifest.version).toBe("2.0.0");
    expect(installed.enabled).toBe(true);
    expect(events).toContain("extension.updated");
  });

  it("rejects downgrades, publisher changes, and version conflicts", async () => {
    const { registry } = setup();
    const first = await registry.prepareInstall(await packageText({ version: "2.0.0" }));
    await registry.install(first, first.requiredCapabilities);

    await expect(
      registry.prepareInstall(await packageText({ version: "1.0.0" }))
    ).rejects.toMatchObject({ code: "version_downgrade" });
    await expect(
      registry.prepareInstall(await packageText({ version: "3.0.0", publisher: "Other" }))
    ).rejects.toMatchObject({ code: "publisher_mismatch" });
    await expect(
      registry.prepareInstall(await packageText({ version: "2.0.0" }, "other code"))
    ).rejects.toMatchObject({ code: "version_conflict" });
    await expect(
      registry.prepareInstall(await packageText({ version: "2.0.0" }))
    ).rejects.toMatchObject({ code: "already_installed" });
  });

  it("rejects packages that require a newer host", async () => {
    const { registry } = setup();

    await expect(
      registry.prepareInstall(
        await packageText({ id: "com.example.future", minHostVersion: "9.0.0" })
      )
    ).rejects.toMatchObject({ code: "host_version_unsupported" });
  });

  it("preserves storage on disable and removes it on uninstall", async () => {
    const { registry, store, events } = setup();
    const preview = await registry.prepareInstall(await packageText());
    await registry.install(preview, preview.requiredCapabilities);
    await store.storage.set("com.example.demo", "count", "1");

    await registry.setEnabled("com.example.demo", false);

    expect((await registry.get("com.example.demo"))?.enabled).toBe(false);
    expect(await store.storage.keys("com.example.demo")).toEqual(["count"]);
    expect(events).toContain("extension.disabled");

    await registry.setEnabled("com.example.demo", true);
    expect((await registry.get("com.example.demo"))?.enabled).toBe(true);
    expect(events).toContain("extension.enabled");

    await registry.uninstall("com.example.demo");

    expect(await registry.get("com.example.demo")).toBeNull();
    expect(await store.storage.keys("com.example.demo")).toEqual([]);
    expect(events).toContain("extension.uninstalled");
  });

  it("audits integrity failures without writing the extension", async () => {
    const { registry, store, events } = setup();
    const preview = await registry.prepareInstall(await packageText());
    const tampered = {
      ...preview,
      package: { ...preview.package, files: { "main.js": "tampered" } },
    };

    await expect(
      registry.install(tampered, preview.requiredCapabilities)
    ).rejects.toMatchObject({ code: "integrity_mismatch" });

    expect(await store.extensions.get("com.example.demo")).toBeNull();
    expect(events).toContain("extension.integrity_failed");
  });

  it("persists and audits safe mode", async () => {
    const { registry, events } = setup();

    expect(await registry.getSafeMode()).toBe(false);
    await registry.setSafeMode(true);

    expect(await registry.getSafeMode()).toBe(true);
    expect(events).toContain("extension.safe_mode");
  });
});
