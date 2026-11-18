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

  it("allows network and AI capabilities while the broker checks the grant", async () => {
    await expect(
      assertPolicyAllows({
        principal: builtIn,
        capability: "network.connect:https://api.openai.com",
        scope: { kind: "origin", origin: "https://api.openai.com" },
        now: NOW,
      })
    ).resolves.toBeUndefined();

    await expect(
      assertPolicyAllows({
        principal: builtIn,
        capability: "ai.invoke:openai",
        scope: { kind: "provider", providerId: "openai" },
        now: NOW,
      })
    ).resolves.toBeUndefined();
  });

  it("keeps sync unavailable", async () => {
    await expect(
      assertPolicyAllows({
        principal: builtIn,
        capability: "sync.push",
        scope,
        now: NOW,
      })
    ).rejects.toMatchObject({ code: "external_unavailable" });

    await expect(
      assertPolicyAllows({
        principal: builtIn,
        capability: "sync.pull",
        scope,
        now: NOW,
      })
    ).rejects.toMatchObject({ code: "external_unavailable" });
  });

  it("requires confirmation for credential use", async () => {
    const providerScope = { kind: "provider", providerId: "openai" } as const;

    await expect(
      assertPolicyAllows({
        principal: builtIn,
        capability: "credential.use:openai",
        scope: providerScope,
        now: NOW,
      })
    ).rejects.toMatchObject({ code: "confirmation_required" });

    await expect(
      assertPolicyAllows({
        principal: builtIn,
        capability: "credential.use:openai",
        scope: providerScope,
        now: NOW,
        confirmation: {
          confirmedAt: NOW,
          scopeDigest: await scopeDigest(providerScope),
          itemCount: 1,
        },
      })
    ).resolves.toBeUndefined();
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
