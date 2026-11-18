import { ExtensionError } from "./errors";
import type { ExtensionCapability, ExtensionManifest } from "./manifest";
import {
  parseExtensionPackage,
  verifyExtensionIntegrity,
  type ExtensionPackage,
  type VerifiedExtensionPackage,
} from "./package";
import type { ExtensionStore, StoredExtension } from "./store";
import { compareVersions } from "./version";

export type ExtensionAuditEvent =
  | "extension.installed"
  | "extension.updated"
  | "extension.enabled"
  | "extension.disabled"
  | "extension.uninstalled"
  | "extension.integrity_failed"
  | "extension.safe_mode";

export interface ExtensionAuditRecord {
  readonly event: ExtensionAuditEvent;
  readonly outcome: "allowed" | "denied" | "completed" | "info";
  readonly principalId?: string | null;
  readonly reason?: string | null;
}

export type ExtensionAudit = (record: ExtensionAuditRecord) => Promise<void> | void;

export interface InstallPreview {
  readonly action: "install" | "update";
  readonly package: ExtensionPackage;
  readonly manifest: ExtensionManifest;
  readonly requiredCapabilities: readonly ExtensionCapability[];
  readonly requiresConsent: boolean;
}

export interface CreateExtensionRegistryOptions {
  readonly store: ExtensionStore;
  readonly audit: ExtensionAudit;
  readonly now: () => number;
  readonly hostVersion: string;
}

export interface ExtensionRegistry {
  prepareInstall(text: string): Promise<InstallPreview>;
  install(
    preview: InstallPreview,
    acceptedCapabilities: readonly ExtensionCapability[]
  ): Promise<StoredExtension>;
  setEnabled(id: string, enabled: boolean): Promise<StoredExtension>;
  uninstall(id: string): Promise<void>;
  setSafeMode(enabled: boolean): Promise<void>;
  getSafeMode(): Promise<boolean>;
  list(): Promise<StoredExtension[]>;
  get(id: string): Promise<StoredExtension | null>;
}

function assertAccepted(
  required: readonly ExtensionCapability[],
  accepted: readonly ExtensionCapability[]
): void {
  const missing = required.filter((capability) => !accepted.includes(capability));

  if (missing.length > 0) {
    throw new ExtensionError(
      "consent_required",
      `The user must accept ${missing.join(", ")} before installing.`
    );
  }
}

function assertPublisher(existing: StoredExtension, manifest: ExtensionManifest): void {
  if (existing.manifest.publisher !== manifest.publisher) {
    throw new ExtensionError(
      "publisher_mismatch",
      "An update cannot change the extension publisher."
    );
  }
}

async function verifyWithAudit(
  pkg: ExtensionPackage,
  audit: ExtensionAudit,
  principalId: string
): Promise<VerifiedExtensionPackage> {
  try {
    return await verifyExtensionIntegrity(pkg);
  } catch (error) {
    if (error instanceof ExtensionError && error.code === "integrity_mismatch") {
      await audit({
        event: "extension.integrity_failed",
        outcome: "denied",
        principalId,
        reason: error.message,
      });
    }

    throw error;
  }
}

export function createExtensionRegistry(
  options: CreateExtensionRegistryOptions
): ExtensionRegistry {
  const { store, audit, now, hostVersion } = options;

  async function prepareInstall(text: string): Promise<InstallPreview> {
    const pkg = parseExtensionPackage(text);
    const verified = await verifyWithAudit(pkg, audit, `extension:${pkg.manifest.id}`);
    const manifest = verified.manifest;

    if (compareVersions(manifest.minHostVersion, hostVersion) > 0) {
      throw new ExtensionError(
        "host_version_unsupported",
        `This extension requires OpenNest ${manifest.minHostVersion} or newer.`
      );
    }

    const existing = await store.extensions.get(manifest.id);

    if (existing === null) {
      return {
        action: "install",
        package: pkg,
        manifest,
        requiredCapabilities: manifest.capabilities,
        requiresConsent: true,
      };
    }

    assertPublisher(existing, manifest);

    const order = compareVersions(manifest.version, existing.manifest.version);

    if (order < 0) {
      throw new ExtensionError(
        "version_downgrade",
        "Extension updates cannot downgrade the installed version."
      );
    }

    if (order === 0) {
      if (verified.integrity === existing.integrity) {
        throw new ExtensionError(
          "already_installed",
          "This exact extension version is already installed."
        );
      }

      throw new ExtensionError(
        "version_conflict",
        "The same version is already installed with different contents."
      );
    }

    const requiredCapabilities = manifest.capabilities.filter(
      (capability) => !existing.manifest.capabilities.includes(capability)
    );

    return {
      action: "update",
      package: pkg,
      manifest,
      requiredCapabilities,
      requiresConsent: requiredCapabilities.length > 0,
    };
  }

  async function install(
    preview: InstallPreview,
    acceptedCapabilities: readonly ExtensionCapability[]
  ): Promise<StoredExtension> {
    assertAccepted(preview.requiredCapabilities, acceptedCapabilities);

    const verified = await verifyWithAudit(
      preview.package,
      audit,
      `extension:${preview.manifest.id}`
    );
    const manifest = verified.manifest;
    const existing = await store.extensions.get(manifest.id);
    const requiredCapabilities =
      existing === null
        ? manifest.capabilities
        : manifest.capabilities.filter(
            (capability) => !existing.manifest.capabilities.includes(capability)
          );

    assertAccepted(requiredCapabilities, acceptedCapabilities);

    const at = now();

    if (existing === null) {
      const installed: StoredExtension = {
        id: manifest.id,
        manifest,
        code: verified.code,
        integrity: verified.integrity,
        installedAt: at,
        updatedAt: at,
        enabled: true,
      };

      await store.extensions.put(installed);
      await audit({
        event: "extension.installed",
        outcome: "completed",
        principalId: `extension:${manifest.id}`,
      });

      return installed;
    }

    assertPublisher(existing, manifest);

    const order = compareVersions(manifest.version, existing.manifest.version);

    if (order < 0) {
      throw new ExtensionError(
        "version_downgrade",
        "Extension updates cannot downgrade the installed version."
      );
    }

    if (order === 0) {
      if (verified.integrity === existing.integrity) {
        throw new ExtensionError(
          "already_installed",
          "This exact extension version is already installed."
        );
      }

      throw new ExtensionError(
        "version_conflict",
        "The same version is already installed with different contents."
      );
    }

    const updated: StoredExtension = {
      ...existing,
      manifest,
      code: verified.code,
      integrity: verified.integrity,
      updatedAt: at,
    };

    await store.extensions.put(updated);
    await audit({
      event: "extension.updated",
      outcome: "completed",
      principalId: `extension:${manifest.id}`,
    });

    return updated;
  }

  async function setEnabled(id: string, enabled: boolean): Promise<StoredExtension> {
    const existing = await store.extensions.get(id);

    if (existing === null) {
      throw new ExtensionError("extension_not_found", "The extension is not installed.");
    }

    const updated: StoredExtension = {
      ...existing,
      enabled,
      updatedAt: now(),
    };

    await store.extensions.put(updated);
    await audit({
      event: enabled ? "extension.enabled" : "extension.disabled",
      outcome: "completed",
      principalId: `extension:${id}`,
    });

    return updated;
  }

  async function uninstall(id: string): Promise<void> {
    const existing = await store.extensions.get(id);

    if (existing === null) {
      throw new ExtensionError("extension_not_found", "The extension is not installed.");
    }

    await store.uninstall(id);
    await audit({
      event: "extension.uninstalled",
      outcome: "completed",
      principalId: `extension:${id}`,
    });
  }

  async function setSafeMode(enabled: boolean): Promise<void> {
    await store.setSafeMode(enabled);
    await audit({
      event: "extension.safe_mode",
      outcome: "info",
      principalId: "built-in:local",
      reason: enabled ? "enabled" : "disabled",
    });
  }

  return {
    prepareInstall,
    install,
    setEnabled,
    uninstall,
    setSafeMode,
    getSafeMode: () => store.getSafeMode(),
    list: () => store.extensions.list(),
    get: (id) => store.extensions.get(id),
  };
}
