import { describe, expect, it } from "vitest";

import { createConsentRegistry } from "../consents";
import { createMemoryPrivacyStore, createSequenceIds, fixedNow } from "../testing";
import type { ConsentExpectation, CreateConsentInput } from "../types";

const NOW = Date.parse("2026-11-17T08:00:00.000Z");
const HASH = "a".repeat(64);

function validInput(overrides: Partial<CreateConsentInput> = {}): CreateConsentInput {
  return {
    sessionId: "session-a",
    principalId: "built-in:local",
    providerId: "openai",
    model: "gpt-4.1-mini",
    endpointOrigin: "https://api.openai.com",
    payloadHash: HASH,
    payloadBytes: 128,
    dataClasses: ["D1", "D2"],
    purpose: "Send the selected prompt to the provider",
    expiresAt: NOW + 60_000,
    ...overrides,
  };
}

function expectation(overrides: Partial<ConsentExpectation> = {}): ConsentExpectation {
  return {
    sessionId: "session-a",
    providerId: "openai",
    model: "gpt-4.1-mini",
    endpointOrigin: "https://api.openai.com",
    payloadHash: HASH,
    dataClasses: ["D2", "D1"],
    at: NOW + 10_000,
    ...overrides,
  };
}

async function setup() {
  const store = createMemoryPrivacyStore();
  const registry = createConsentRegistry({
    store: store.consents,
    now: fixedNow(NOW),
    generateId: createSequenceIds("consent"),
  });

  return { registry, store };
}

describe("consent registry", () => {
  it("creates and lists a one-time consent", async () => {
    const { registry } = await setup();
    const created = await registry.create(validInput());

    expect(created).toEqual({
      id: "consent-1",
      sessionId: "session-a",
      principalId: "built-in:local",
      providerId: "openai",
      model: "gpt-4.1-mini",
      endpointOrigin: "https://api.openai.com",
      payloadHash: HASH,
      payloadBytes: 128,
      dataClasses: ["D1", "D2"],
      purpose: "Send the selected prompt to the provider",
      createdAt: NOW,
      expiresAt: NOW + 60_000,
      usedAt: null,
      revokedAt: null,
    });
    await expect(registry.list()).resolves.toEqual([created]);
  });

  it("rejects a payload hash mismatch before recording a use", async () => {
    const { registry } = await setup();
    const created = await registry.create(validInput());

    await expect(
      registry.consume(created.id, expectation({ payloadHash: "b".repeat(64) }))
    ).rejects.toMatchObject({ code: "consent_mismatch" });
    await expect(registry.get(created.id)).resolves.toMatchObject({ usedAt: null });
  });

  it("rejects a consent from another session or with another model", async () => {
    const { registry } = await setup();
    const created = await registry.create(validInput());

    await expect(
      registry.consume(created.id, expectation({ sessionId: "session-b" }))
    ).rejects.toMatchObject({ code: "consent_mismatch" });
    await expect(
      registry.consume(created.id, expectation({ model: "gpt-4.1" }))
    ).rejects.toMatchObject({ code: "consent_mismatch" });
    await expect(
      registry.consume(created.id, expectation({ dataClasses: ["D1"] }))
    ).rejects.toMatchObject({ code: "consent_mismatch" });
  });

  it("consumes a consent exactly once", async () => {
    const { registry } = await setup();
    const created = await registry.create(validInput());
    const used = await registry.consume(created.id, expectation());

    expect(used.usedAt).toBe(NOW + 10_000);
    await expect(registry.consume(created.id, expectation())).rejects.toMatchObject({
      code: "consent_used",
    });
  });

  it("rejects expired and revoked consents", async () => {
    const { registry } = await setup();
    const expired = await registry.create(
      validInput({ expiresAt: NOW + 1_000, purpose: "Short-lived consent" })
    );

    await expect(
      registry.consume(expired.id, expectation({ at: NOW + 1_000 }))
    ).rejects.toMatchObject({ code: "consent_expired" });

    const revoked = await registry.create(
      validInput({ purpose: "Revoked consent", expiresAt: NOW + 60_000 })
    );
    const revocation = await registry.revoke(revoked.id, NOW + 5_000);
    expect(revocation.revokedAt).toBe(NOW + 5_000);
    await expect(
      registry.consume(revoked.id, expectation({ at: NOW + 6_000 }))
    ).rejects.toMatchObject({ code: "consent_revoked" });
  });

  it("validates the consent fields and the five-minute ceiling", async () => {
    const { registry } = await setup();

    await expect(
      registry.create(validInput({ payloadHash: "A".repeat(64) }))
    ).rejects.toMatchObject({ code: "invalid_consent" });
    await expect(registry.create(validInput({ dataClasses: [] }))).rejects.toMatchObject({
      code: "invalid_consent",
    });
    await expect(
      registry.create(validInput({ expiresAt: NOW + 5 * 60 * 1000 + 1 }))
    ).rejects.toMatchObject({ code: "invalid_consent" });
    await expect(
      registry.create(validInput({ providerId: "open ai" }))
    ).rejects.toMatchObject({ code: "invalid_consent" });
    await expect(registry.create(validInput({ purpose: "   " }))).rejects.toMatchObject({
      code: "invalid_consent",
    });
  });

  it("clears consents with the memory privacy store", async () => {
    const { registry, store } = await setup();
    await registry.create(validInput());
    await store.reset();

    await expect(registry.list()).resolves.toEqual([]);
  });
});
