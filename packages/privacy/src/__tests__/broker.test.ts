import { describe, expect, it } from "vitest";

import { createAuditLog } from "../audit";
import { createCapabilityBroker } from "../broker";
import { createGrantRegistry } from "../grants";
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
