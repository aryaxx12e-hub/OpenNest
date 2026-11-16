import { PrivacyError } from "./errors";
import { normalizeOrigin } from "./scope";
import type {
  Capability,
  CapabilityFamily,
  ParsedCapability,
  WorkspaceCapability,
} from "./types";

const WORKSPACE_CAPABILITIES: readonly WorkspaceCapability[] = [
  "workspace.read.metadata",
  "workspace.read.content",
  "workspace.write",
  "workspace.export",
  "workspace.delete",
];

const WORKSPACE_SET = new Set<string>(WORKSPACE_CAPABILITIES);

export interface CapabilityCatalogEntry {
  readonly capability: Capability;
  readonly family: CapabilityFamily;
  readonly scope: string;
  readonly highRisk: boolean;
}

export const CAPABILITY_CATALOG: readonly CapabilityCatalogEntry[] = [
  ...WORKSPACE_CAPABILITIES.map((capability) => ({
    capability,
    family: "workspace" as const,
    scope: "workspace, folder subtree, selected notes, or selected files",
    highRisk: capability === "workspace.export" || capability === "workspace.delete",
  })),
  {
    capability: "network.connect:<origin>",
    family: "network",
    scope: "one explicit origin",
    highRisk: false,
  },
  {
    capability: "credential.use:<provider-id>",
    family: "credential",
    scope: "one provider credential",
    highRisk: true,
  },
  {
    capability: "ai.invoke:<provider-id>",
    family: "ai",
    scope: "one AI provider",
    highRisk: false,
  },
  {
    capability: "sync.push",
    family: "sync",
    scope: "one workspace",
    highRisk: false,
  },
  {
    capability: "sync.pull",
    family: "sync",
    scope: "one workspace",
    highRisk: false,
  },
] as const;

export function parseCapability(value: string): ParsedCapability {
  if (WORKSPACE_SET.has(value)) {
    return {
      family: "workspace",
      capability: value as WorkspaceCapability,
    };
  }

  if (value === "sync.push" || value === "sync.pull") {
    return { family: "sync", capability: value };
  }

  const qualified = parseQualified(value);

  if (qualified !== null) {
    return qualified;
  }

  throw new PrivacyError("invalid_capability", "The capability is not recognized.");
}

export function isCapability(value: string): value is Capability {
  try {
    parseCapability(value);
    return true;
  } catch {
    return false;
  }
}

export function isExternalCapability(capability: Capability): boolean {
  return parseCapability(capability).family !== "workspace";
}

function parseQualified(value: string): ParsedCapability | null {
  const networkPrefix = "network.connect:";
  const credentialPrefix = "credential.use:";
  const aiPrefix = "ai.invoke:";

  if (value.startsWith(networkPrefix)) {
    const qualifier = value.slice(networkPrefix.length);

    try {
      normalizeOrigin(qualifier);
    } catch {
      throw new PrivacyError(
        "invalid_capability",
        "The capability qualifier is invalid."
      );
    }

    return {
      family: "network",
      capability: value as Capability,
      qualifier,
    };
  }

  if (value.startsWith(credentialPrefix)) {
    const qualifier = value.slice(credentialPrefix.length);
    assertProviderQualifier(qualifier);

    return {
      family: "credential",
      capability: value as Capability,
      qualifier,
    };
  }

  if (value.startsWith(aiPrefix)) {
    const qualifier = value.slice(aiPrefix.length);
    assertProviderQualifier(qualifier);

    return {
      family: "ai",
      capability: value as Capability,
      qualifier,
    };
  }

  return null;
}

function assertProviderQualifier(value: string): void {
  if (
    value.length === 0 ||
    value.length > 300 ||
    value.trim() !== value ||
    value.includes("*") ||
    value.includes("..") ||
    /[\u0000-\u001f\u007f\s/\\#?]/.test(value)
  ) {
    throw new PrivacyError("invalid_capability", "The capability qualifier is invalid.");
  }
}
