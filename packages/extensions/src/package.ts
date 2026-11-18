import { z } from "zod";

import { canonicalJson, sha256Hex } from "@opennest/privacy";

import { ExtensionError } from "./errors";
import {
  EXTENSION_CAPABILITIES,
  extensionManifestSchema,
  type ExtensionCapability,
  type ExtensionManifest,
} from "./manifest";

export const EXTENSION_FORMAT = "opennest-extension";
export const EXTENSION_FORMAT_VERSION = 1;
export const EXTENSION_MAX_PACKAGE_BYTES = 256 * 1_024;
export const EXTENSION_MAX_CODE_BYTES = 128 * 1_024;

const ENTRY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/;
const INTEGRITY_PATTERN = /^sha256:[0-9a-f]{64}$/;

const extensionPackageSchema = z.strictObject({
  format: z.literal(EXTENSION_FORMAT),
  formatVersion: z.literal(EXTENSION_FORMAT_VERSION),
  manifest: extensionManifestSchema,
  files: z.record(z.string(), z.string()),
  integrity: z.string().regex(INTEGRITY_PATTERN),
});

export type ExtensionPackage = z.infer<typeof extensionPackageSchema>;

export type VerifiedExtensionPackage = ExtensionPackage & {
  readonly code: string;
};

export interface CreateExtensionPackageInput {
  readonly manifest: ExtensionManifest;
  readonly code: string;
}

type PackagePayload = Pick<
  ExtensionPackage,
  "format" | "formatVersion" | "manifest" | "files"
>;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issueSummary(error: z.ZodError): string {
  const issue = error.issues[0];

  if (issue === undefined) {
    return "Invalid extension value.";
  }

  const location = issue.path.join(".") || "package";

  return `${location}: ${issue.message}`;
}

function assertSupportedManifest(value: unknown): void {
  if (!isRecord(value)) {
    return;
  }

  if (value.tier !== undefined && value.tier !== 1) {
    throw new ExtensionError("unsupported_tier", "Only Tier 1 extensions are supported.");
  }

  if (Array.isArray(value.capabilities)) {
    for (const capability of value.capabilities) {
      if (!EXTENSION_CAPABILITIES.includes(capability as ExtensionCapability)) {
        throw new ExtensionError(
          "unsupported_capability",
          `Capability ${JSON.stringify(capability)} is not available in D4A.`
        );
      }
    }
  }

  if (Array.isArray(value.networkOrigins) && value.networkOrigins.length > 0) {
    throw new ExtensionError(
      "unsupported_network",
      "Extensions cannot request network origins in D4A."
    );
  }
}

function parseManifest(value: unknown): ExtensionManifest {
  const result = extensionManifestSchema.safeParse(value);

  if (!result.success) {
    throw new ExtensionError("invalid_manifest", issueSummary(result.error));
  }

  return result.data;
}

function assertValidFiles(
  files: Readonly<Record<string, string>>,
  manifest: ExtensionManifest
): string {
  const names = Object.keys(files);

  if (names.length !== 1) {
    throw new ExtensionError("invalid_files", "A package must contain exactly one file.");
  }

  const entry = names[0];

  if (entry === undefined || entry !== manifest.entry || !ENTRY_PATTERN.test(entry)) {
    throw new ExtensionError(
      "invalid_files",
      "The single package file must match the manifest entry."
    );
  }

  const code = files[entry];

  if (code === undefined) {
    throw new ExtensionError("invalid_files", "The package entry file is missing.");
  }

  if (byteLength(code) > EXTENSION_MAX_CODE_BYTES) {
    throw new ExtensionError(
      "code_too_large",
      `Extension code must be at most ${EXTENSION_MAX_CODE_BYTES} bytes.`
    );
  }

  return code;
}

async function computeIntegrity(payload: PackagePayload): Promise<string> {
  return `sha256:${await sha256Hex(canonicalJson(payload))}`;
}

function packageError(error: z.ZodError): ExtensionError {
  const root = error.issues[0]?.path[0];

  if (root === "files") {
    return new ExtensionError("invalid_files", issueSummary(error));
  }

  if (root === "manifest") {
    return new ExtensionError("invalid_manifest", issueSummary(error));
  }

  return new ExtensionError("invalid_package", issueSummary(error));
}

export async function createExtensionPackage(
  input: CreateExtensionPackageInput
): Promise<ExtensionPackage> {
  assertSupportedManifest(input.manifest);
  const manifest = parseManifest(input.manifest);

  if (byteLength(input.code) > EXTENSION_MAX_CODE_BYTES) {
    throw new ExtensionError(
      "code_too_large",
      `Extension code must be at most ${EXTENSION_MAX_CODE_BYTES} bytes.`
    );
  }

  const files = { [manifest.entry]: input.code };
  assertValidFiles(files, manifest);

  const payload: PackagePayload = {
    format: EXTENSION_FORMAT,
    formatVersion: EXTENSION_FORMAT_VERSION,
    manifest,
    files,
  };
  const integrity = await computeIntegrity(payload);
  const pkg: ExtensionPackage = { ...payload, integrity };

  if (byteLength(JSON.stringify(pkg)) > EXTENSION_MAX_PACKAGE_BYTES) {
    throw new ExtensionError(
      "package_too_large",
      `Extension package must be at most ${EXTENSION_MAX_PACKAGE_BYTES} bytes.`
    );
  }

  return pkg;
}

export function parseExtensionPackage(text: string): ExtensionPackage {
  if (byteLength(text) > EXTENSION_MAX_PACKAGE_BYTES) {
    throw new ExtensionError(
      "package_too_large",
      `Extension package must be at most ${EXTENSION_MAX_PACKAGE_BYTES} bytes.`
    );
  }

  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ExtensionError("invalid_package", "Extension package must be valid JSON.", {
      cause: error,
    });
  }

  if (!isRecord(raw)) {
    throw new ExtensionError(
      "invalid_package",
      "Extension package must be a JSON object."
    );
  }

  if (raw.format !== EXTENSION_FORMAT) {
    throw new ExtensionError(
      "unsupported_format",
      `Expected format ${JSON.stringify(EXTENSION_FORMAT)}.`
    );
  }

  if (raw.formatVersion !== EXTENSION_FORMAT_VERSION) {
    throw new ExtensionError(
      "unsupported_format_version",
      `Expected format version ${EXTENSION_FORMAT_VERSION}.`
    );
  }

  assertSupportedManifest(raw.manifest);

  const result = extensionPackageSchema.safeParse(raw);

  if (!result.success) {
    throw packageError(result.error);
  }

  assertValidFiles(result.data.files, result.data.manifest);

  return result.data;
}

export async function verifyExtensionIntegrity(
  pkg: ExtensionPackage
): Promise<VerifiedExtensionPackage> {
  const parsed = parseExtensionPackage(JSON.stringify(pkg));
  const expected = await computeIntegrity({
    format: parsed.format,
    formatVersion: parsed.formatVersion,
    manifest: parsed.manifest,
    files: parsed.files,
  });

  if (parsed.integrity !== expected) {
    throw new ExtensionError(
      "integrity_mismatch",
      "The package contents do not match the recorded integrity hash."
    );
  }

  const code = parsed.files[parsed.manifest.entry];

  if (code === undefined) {
    throw new ExtensionError("invalid_files", "The package entry file is missing.");
  }

  return { ...parsed, code };
}
