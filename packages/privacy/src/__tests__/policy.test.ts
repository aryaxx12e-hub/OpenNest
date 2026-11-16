import { describe, expect, it } from "vitest";

import { assertPolicyAllows } from "../policy";
import { scopeDigest } from "../scope";
import type { Principal } from "../types";

const NOW = Date.parse("2026-11-15T08:00:00.000Z");
const builtIn: Principal = {
  id: "built-in:local",
  type: "built-in",
  label: "Built-in local features",
};
const scope = { kind: "workspace", workspaceId: "w1" } as const;

describe("capability policy", () => {
  it("allows local metadata operations without a confirmation", async () => {
    await expect(
      assertPolicyAllows({
        principal: builtIn,
        capability: "workspace.read.metadata",
        scope,
        now: NOW,
      })
    ).resolves.toBeUndefined();
  });

  it("rejects external capabilities in D1 even for a built-in principal", async () => {
    await expect(
      assertPolicyAllows({
        principal: builtIn,
        capability: "ai.invoke:openai",
        scope: { kind: "provider", providerId: "openai" },
        now: NOW,
      })
    ).rejects.toMatchObject({ code: "external_unavailable" });
  });

  it("requires a recent confirmation with the exact scope for high-risk actions", async () => {
    await expect(
      assertPolicyAllows({
        principal: builtIn,
        capability: "workspace.export",
        scope,
        now: NOW,
      })
    ).rejects.toMatchObject({ code: "confirmation_required" });

    await expect(
      assertPolicyAllows({
        principal: builtIn,
        capability: "workspace.export",
        scope,
        now: NOW,
        confirmation: {
          confirmedAt: NOW - 6 * 60 * 1000,
          scopeDigest: await scopeDigest(scope),
          itemCount: 3,
        },
      })
    ).rejects.toMatchObject({ code: "confirmation_stale" });

    await expect(
      assertPolicyAllows({
        principal: builtIn,
        capability: "workspace.export",
        scope,
        now: NOW,
        confirmation: {
          confirmedAt: NOW,
          scopeDigest: await scopeDigest({ kind: "workspace", workspaceId: "w2" }),
          itemCount: 3,
        },
      })
    ).rejects.toMatchObject({ code: "mismatch" });

    await expect(
      assertPolicyAllows({
        principal: builtIn,
        capability: "workspace.export",
        scope,
        now: NOW,
        confirmation: {
          confirmedAt: NOW,
          scopeDigest: await scopeDigest(scope),
          itemCount: 3,
        },
      })
    ).resolves.toBeUndefined();
  });
});
