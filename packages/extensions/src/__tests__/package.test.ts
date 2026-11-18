import { describe, expect, it } from "vitest";

import type { ExtensionManifest } from "../manifest";
import {
  EXTENSION_MAX_CODE_BYTES,
  EXTENSION_MAX_PACKAGE_BYTES,
  createExtensionPackage,
  parseExtensionPackage,
  verifyExtensionIntegrity,
} from "../package";

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

const CODE = "opennest.register(() => ({}));";

describe("extension packages", () => {
  it("creates a canonical integrity hash and exposes the verified code", async () => {
    const pkg = await createExtensionPackage({ manifest: manifest(), code: CODE });

    expect(pkg.format).toBe("opennest-extension");
    expect(pkg.formatVersion).toBe(1);
    expect(pkg.integrity).toMatch(/^sha256:[0-9a-f]{64}$/);
    await expect(verifyExtensionIntegrity(pkg)).resolves.toMatchObject({
      code: CODE,
      manifest: manifest(),
    });
  });

  it("round-trips a parsed package", async () => {
    const pkg = await createExtensionPackage({ manifest: manifest(), code: CODE });

    expect(parseExtensionPackage(JSON.stringify(pkg))).toEqual(pkg);
  });

  it("rejects tampered code", async () => {
    const pkg = await createExtensionPackage({ manifest: manifest(), code: CODE });

    await expect(
      verifyExtensionIntegrity({ ...pkg, files: { "main.js": "tampered" } })
    ).rejects.toMatchObject({ code: "integrity_mismatch" });
  });

  it("rejects unsupported capabilities inside the manifest", async () => {
    const pkg = await createExtensionPackage({ manifest: manifest(), code: CODE });

    expect(() =>
      parseExtensionPackage(
        JSON.stringify({
          ...pkg,
          manifest: { ...pkg.manifest, capabilities: ["workspace.write"] },
        })
      )
    ).toThrow("unsupported_capability");
  });

  it("rejects duplicate capabilities", async () => {
    await expect(
      createExtensionPackage({
        manifest: manifest({
          capabilities: ["workspace.read.metadata", "workspace.read.metadata"],
        }),
        code: CODE,
      })
    ).rejects.toMatchObject({ code: "invalid_manifest" });
  });

  it("rejects network origins", async () => {
    const pkg = await createExtensionPackage({ manifest: manifest(), code: CODE });

    expect(() =>
      parseExtensionPackage(
        JSON.stringify({
          ...pkg,
          manifest: { ...pkg.manifest, networkOrigins: ["https://x.test"] },
        })
      )
    ).toThrow("unsupported_network");
  });

  it("rejects non-tier-1 packages", async () => {
    await expect(
      createExtensionPackage({
        manifest: manifest({ tier: 0 as 1 }),
        code: CODE,
      })
    ).rejects.toMatchObject({ code: "unsupported_tier" });
  });

  it("rejects path traversal and mismatched entry files", async () => {
    await expect(
      createExtensionPackage({
        manifest: manifest({ entry: "../main.js" }),
        code: CODE,
      })
    ).rejects.toMatchObject({ code: "invalid_manifest" });

    const pkg = await createExtensionPackage({ manifest: manifest(), code: CODE });

    expect(() =>
      parseExtensionPackage(
        JSON.stringify({
          ...pkg,
          manifest: { ...pkg.manifest, entry: "other.js" },
        })
      )
    ).toThrow("invalid_files");
  });

  it("rejects extra files and unknown package fields", async () => {
    const pkg = await createExtensionPackage({ manifest: manifest(), code: CODE });

    expect(() =>
      parseExtensionPackage(
        JSON.stringify({ ...pkg, files: { ...pkg.files, "extra.js": "extra" } })
      )
    ).toThrow("invalid_files");

    expect(() =>
      parseExtensionPackage(JSON.stringify({ ...pkg, unexpected: true }))
    ).toThrow("invalid_package");
  });

  it("rejects oversized code and oversized package text", async () => {
    await expect(
      createExtensionPackage({
        manifest: manifest(),
        code: "x".repeat(EXTENSION_MAX_CODE_BYTES + 1),
      })
    ).rejects.toMatchObject({ code: "code_too_large" });

    expect(() =>
      parseExtensionPackage(" ".repeat(EXTENSION_MAX_PACKAGE_BYTES + 1))
    ).toThrow("package_too_large");
  });

  it("rejects unsupported formats and invalid JSON", async () => {
    const pkg = await createExtensionPackage({ manifest: manifest(), code: CODE });

    expect(() =>
      parseExtensionPackage(JSON.stringify({ ...pkg, format: "other" }))
    ).toThrow("unsupported_format");
    expect(() =>
      parseExtensionPackage(JSON.stringify({ ...pkg, formatVersion: 2 }))
    ).toThrow("unsupported_format_version");
    expect(() => parseExtensionPackage("{")).toThrow("invalid_package");
  });
});
