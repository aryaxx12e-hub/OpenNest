import "fake-indexeddb/auto";

import Dexie from "dexie";
import { describe, expect, it } from "vitest";

import { createCredentialVault } from "@opennest/credential-vault";

import { createDexieCredentialVaultStore } from "../dexie-store";

const NOW = Date.parse("2026-11-17T08:00:00.000Z");
const PASSPHRASE = "correct horse battery staple";
const SECRET = "sk-disk-secret-value";

function uniqueDatabaseName(): string {
  return `opennest-credentials-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

describe("credential vault Dexie store", () => {
  it("persists the vault record across a close and reopen", async () => {
    const databaseName = uniqueDatabaseName();
    const store = createDexieCredentialVaultStore({ databaseName });
    await store.init();
    const vault = createCredentialVault({ store, now: () => NOW });
    const session = await vault.setup(PASSPHRASE);
    const entry = await vault.create(session, {
      providerId: "openai",
      accountLabel: "Work",
      secret: SECRET,
    });
    await store.close();

    const reopenedStore = createDexieCredentialVaultStore({ databaseName });
    await reopenedStore.init();
    const reopenedVault = createCredentialVault({
      store: reopenedStore,
      now: () => NOW,
    });
    const unlocked = await reopenedVault.unlock(PASSPHRASE);

    await expect(
      reopenedVault.withSecret(unlocked, entry.id, "openai", async (secret) => secret)
    ).resolves.toBe(SECRET);
    await reopenedStore.close();
  });

  it("stores no plaintext secret", async () => {
    const databaseName = uniqueDatabaseName();
    const store = createDexieCredentialVaultStore({ databaseName });
    await store.init();
    const vault = createCredentialVault({ store, now: () => NOW });
    const session = await vault.setup(PASSPHRASE);
    await vault.create(session, {
      providerId: "openai",
      accountLabel: "Work",
      secret: SECRET,
    });
    await store.close();

    const db = new Dexie(databaseName);
    await db.open();
    const row = await db.table("vaults").get("default");
    db.close();

    expect(row).toBeDefined();
    expect(JSON.stringify(row)).not.toContain(SECRET);
  });
});
