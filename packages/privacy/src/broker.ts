import { CapabilityDeniedError, PrivacyError } from "./errors";
import { assertGrantAllows, effectiveGrantStatus } from "./grants";
import { assertPolicyAllows } from "./policy";
import { normalizeScope, scopeDigest } from "./scope";
import type {
  AuditInput,
  AuditLog,
  CapabilityBroker,
  CapabilityGrant,
  CapabilityHandle,
  CapabilityRequest,
  GrantRegistry,
  Principal,
} from "./types";

export const HANDLE_TTL_MS = 5 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 1000;
const MAX_CALLS_PER_WINDOW = 60;
const MAX_REQUESTS_PER_WINDOW = 30;

interface IssuedHandle {
  readonly handle: CapabilityHandle;
  used: boolean;
}

export function createCapabilityBroker(input: {
  principal: Principal;
  sessionId: string;
  grants: GrantRegistry;
  audit: AuditLog;
  now: () => number;
  generateId: () => string;
  onRevoke?: () => void;
  maxCallsPerWindow?: number;
  windowMs?: number;
}): CapabilityBroker {
  const {
    principal,
    sessionId,
    grants,
    audit,
    now,
    generateId,
    onRevoke,
    maxCallsPerWindow = MAX_CALLS_PER_WINDOW,
    windowMs = RATE_WINDOW_MS,
  } = input;
  const issued = new Map<string, IssuedHandle>();
  const active = new Map<string, AbortController>();
  const rate = new Map<string, number[]>();

  async function record(event: AuditInput): Promise<void> {
    try {
      await audit.append(event);
    } catch (error) {
      throw new CapabilityDeniedError(
        "audit_failed",
        "The action was denied because the audit log could not be written.",
        { cause: error }
      );
    }
  }

  async function auditDenial(
    capability: string,
    scopeDigestValue: string | null,
    code: string
  ): Promise<void> {
    await record({
      event: "capability.denied",
      outcome: "denied",
      principalId: principal.id,
      capability,
      scopeDigest: scopeDigestValue,
      reason: code,
    });
  }

  async function checkRateLimit(
    key: string,
    limit: number,
    capability: string,
    scopeDigestValue: string | null
  ): Promise<void> {
    const at = now();
    const cutoff = at - windowMs;
    const calls = (rate.get(key) ?? []).filter((timestamp) => timestamp > cutoff);

    if (calls.length >= limit) {
      await record({
        event: "rate.limited",
        outcome: "denied",
        principalId: principal.id,
        capability,
        scopeDigest: scopeDigestValue,
        reason: "rate_limited",
      });
      throw new CapabilityDeniedError("rate_limited");
    }

    calls.push(at);
    rate.set(key, calls);
  }

  async function matchingGrant(
    request: CapabilityRequest
  ): Promise<CapabilityGrant | null> {
    const rows = await grants.list();

    for (const grant of rows) {
      if (grant.principalId !== principal.id) {
        continue;
      }

      if (grant.sessionOnly && grant.sessionId !== sessionId) {
        continue;
      }

      if (grant.capability !== request.capability) {
        continue;
      }

      if (effectiveGrantStatus(grant, now()) !== "active") {
        continue;
      }

      try {
        assertGrantAllows(grant, {
          capability: request.capability,
          scope: request.scope,
          now: now(),
        });
        return grant;
      } catch {
        continue;
      }
    }

    return null;
  }

  return {
    async request(request) {
      let digest: string | null = null;

      try {
        await assertPolicyAllows({
          principal,
          capability: request.capability,
          scope: request.scope,
          now: now(),
          ...(request.confirmation === undefined
            ? {}
            : { confirmation: request.confirmation }),
        });
        digest = await scopeDigest(request.scope);
        await checkRateLimit(
          `request:${principal.id}:${request.capability}`,
          MAX_REQUESTS_PER_WINDOW,
          request.capability,
          digest
        );
      } catch (error) {
        const code = error instanceof PrivacyError ? error.code : "unknown_grant";

        if (digest === null) {
          try {
            digest = await scopeDigest(request.scope);
          } catch {
            digest = null;
          }
        }

        await auditDenial(request.capability, digest, code);
        throw error;
      }

      const grant = await matchingGrant(request);

      if (grant === null) {
        await auditDenial(request.capability, digest, "unknown_grant");
        throw new CapabilityDeniedError("unknown_grant");
      }

      let reserved: CapabilityGrant;

      try {
        reserved = await grants.reserveUse(grant.id);
      } catch (error) {
        const code = error instanceof PrivacyError ? error.code : "unknown_grant";
        await auditDenial(request.capability, digest, code);
        throw error;
      }

      const scope = normalizeScope(request.scope);
      const at = now();
      const expiresAt = Math.min(
        reserved.expiresAt ?? Number.MAX_SAFE_INTEGER,
        at + HANDLE_TTL_MS
      );

      if (expiresAt <= at) {
        await auditDenial(request.capability, digest, "expired");
        throw new CapabilityDeniedError("expired");
      }

      const handle: CapabilityHandle = {
        id: generateId(),
        grantId: reserved.id,
        principalId: principal.id,
        sessionId,
        capability: reserved.capability,
        scope,
        expiresAt,
      };

      await record({
        event: "capability.allowed",
        outcome: "allowed",
        principalId: principal.id,
        capability: reserved.capability,
        scopeDigest: digest,
      });
      issued.set(handle.id, { handle, used: false });

      return handle;
    },

    async invoke<T>(
      handle: CapabilityHandle,
      operation: (signal: AbortSignal) => Promise<T>
    ): Promise<T> {
      const recordForHandle = issued.get(handle.id);

      if (recordForHandle === undefined) {
        await auditDenial(handle.capability, null, "mismatch");
        throw new CapabilityDeniedError("mismatch");
      }

      const known = recordForHandle.handle;
      const digest = await scopeDigest(known.scope);

      if (
        recordForHandle.used ||
        known.principalId !== principal.id ||
        known.sessionId !== sessionId ||
        known.grantId !== handle.grantId ||
        known.capability !== handle.capability ||
        (await scopeDigest(handle.scope)) !== digest
      ) {
        await auditDenial(handle.capability, digest, "mismatch");
        throw new CapabilityDeniedError("mismatch");
      }

      const grant = await grants.get(known.grantId);

      if (grant === null) {
        await auditDenial(known.capability, digest, "unknown_grant");
        throw new CapabilityDeniedError("unknown_grant");
      }

      if (grant.status === "revoked") {
        await auditDenial(known.capability, digest, "revoked");
        throw new CapabilityDeniedError("revoked");
      }

      if (grant.expiresAt !== null && now() >= grant.expiresAt) {
        await auditDenial(known.capability, digest, "expired");
        throw new CapabilityDeniedError("expired");
      }

      if (now() >= known.expiresAt) {
        await auditDenial(known.capability, digest, "expired");
        throw new CapabilityDeniedError("expired");
      }

      await checkRateLimit(
        `call:${principal.id}:${known.capability}`,
        maxCallsPerWindow,
        known.capability,
        digest
      );
      recordForHandle.used = true;

      const controller = new AbortController();
      active.set(known.id, controller);

      try {
        const result = await operation(controller.signal);

        if (controller.signal.aborted) {
          throw new CapabilityDeniedError("revoked");
        }

        await record({
          event: "capability.completed",
          outcome: "completed",
          principalId: principal.id,
          capability: known.capability,
          scopeDigest: digest,
        });

        return result;
      } catch (error) {
        if (controller.signal.aborted) {
          await auditDenial(known.capability, digest, "revoked");
          throw new CapabilityDeniedError("revoked");
        }

        await record({
          event: "capability.failed",
          outcome: "failed",
          principalId: principal.id,
          capability: known.capability,
          scopeDigest: digest,
          reason: error instanceof PrivacyError ? error.code : "operation_failed",
        });
        throw error;
      } finally {
        active.delete(known.id);
      }
    },

    async revoke(grantId) {
      const grant = await grants.get(grantId);

      if (grant === null) {
        throw new CapabilityDeniedError("unknown_grant");
      }

      if (grant.builtIn) {
        throw new PrivacyError("built_in_grant", "Built-in grants cannot be revoked.");
      }

      await grants.revoke(grantId, now());

      for (const [handleId, controller] of active) {
        const issuedHandle = issued.get(handleId);

        if (issuedHandle?.handle.grantId === grantId) {
          controller.abort();
        }
      }

      onRevoke?.();
      await record({
        event: "grant.revoked",
        outcome: "info",
        principalId: principal.id,
        capability: grant.capability,
        reason: "revoked",
      });
    },

    async revokeAll() {
      const rows = await grants.list();
      let count = 0;

      for (const grant of rows) {
        if (
          grant.principalId === principal.id &&
          !grant.builtIn &&
          grant.status === "active"
        ) {
          await this.revoke(grant.id);
          count += 1;
        }
      }

      return count;
    },

    async listGrants() {
      const rows = await grants.list();
      return rows.filter((grant) => grant.principalId === principal.id);
    },

    async endSession() {
      for (const controller of active.values()) {
        controller.abort();
      }

      active.clear();
      issued.clear();
      await grants.clearSession(sessionId);
    },
  };
}
