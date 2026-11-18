import "fake-indexeddb/auto";

import Dexie from "dexie";
import { describe, expect, it } from "vitest";

import type { AuditEntry, CapabilityGrant, ConsentRecord } from "@opennest/privacy";

import { createDexiePrivacyStore } from "../dexie-store";

const NOW = Date.parse("2026-11-15T08:00:00.000Z");

function uniqueDatabaseName(): string {
  return `opennest-privacy-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function grantFixture(overrides: Partial<CapabilityGrant> = {}): CapabilityGrant {
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
    builtIn: true,
    auditRef: null,
    revokedAt: null,
    ...overrides,
  };
}

function consentFixture(overrides: Partial<ConsentRecord> = {}): ConsentRecord {
  return {
    id: "consent-1",
    sessionId: "session-a",
    principalId: "built-in:local",
    providerId: "openai",
    model: "gpt-4.1-mini",
    endpointOrigin: "https://api.openai.com",
    payloadHash: "a".repeat(64),
    payloadBytes: 128,
    dataClasses: ["D1", "D2"],
    purpose: "Send a prompt",
    createdAt: NOW,
    expiresAt: NOW + 60_000,
    usedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function auditFixture(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: "audit-1",
    sequence: 0,
    at: NOW,
    event: "grant.created",
    outcome: "allowed",
    principalId: "built-in:local",
    capability: "workspace.read.metadata",
    scopeDigest: "digest",
    itemCount: null,
    reason: null,
    prevHash: null,
    hash: "hash-1",
    ...overrides,
  };
}

describe("privacy Dexie store", () => {
  it("persists grants and audit entries across a close and reopen", async () => {
    const databaseName = uniqueDatabaseName();
    const store = createDexiePrivacyStore({ databaseName });
    await store.init();
    await store.grants.put(grantFixture());
    await store.audit.append(auditFixture());
    await store.close();

    const reopened = createDexiePrivacyStore({ databaseName });
    await reopened.init();
    expect((await reopened.grants.get("grant-1"))?.capability).toBe(
      "workspace.read.metadata"
    );
    expect((await reopened.audit.list()).map((entry) => entry.id)).toEqual(["audit-1"]);
    await reopened.close();
  });

  it("resets grants, audit, metadata, and consents in one operation", async () => {
    const store = createDexiePrivacyStore({ databaseName: uniqueDatabaseName() });
    await store.init();
    await store.grants.put(grantFixture());
    await store.audit.append(auditFixture());
    await store.consents.put(consentFixture());
    await store.reset();

    expect(await store.grants.list()).toEqual([]);
    expect(await store.audit.list()).toEqual([]);
    expect(await store.consents.list()).toEqual([]);
    await store.close();
  });

  it("upgrades a version 1 database to version 2 and keeps grants", async () => {
    const databaseName = uniqueDatabaseName();
    const legacy = new Dexie(databaseName);
    legacy.version(1).stores({
      grants: "id, principalId, capability, status, expiresAt",
      audit: "id, sequence, at, event",
      meta: "key",
    });
    await legacy.open();
    await legacy.table("grants").put(grantFixture());
    await legacy.table("audit").put(auditFixture());
    legacy.close();

    const store = createDexiePrivacyStore({ databaseName });
    await store.init();

    expect((await store.grants.get("grant-1"))?.capability).toBe(
      "workspace.read.metadata"
    );
    expect(await store.audit.list()).toHaveLength(1);
    expect(await store.consents.list()).toEqual([]);
    await store.consents.put(consentFixture());
    expect(await store.consents.list()).toHaveLength(1);
    await store.close();
  });
});
