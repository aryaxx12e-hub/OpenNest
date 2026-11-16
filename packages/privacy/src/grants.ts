import { parseCapability } from "./capabilities";
import { CapabilityDeniedError, PrivacyError } from "./errors";
import { assertScopeSubset, normalizeScope } from "./scope";
import type {
  CapabilityGrant,
  CreateGrantInput,
  EffectiveGrantStatus,
  GrantRegistry,
  GrantStore,
  ResourceScope,
  WorkspaceCapability,
} from "./types";

export const DEFAULT_GRANT_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_GRANT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const BUILT_IN_CAPABILITIES: readonly WorkspaceCapability[] = [
  "workspace.read.metadata",
  "workspace.read.content",
  "workspace.write",
  "workspace.export",
  "workspace.delete",
];

export function builtInGrants(input: {
  workspaceId: string;
  now: number;
  generateId: () => string;
}): CapabilityGrant[] {
  return BUILT_IN_CAPABILITIES.map((capability) => ({
    id: input.generateId(),
    principalId: "built-in:local",
    capability,
    scope: { kind: "workspace", workspaceId: input.workspaceId },
    purpose: "Built-in local feature",
    createdAt: input.now,
    expiresAt: null,
    maxUses: null,
    uses: 0,
    sessionOnly: false,
    sessionId: null,
    status: "active",
    builtIn: true,
    auditRef: null,
    revokedAt: null,
  }));
}

export function effectiveGrantStatus(
  grant: CapabilityGrant,
  now: number
): EffectiveGrantStatus {
  if (grant.status === "revoked") {
    return "revoked";
  }

  if (grant.expiresAt !== null && now >= grant.expiresAt) {
    return "expired";
  }

  if (grant.maxUses !== null && grant.uses >= grant.maxUses) {
    return "exhausted";
  }

  return "active";
}

export function assertGrantAllows(
  grant: CapabilityGrant,
  request: { capability: string; scope: ResourceScope; now: number }
): void {
  const status = effectiveGrantStatus(grant, request.now);

  if (status !== "active") {
    throw new CapabilityDeniedError(status);
  }

  if (grant.capability !== request.capability) {
    throw new CapabilityDeniedError("unknown_grant");
  }

  try {
    assertScopeSubset(grant.scope, request.scope);
  } catch (error) {
    throw new CapabilityDeniedError(
      "mismatch",
      "The requested scope is outside the capability grant.",
      { cause: error }
    );
  }
}

export function createGrantRegistry(input: {
  store: GrantStore;
  now: () => number;
  generateId: () => string;
}): GrantRegistry {
  const { store, now, generateId } = input;

  async function create(request: CreateGrantInput): Promise<CapabilityGrant> {
    parseCapability(request.capability);
    assertPrincipalId(request.principalId);
    const scope = normalizeScope(request.scope);
    const purpose = validatePurpose(request.purpose);
    const at = now();
    const builtIn = request.builtIn ?? false;
    const sessionOnly = builtIn ? false : (request.sessionOnly ?? false);
    const sessionId = sessionOnly ? requireSessionId(request.sessionId) : null;
    const expiresAt = builtIn ? null : validateExpiry(request.expiresAt ?? null, at);
    const maxUses = builtIn ? null : validateMaxUses(request.maxUses ?? null);

    const grant: CapabilityGrant = {
      id: generateId(),
      principalId: request.principalId,
      capability: request.capability,
      scope,
      purpose,
      createdAt: at,
      expiresAt,
      maxUses,
      uses: 0,
      sessionOnly,
      sessionId,
      status: "active",
      builtIn,
      auditRef: request.auditRef ?? null,
      revokedAt: null,
    };

    await store.put(grant);

    return grant;
  }

  async function revoke(id: string, at: number): Promise<CapabilityGrant> {
    const grant = await store.get(id);

    if (grant === null) {
      throw new CapabilityDeniedError("unknown_grant");
    }

    if (grant.builtIn) {
      throw new PrivacyError("built_in_grant", "Built-in grants cannot be revoked.");
    }

    if (grant.status === "revoked") {
      return grant;
    }

    const revoked: CapabilityGrant = {
      ...grant,
      status: "revoked",
      revokedAt: at,
    };

    await store.put(revoked);

    return revoked;
  }

  async function revokeAll(principalId?: string): Promise<number> {
    const rows = await store.list();
    let count = 0;

    for (const grant of rows) {
      if (
        grant.builtIn ||
        (principalId !== undefined && grant.principalId !== principalId)
      ) {
        continue;
      }

      if (grant.status === "active") {
        await revoke(grant.id, now());
        count += 1;
      }
    }

    return count;
  }

  async function ensureBuiltIns(workspaceId: string): Promise<CapabilityGrant[]> {
    const rows = await store.list();
    const wanted = builtInGrants({ workspaceId, now: now(), generateId });
    const wantedCapabilities = new Set(wanted.map((grant) => grant.capability));
    const existing = rows.filter(
      (grant) =>
        grant.builtIn &&
        grant.scope.kind === "workspace" &&
        grant.scope.workspaceId === workspaceId &&
        wantedCapabilities.has(grant.capability)
    );

    for (const grant of rows) {
      if (
        grant.builtIn &&
        (grant.scope.kind !== "workspace" ||
          grant.scope.workspaceId !== workspaceId ||
          !wantedCapabilities.has(grant.capability))
      ) {
        await store.delete(grant.id);
      }
    }

    const result: CapabilityGrant[] = [];

    for (const candidate of wanted) {
      const found = existing.find((grant) => grant.capability === candidate.capability);

      if (found !== undefined) {
        result.push(found);
      } else {
        await store.put(candidate);
        result.push(candidate);
      }
    }

    return result;
  }

  return {
    create,
    get(id) {
      return store.get(id);
    },
    list() {
      return store.list();
    },
    revoke,
    revokeAll,
    async reserveUse(id) {
      const grant = await store.get(id);

      if (grant === null) {
        throw new CapabilityDeniedError("unknown_grant");
      }

      const status = effectiveGrantStatus(grant, now());

      if (status !== "active") {
        throw new CapabilityDeniedError(status);
      }

      const next: CapabilityGrant = { ...grant, uses: grant.uses + 1 };
      await store.put(next);

      return next;
    },
    ensureBuiltIns,
    async clearSession(sessionId) {
      const rows = await store.list();
      const sessionGrants = rows.filter(
        (grant) => grant.sessionOnly && grant.sessionId === sessionId
      );

      for (const grant of sessionGrants) {
        await store.delete(grant.id);
      }

      return sessionGrants.length;
    },
  };
}

function validatePurpose(value: string): string {
  const purpose = value.trim();

  if (purpose.length === 0 || purpose.length > 200) {
    throw new PrivacyError("invalid_grant", "A grant needs a short purpose.");
  }

  return purpose;
}

function validateExpiry(value: number | null, at: number): number {
  const expiresAt = value ?? at + DEFAULT_GRANT_TTL_MS;

  if (!Number.isFinite(expiresAt) || expiresAt <= at) {
    throw new PrivacyError("invalid_grant", "The grant expiry must be in the future.");
  }

  if (expiresAt - at > MAX_GRANT_TTL_MS) {
    throw new PrivacyError("invalid_grant", "The grant expiry is too far in the future.");
  }

  return expiresAt;
}

function validateMaxUses(value: number | null): number | null {
  if (value === null) {
    return null;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new PrivacyError("invalid_grant", "The use limit must be a positive integer.");
  }

  return value;
}

function requireSessionId(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim().length === 0) {
    throw new PrivacyError("invalid_grant", "A session grant needs a session ID.");
  }

  return value;
}

function assertPrincipalId(value: string): void {
  if (
    value.length === 0 ||
    value.length > 200 ||
    value.trim() !== value ||
    value.includes("*") ||
    value.includes("..") ||
    /[\u0000-\u001f\u007f\s/\\#?]/.test(value)
  ) {
    throw new PrivacyError("invalid_grant", "The grant principal is invalid.");
  }
}
