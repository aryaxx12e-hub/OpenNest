import { isExternalCapability, parseCapability } from "./capabilities";
import { CapabilityDeniedError } from "./errors";
import { normalizeScope, scopeDigest } from "./scope";
import type { Capability, HighRiskConfirmation, Principal, ResourceScope } from "./types";

export const HIGH_RISK_CONFIRMATION_MS = 5 * 60 * 1000;

export function isHighRiskCapability(capability: Capability): boolean {
  return (
    capability === "workspace.export" ||
    capability === "workspace.delete" ||
    capability.startsWith("credential.use:")
  );
}

export async function assertPolicyAllows(input: {
  principal: Principal;
  capability: Capability;
  scope: ResourceScope;
  now: number;
  confirmation?: HighRiskConfirmation;
}): Promise<void> {
  const parsed = parseCapability(input.capability);

  if (isExternalCapability(parsed.capability)) {
    throw new CapabilityDeniedError("external_unavailable");
  }

  normalizeScope(input.scope);

  if (!isHighRiskCapability(input.capability)) {
    return;
  }

  const confirmation = input.confirmation;

  if (confirmation === undefined) {
    throw new CapabilityDeniedError("confirmation_required");
  }

  const age = input.now - confirmation.confirmedAt;

  if (
    !Number.isFinite(confirmation.confirmedAt) ||
    confirmation.confirmedAt > input.now + 60_000 ||
    age > HIGH_RISK_CONFIRMATION_MS
  ) {
    throw new CapabilityDeniedError("confirmation_stale");
  }

  if (!Number.isInteger(confirmation.itemCount) || confirmation.itemCount < 0) {
    throw new CapabilityDeniedError("mismatch");
  }

  const digest = await scopeDigest(input.scope);

  if (digest !== confirmation.scopeDigest) {
    throw new CapabilityDeniedError("mismatch");
  }
}
