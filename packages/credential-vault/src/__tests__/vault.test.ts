import {
  base64UrlDecode,
  deriveKekBytes,
  importAesGcmKey,
  unwrapKeyBytes,
  WORKSPACE_KEK_DOMAIN,
  type KdfParameters,
} from "@opennest/crypto";
import { describe, expect, it } from "vitest";

import { vaultDekAad } from "../aad";
import { CredentialVaultError } from "../errors";
import { createMemoryCredentialVaultStore } from "../memory-store";
import { parseVaultRecord } from "../record";
import {
  DEFAULT_VAULT_AUTO_LOCK_MS,
  MAX_VAULT_UNLOCK_ATTEMPTS,
  type VaultRecordV1,
} from "../types";
import { createCredentialVault } from "../vault";

const NOW = 1_700_000_000_000;
const PASSPHRASE = "correct horse battery";

function setup() {
  let clock = NOW;
  const store = createMemoryCredentialVaultStore();
  const vault = createCredentialVault({
    store,
    now: () => clock,
  });

  return {
    vault,
    store,
    now: () => clock,
    advance: (milliseconds: number) => {
      clock += milliseconds;
    },
  };
}

async function deriveKek(passphrase: string, kdf: KdfParameters) {
  return importAesGcmKey(
    await deriveKekBytes(
      passphrase,
      base64UrlDecode(kdf.salt),
      kdf.iterations,
      kdf.domain
    )
  );
}

describe("credential vault setup and unlock", () => {
  it("sets up a vault and unlocks it with the same passphrase", async () => {
    const { vault } = setup();
    const created = await vault.setup(PASSPHRASE);

    expect(created.vaultId).toMatch(/^vault_/);
    expect(created.isUnlocked(NOW)).toBe(true);
    expect(created.expiresAt).toBe(NOW + DEFAULT_VAULT_AUTO_LOCK_MS);
    expect(await vault.hasVault()).toBe(true);

    const record = await vault.get();
    expect(record?.entries).toEqual([]);
    expect(record?.failedAttempts).toBe(0);
    expect(record?.retryAfter).toBeNull();

    created.lock();
    expect(created.isUnlocked(NOW)).toBe(false);

    const unlocked = await vault.unlock(PASSPHRASE);
    expect(unlocked.vaultId).toBe(created.vaultId);
    expect(unlocked.isUnlocked(NOW)).toBe(true);
  });

  it("rejects a wrong passphrase and enforces the five-attempt limit", async () => {
    const { vault, advance } = setup();
    await vault.setup(PASSPHRASE);

    for (let attempt = 1; attempt < MAX_VAULT_UNLOCK_ATTEMPTS; attempt += 1) {
      await expect(vault.unlock("wrong horse battery")).rejects.toMatchObject({
        code: "authentication_failed",
      });
    }

    await expect(vault.unlock("wrong horse battery")).rejects.toMatchObject({
      code: "rate_limited",
    });
    await expect(vault.unlock(PASSPHRASE)).rejects.toMatchObject({
      code: "rate_limited",
    });

    advance(30_000);
    await expect(vault.unlock(PASSPHRASE)).resolves.toMatchObject({
      vaultId: expect.stringMatching(/^vault_/),
    });
  });

  it("requires twelve characters without trimming spaces", async () => {
    const short = setup();
    await expect(short.vault.setup("elevenchars")).rejects.toMatchObject({
      code: "invalid_passphrase",
    });

    const exact = setup();
    await expect(exact.vault.setup("twelve chars")).resolves.toBeTruthy();

    const spaced = setup();
    await spaced.vault.setup("  spaced passphrase  ");
    await expect(spaced.vault.unlock("spaced passphrase")).rejects.toMatchObject({
      code: "authentication_failed",
    });
    await expect(spaced.vault.unlock("  spaced passphrase  ")).resolves.toBeTruthy();
  });

  it("changes the passphrase, invalidates the old one, and keeps the DEK", async () => {
    const { vault } = setup();
    const session = await vault.setup(PASSPHRASE);
    const before = await vault.get();

    if (before === null) {
      throw new Error("Expected a vault record");
    }

    const oldKek = await deriveKek(PASSPHRASE, before.kdf);
    const oldDek = await unwrapKeyBytes(
      oldKek,
      before.wrappedDek,
      vaultDekAad(before.vaultId, before.activeKid)
    );

    await vault.changePassphrase(session, PASSPHRASE, "next horse battery");

    const after = await vault.get();

    if (after === null) {
      throw new Error("Expected a vault record");
    }

    const nextKek = await deriveKek("next horse battery", after.kdf);
    const nextDek = await unwrapKeyBytes(
      nextKek,
      after.wrappedDek,
      vaultDekAad(after.vaultId, after.activeKid)
    );

    expect([...nextDek]).toEqual([...oldDek]);
    expect(after.wrappedDek.ciphertext).not.toBe(before.wrappedDek.ciphertext);
    await expect(vault.unlock(PASSPHRASE)).rejects.toMatchObject({
      code: "authentication_failed",
    });
    await expect(vault.unlock("next horse battery")).resolves.toBeTruthy();
  });

  it("does not serialize the passphrase, DEK, or plaintext secret", async () => {
    const { vault } = setup();
    await vault.setup(PASSPHRASE);
    const json = JSON.stringify(await vault.get());

    expect(json).not.toContain(PASSPHRASE);
    expect(json).not.toContain('"dek"');
    expect(json).not.toContain('"passphrase"');
    expect(json).not.toContain('"secret"');
  });
});

describe("credential vault record parsing", () => {
  it("rejects malformed records", async () => {
    const { vault } = setup();
    await vault.setup(PASSPHRASE);
    const baseline = await vault.get();

    if (baseline === null) {
      throw new Error("Expected a vault record");
    }

    const mutations: Array<(record: VaultRecordV1) => void> = [
      (record) => {
        (record as { version: number }).version = 2;
      },
      (record) => {
        record.kdf.domain = WORKSPACE_KEK_DOMAIN;
      },
      (record) => {
        record.kdf.salt = "not-a-salt";
      },
      (record) => {
        record.wrappedDek.ciphertext = "not-a-wrapped-key";
      },
      (record) => {
        (record as unknown as Record<string, unknown>).extra = true;
      },
      (record) => {
        record.createdAt = -1;
      },
      (record) => {
        record.failedAttempts = MAX_VAULT_UNLOCK_ATTEMPTS;
        record.retryAfter = null;
      },
    ];

    for (const mutate of mutations) {
      const record = structuredClone(baseline);
      mutate(record);
      expect(() => parseVaultRecord(record)).toThrow(CredentialVaultError);
    }
  });
});
