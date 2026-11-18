import { z } from "zod";

export const EXTENSION_CAPABILITIES = [
  "workspace.read.metadata",
  "workspace.read.content",
] as const;

export type ExtensionCapability = (typeof EXTENSION_CAPABILITIES)[number];

export const EXTENSION_DATA_SCOPES = ["notes", "files", "folders", "tags"] as const;

export type ExtensionDataScope = (typeof EXTENSION_DATA_SCOPES)[number];

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
const ENTRY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/;

const versionSchema = z.string().max(32).regex(VERSION_PATTERN, {
  message: "Version must use numeric major.minor.patch segments.",
});

function uniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

export const extensionManifestSchema = z.strictObject({
  id: z.string().max(128).regex(ID_PATTERN, {
    message: "Extension id must be lowercase reverse-DNS with a dot or hyphen.",
  }),
  name: z.string().trim().min(1).max(80),
  version: versionSchema,
  publisher: z.string().trim().min(1).max(80),
  description: z.string().max(500),
  tier: z.literal(1),
  entry: z.string().max(128).regex(ENTRY_PATTERN, {
    message: "Entry must be a single JavaScript filename without a path.",
  }),
  capabilities: z
    .array(z.enum(EXTENSION_CAPABILITIES))
    .max(2)
    .refine(uniqueValues, { message: "Capabilities must be unique." }),
  dataScopes: z
    .array(z.enum(EXTENSION_DATA_SCOPES))
    .max(4)
    .refine(uniqueValues, { message: "Data scopes must be unique." }),
  networkOrigins: z.array(z.string().max(2_048)).max(0),
  minHostVersion: versionSchema,
});

export type ExtensionManifest = z.infer<typeof extensionManifestSchema>;

export function isExtensionCapability(value: unknown): value is ExtensionCapability {
  return EXTENSION_CAPABILITIES.includes(value as ExtensionCapability);
}
