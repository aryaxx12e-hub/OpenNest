import { describe, expect, it } from "vitest";

import { createAuditLog } from "../audit";
import { createCapabilityBroker } from "../broker";
import { createGrantRegistry } from "../grants";
import { scopeDigest } from "../scope";
import { createMemoryPrivacyStore, createSequenceIds } from "../testing";
import type { Principal } from "../types";

const NOW = Date.parse("2026-11-15T08:00:00.000Z");
const builtIn: Principal = {
  id: "built-in:local",
  type: "built-in",
  label: "Built-in local features",
};

async function createBroker(
  principal: Principal = builtIn,
  sessionId = "session-a",
  maxCallsPerWindow?: number
) {
  const store = createMemoryPrivacyStore();
  const registry = createGrantRegistry({
    store: store.grants,
    now: () => NOW,
    generateId: createSequenceIds("grant"),
  });
  await registry.ensureBuiltIns("w1");
  const audit = createAuditLog({
    store: store.audit,
    now: () => NOW,
    generateId: createSequenceIds("audit"),
  });
  const broker = createCapabilityBroker({
    principal,
    sessionId,
    grants: registry,
    audit,
    now: () => NOW,
    generateId: createSequenceIds("handle"),
    ...(maxCallsPerWindow === undefined ? {} : { maxCallsPerWindow }),
  });

  return { broker, registry, store, audit };
}

function readRequest() {
  return {
    capability: "workspace.read.metadata" as const,
    scope: { kind: "workspace" as const, workspaceId: "w1" },
    purpose: "Render the dashboard",
  };
}

describe("capability broker", () => {
  it("binds a handle to its principal and session", async () => {
    const first = await createBroker();
    const second = await createBroker(
      { id: "built-in:other", type: "built-in", label: "Other" },
      "session-b"
    );
    const handle = await first.broker.request(readRequest());

    await expect(
      second.broker.invoke(handle, async () => "secret")
    ).rejects.toMatchObject({
      code: "mismatch",
    });
  });

  it("rejects a reused handle and a request with no matching grant", async () => {
    const { broker } = await createBroker();
    const handle = await broker.request(readRequest());

    await expect(broker.invoke(handle, async () => "ok")).resolves.toBe("ok");
    await expect(broker.invoke(handle, async () => "again")).rejects.toMatchObject({
      code: "mismatch",
    });

    const denied = await createBroker({
      id: "user:stranger",
      type: "user",
      label: "User",
    });

    await expect(denied.broker.request(readRequest())).rejects.toMatchObject({
      code: "unknown_grant",
    });
  });

  it("cancels an in-flight operation on revoke and rejects later use", async () => {
    const { broker, registry } = await createBroker({
      id: "extension:demo",
      type: "extension",
      label: "Demo extension",
    });
    const grant = await registry.create({
      principalId: "extension:demo",
      capability: "workspace.read.metadata",
      scope: { kind: "workspace", workspaceId: "w1" },
      purpose: "Render selected items",
      expiresAt: NOW + 60_000,
    });
    const handle = await broker.request(readRequest());
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = broker.invoke(handle, async (signal) => {
      await gate;

      if (signal.aborted) {
        throw new Error("aborted");
      }

      return "late";
    });

    await broker.revoke(grant.id);
    release();

    await expect(running).rejects.toMatchObject({ code: "revoked" });
    await expect(broker.invoke(handle, async () => "later")).rejects.toMatchObject({
      code: "revoked",
    });
  });

  it("requests network, AI, and credential grants with valid scopes", async () => {
    const principal: Principal = {
      id: "extension:demo",
      type: "extension",
      label: "Demo extension",
    };
    const { broker, registry } = await createBroker(principal);

    await registry.create({
      principalId: principal.id,
      capability: "network.connect:https://api.openai.com",
      scope: { kind: "origin", origin: "https://api.openai.com" },
      purpose: "Connect to the selected provider",
      expiresAt: NOW + 60_000,
    });
    await registry.create({
      principalId: principal.id,
      capability: "ai.invoke:openai",
      scope: { kind: "provider", providerId: "openai" },
      purpose: "Invoke the selected provider",
      expiresAt: NOW + 60_000,
    });
    await registry.create({
      principalId: principal.id,
      capability: "credential.use:openai",
      scope: { kind: "provider", providerId: "openai" },
      purpose: "Use the selected credential",
      expiresAt: NOW + 60_000,
    });

    const network = await broker.request({
      capability: "network.connect:https://api.openai.com",
      scope: { kind: "origin", origin: "https://api.openai.com" },
      purpose: "Connect to the selected provider",
    });
    await expect(broker.invoke(network, async () => "connected")).resolves.toBe(
      "connected"
    );

    const ai = await broker.request({
      capability: "ai.invoke:openai",
      scope: { kind: "provider", providerId: "openai" },
      purpose: "Invoke the selected provider",
    });
    await expect(broker.invoke(ai, async () => "completed")).resolves.toBe("completed");

    const providerScope = { kind: "provider", providerId: "openai" } as const;
    const credential = await broker.request({
      capability: "credential.use:openai",
      scope: providerScope,
      purpose: "Use the selected credential",
      confirmation: {
        confirmedAt: NOW,
        scopeDigest: await scopeDigest(providerScope),
        itemCount: 1,
      },
    });
    await expect(broker.invoke(credential, async () => "credential")).resolves.toBe(
      "credential"
    );
  });

  it("rejects a session-only grant from another session", async () => {
    const principal: Principal = {
      id: "extension:demo",
      type: "extension",
      label: "Demo extension",
    };
    const store = createMemoryPrivacyStore();
    const registry = createGrantRegistry({
      store: store.grants,
      now: () => NOW,
      generateId: createSequenceIds("grant"),
    });
    const audit = createAuditLog({
      store: store.audit,
      now: () => NOW,
      generateId: createSequenceIds("audit"),
    });
    const brokerA = createCapabilityBroker({
      principal,
      sessionId: "session-a",
      grants: registry,
      audit,
      now: () => NOW,
      generateId: createSequenceIds("handle-a"),
    });
    const brokerB = createCapabilityBroker({
      principal,
      sessionId: "session-b",
      grants: registry,
      audit,
      now: () => NOW,
      generateId: createSequenceIds("handle-b"),
    });

    await registry.create({
      principalId: principal.id,
      capability: "workspace.read.metadata",
      scope: { kind: "workspace", workspaceId: "w1" },
      purpose: "Render selected items",
      sessionOnly: true,
      sessionId: "session-a",
      expiresAt: NOW + 60_000,
    });

    await expect(brokerB.request(readRequest())).rejects.toMatchObject({
      code: "unknown_grant",
    });
    await expect(brokerA.request(readRequest())).resolves.toMatchObject({
      sessionId: "session-a",
    });
  });

  it("requires confirmation for high-risk capabilities", async () => {
    const { broker } = await createBroker();

    await expect(
      broker.request({
        capability: "workspace.export",
        scope: { kind: "workspace", workspaceId: "w1" },
        purpose: "Download a backup",
      })
    ).rejects.toMatchObject({ code: "confirmation_required" });
  });

  it("rate-limits capability calls and audits the denial", async () => {
    const { broker, audit } = await createBroker(builtIn, "session-a", 1);

    const first = await broker.request(readRequest());
    await broker.invoke(first, async () => "ok");

    const second = await broker.request(readRequest());
    await expect(broker.invoke(second, async () => "too many")).rejects.toMatchObject({
      code: "rate_limited",
    });

    const entries = await audit.list();
    expect(entries.some((entry) => entry.event === "rate.limited")).toBe(true);
  });
});
