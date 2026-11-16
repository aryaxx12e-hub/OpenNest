import { describe, expect, it } from "vitest";

import {
  assertGrantAllows,
  builtInGrants,
  createGrantRegistry,
  effectiveGrantStatus,
} from "../grants";
import { createMemoryPrivacyStore, createSequenceIds } from "../testing";
import type { CapabilityGrant } from "../types";

const NOW = Date.parse("2026-11-15T08:00:00.000Z");

function grant(overrides: Partial<CapabilityGrant> = {}): CapabilityGrant {
  return {
    id: "grant-1",
    principalId: "built-in:local",
    capability: "workspace.read.metadata",
    scope: { kind: "workspace", workspaceId: "w1" },
    purpose: "Render local workspace",
    createdAt: NOW,
    expiresAt: null,
    maxUses: null,
    uses: 0,
    sessionOnly: false,
    sessionId: null,
    status: "active",
    builtIn: false,
    auditRef: null,
    revokedAt: null,
    ...overrides,
  };
}

describe("built-in grants", () => {
  it("creates the five workspace grants with no external capability", () => {
    const grants = builtInGrants({
      workspaceId: "w1",
      now: NOW,
      generateId: createSequenceIds("grant"),
    });

    expect(grants.map((entry) => entry.capability)).toEqual([
      "workspace.read.metadata",
      "workspace.read.content",
      "workspace.write",
      "workspace.export",
      "workspace.delete",
    ]);
    expect(grants.every((entry) => entry.builtIn)).toBe(true);
    expect(grants.every((entry) => entry.expiresAt === null)).toBe(true);
    expect(grants.every((entry) => entry.maxUses === null)).toBe(true);
  });
});

describe("grant lifecycle", () => {
  it("expires, exhausts, and revokes grants", () => {
    const active = grant({ expiresAt: NOW + 1, maxUses: 2 });

    expect(effectiveGrantStatus(active, NOW)).toBe("active");
    expect(effectiveGrantStatus(active, NOW + 1)).toBe("expired");
    expect(effectiveGrantStatus({ ...active, uses: 2 }, NOW)).toBe("exhausted");
    expect(effectiveGrantStatus({ ...active, status: "revoked" }, NOW)).toBe("revoked");
  });

  it("does not let a built-in grant authorize an external capability", () => {
    const workspaceGrant = builtInGrants({
      workspaceId: "w1",
      now: NOW,
      generateId: createSequenceIds("grant"),
    })[0];

    if (workspaceGrant === undefined) {
      throw new Error("Expected a built-in grant");
    }

    expect(() =>
      assertGrantAllows(workspaceGrant, {
        capability: "ai.invoke:openai",
        scope: { kind: "provider", providerId: "openai" },
        now: NOW,
      })
    ).toThrow();
  });

  it("rejects scope widening, expiry, exhaustion, and revocation", () => {
    const expiresAt = NOW + 1_000;
    const row = grant({ expiresAt, maxUses: 1 });

    expect(() =>
      assertGrantAllows(row, {
        capability: "workspace.read.metadata",
        scope: { kind: "workspace", workspaceId: "w2" },
        now: NOW,
      })
    ).toThrow();
    expect(() =>
      assertGrantAllows(row, {
        capability: "workspace.read.metadata",
        scope: { kind: "workspace", workspaceId: "w1" },
        now: expiresAt,
      })
    ).toThrow();
    expect(() =>
      assertGrantAllows(
        { ...row, uses: 1 },
        {
          capability: "workspace.read.metadata",
          scope: { kind: "workspace", workspaceId: "w1" },
          now: NOW,
        }
      )
    ).toThrow();
    expect(() =>
      assertGrantAllows(
        { ...row, status: "revoked" },
        {
          capability: "workspace.read.metadata",
          scope: { kind: "workspace", workspaceId: "w1" },
          now: NOW,
        }
      )
    ).toThrow();
  });
});

describe("grant registry", () => {
  it("persists, reserves uses, revokes, and clears session grants", async () => {
    const store = createMemoryPrivacyStore();
    const registry = createGrantRegistry({
      store: store.grants,
      now: () => NOW,
      generateId: createSequenceIds("grant"),
    });
    const created = await registry.create({
      principalId: "extension:demo",
      capability: "workspace.read.content",
      scope: { kind: "notes", workspaceId: "w1", noteIds: ["note-1"] },
      purpose: "Preview a note",
      sessionOnly: true,
      sessionId: "session-1",
      expiresAt: NOW + 1_000,
    });

    expect((await registry.get(created.id))?.purpose).toBe("Preview a note");
    expect((await registry.reserveUse(created.id)).uses).toBe(1);
    expect(await registry.clearSession("session-1")).toBe(1);
    expect(await registry.get(created.id)).toBeNull();
  });

  it("replaces built-in grants when the workspace changes", async () => {
    const store = createMemoryPrivacyStore();
    const registry = createGrantRegistry({
      store: store.grants,
      now: () => NOW,
      generateId: createSequenceIds("grant"),
    });

    const first = await registry.ensureBuiltIns("w1");
    const second = await registry.ensureBuiltIns("w2");
    const rows = await registry.list();

    expect(first).toHaveLength(5);
    expect(second).toHaveLength(5);
    expect(rows.filter((entry) => entry.builtIn)).toHaveLength(5);
    expect(
      rows.every(
        (entry) =>
          entry.builtIn &&
          entry.scope.kind === "workspace" &&
          entry.scope.workspaceId === "w2"
      )
    ).toBe(true);
  });

  it("refuses to revoke a built-in grant", async () => {
    const store = createMemoryPrivacyStore();
    const registry = createGrantRegistry({
      store: store.grants,
      now: () => NOW,
      generateId: createSequenceIds("grant"),
    });
    const builtIns = await registry.ensureBuiltIns("w1");
    const builtIn = builtIns[0];

    if (builtIn === undefined) {
      throw new Error("Expected a built-in grant");
    }

    await expect(registry.revoke(builtIn.id, NOW)).rejects.toMatchObject({
      code: "built_in_grant",
    });
  });
});
