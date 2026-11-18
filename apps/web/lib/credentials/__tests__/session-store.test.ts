import { describe, expect, it } from "vitest";

import { createSessionCredentialStore } from "../session-store";

const NOW = Date.parse("2026-11-17T08:00:00.000Z");
const SECRET = "sk-session-secret-value";

function setup() {
  let nextId = 0;

  return createSessionCredentialStore({
    now: () => NOW,
    generateId: () => `credential-${++nextId}`,
  });
}

describe("session credential store", () => {
  it("stores secrets privately and exposes metadata only", async () => {
    const store = setup();
    const metadata = await store.put({
      providerId: "openai",
      accountLabel: "Work",
      secret: SECRET,
    });

    expect(metadata).toEqual({
      id: "credential-1",
      providerId: "openai",
      accountLabel: "Work",
      createdAt: NOW,
    });
    expect(store.list()).toEqual([metadata]);
    expect(store.list()[0]).not.toHaveProperty("secret");
    await expect(
      store.withSecret(metadata.id, "openai", async (secret) => secret)
    ).resolves.toBe(SECRET);
    expect(JSON.stringify(store.list())).not.toContain(SECRET);
  });

  it("removes one credential, a provider's credentials, and everything", async () => {
    const store = setup();
    const first = await store.put({
      providerId: "openai",
      accountLabel: "Work",
      secret: "first-secret",
    });
    const second = await store.put({
      providerId: "openai",
      accountLabel: "Personal",
      secret: "second-secret",
    });
    const third = await store.put({
      providerId: "anthropic",
      accountLabel: "Work",
      secret: "third-secret",
    });

    store.remove(first.id);
    expect(store.list().map((entry) => entry.id)).toEqual([second.id, third.id]);
    store.removeProvider("openai");
    expect(store.list().map((entry) => entry.id)).toEqual([third.id]);
    store.clear();
    expect(store.list()).toEqual([]);
    await expect(
      store.withSecret(third.id, "anthropic", async (secret) => secret)
    ).rejects.toMatchObject({ code: "credential_not_found" });
  });

  it("rejects a mismatched provider and an unknown credential", async () => {
    const store = setup();
    const metadata = await store.put({
      providerId: "openai",
      accountLabel: "Work",
      secret: SECRET,
    });

    await expect(
      store.withSecret(metadata.id, "anthropic", async (secret) => secret)
    ).rejects.toMatchObject({ code: "provider_mismatch" });
    await expect(
      store.withSecret("missing", "openai", async (secret) => secret)
    ).rejects.toMatchObject({ code: "credential_not_found" });
  });
});
