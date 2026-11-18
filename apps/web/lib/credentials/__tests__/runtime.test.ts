import { describe, expect, it } from "vitest";

import { createMemoryCredentialVaultStore } from "@opennest/credential-vault";

import { createCredentialRuntime } from "../runtime";

const NOW = Date.parse("2026-11-17T08:00:00.000Z");
const PASSPHRASE = "correct horse battery staple";
const SECRET = "sk-runtime-secret-value";

async function setup() {
  let nextId = 0;

  return createCredentialRuntime({
    store: createMemoryCredentialVaultStore(),
    now: () => NOW,
    generateId: () => `credential-${++nextId}`,
  });
}

describe("credential runtime", () => {
  it("resolves session credentials and rejects a mismatched provider", async () => {
    const runtime = await setup();
    const metadata = await runtime.createSessionCredential({
      providerId: "openai",
      accountLabel: "Work",
      secret: SECRET,
    });

    await expect(
      runtime.resolve({ kind: "session", id: metadata.id, providerId: "openai" })
    ).resolves.toBe(SECRET);
    await expect(
      runtime.resolve({
        kind: "session",
        id: metadata.id,
        providerId: "anthropic",
      })
    ).rejects.toMatchObject({ code: "provider_mismatch" });
    await runtime.dispose();
  });

  it("resolves vault credentials while unlocked and rejects a locked vault", async () => {
    const runtime = await setup();
    await runtime.setupVault(PASSPHRASE);
    const session = runtime.getVaultSession();

    expect(session).not.toBeNull();
    const entry = await runtime.vault.create(session!, {
      providerId: "openai",
      accountLabel: "Work",
      secret: SECRET,
    });

    await expect(
      runtime.resolve({ kind: "vault", id: entry.id, providerId: "openai" })
    ).resolves.toBe(SECRET);

    runtime.lockVault();
    expect(runtime.getVaultSession()).toBeNull();
    await expect(
      runtime.resolve({ kind: "vault", id: entry.id, providerId: "openai" })
    ).rejects.toMatchObject({ code: "vault_locked" });

    await runtime.unlockVault(PASSPHRASE);
    expect(runtime.getVaultSession()).not.toBeNull();
    await runtime.dispose();
  });

  it("clears vault and session credentials together", async () => {
    const runtime = await setup();
    await runtime.createSessionCredential({
      providerId: "openai",
      accountLabel: "Session",
      secret: SECRET,
    });
    await runtime.setupVault(PASSPHRASE);
    const session = runtime.getVaultSession();
    await runtime.vault.create(session!, {
      providerId: "openai",
      accountLabel: "Vault",
      secret: SECRET,
    });

    await runtime.clearAllData();

    expect(runtime.session.list()).toEqual([]);
    expect(runtime.getVaultSession()).toBeNull();
    await expect(runtime.vault.hasVault()).resolves.toBe(false);
    await expect(runtime.vault.get()).resolves.toBeNull();
    await runtime.dispose();
  });
});
