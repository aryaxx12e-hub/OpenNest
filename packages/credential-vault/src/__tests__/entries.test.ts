import {
  base64UrlDecode,
  deriveKekBytes,
  importAesGcmKey,
  unwrapKeyBytes,
} from "@opennest/crypto";
import { describe, expect, it } from "vitest";

import { entryKeyAad, vaultDekAad } from "../aad";
import { createMemoryCredentialVaultStore } from "../memory-store";
import {
  MAX_SECRET_BYTES,
  type CredentialVaultSession,
  type VaultRecordV1,
} from "../types";
import { createCredentialVault } from "../vault";

const NOW = 1_700_000_000_000;
const PASSPHRASE = "correct horse battery";
const SECRET = "sk-test-secret-value";

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

async function createEntries(
  vault: ReturnType<typeof createCredentialVault>,
  session: CredentialVaultSession
) {
  const first = await vault.create(session, {
    providerId: "openai",
    accountLabel: "Work",
    secret: SECRET,
  });
  const second = await vault.create(session, {
    providerId: "anthropic",
    accountLabel: "Personal",
    secret: "sk-second-secret",
  });

  return { first, second };
}

describe("credential vault entries", () => {
  it("creates, lists, updates, removes, and reads secrets", async () => {
    const { vault } = setup();
    const session = await vault.setup(PASSPHRASE);
    const { first, second } = await createEntries(vault, session);

    const list = await vault.list(session);
    expect(list.map((entry) => entry.id)).toEqual([first.id, second.id]);
    expect(list[0]).not.toHaveProperty("ciphertext");
    expect(list[0]).not.toHaveProperty("wrappedCek");

    await expect(
      vault.withSecret(session, first.id, "openai", async (secret) => secret)
    ).resolves.toBe(SECRET);

    const relabeled = await vault.update(session, first.id, {
      accountLabel: "Work updated",
    });
    expect(relabeled.accountLabel).toBe("Work updated");
    await expect(
      vault.withSecret(session, first.id, "openai", async (secret) => secret)
    ).resolves.toBe(SECRET);

    await vault.update(session, first.id, { secret: "sk-updated-secret" });
    await expect(
      vault.withSecret(session, first.id, "openai", async (secret) => secret)
    ).resolves.toBe("sk-updated-secret");

    await vault.remove(session, second.id);
    await expect(vault.list(session)).resolves.toHaveLength(1);
    await expect(
      vault.withSecret(session, second.id, "anthropic", async (secret) => secret)
    ).rejects.toMatchObject({ code: "entry_not_found" });
  });

  it("validates provider IDs, labels, and secret sizes", async () => {
    const { vault } = setup();
    const session = await vault.setup(PASSPHRASE);

    await expect(
      vault.create(session, {
        providerId: "bad provider",
        accountLabel: "Work",
        secret: SECRET,
      })
    ).rejects.toMatchObject({ code: "invalid_provider_id" });
    await expect(
      vault.create(session, {
        providerId: "openai",
        accountLabel: "",
        secret: SECRET,
      })
    ).rejects.toMatchObject({ code: "invalid_account_label" });
    await expect(
      vault.create(session, {
        providerId: "openai",
        accountLabel: "Work",
        secret: "",
      })
    ).rejects.toMatchObject({ code: "invalid_secret" });
    await expect(
      vault.create(session, {
        providerId: "openai",
        accountLabel: "Work",
        secret: "a".repeat(MAX_SECRET_BYTES + 1),
      })
    ).rejects.toMatchObject({ code: "invalid_secret" });
  });

  it("rejects a different provider ID", async () => {
    const { vault } = setup();
    const session = await vault.setup(PASSPHRASE);
    const { first } = await createEntries(vault, session);

    await expect(
      vault.withSecret(session, first.id, "anthropic", async (secret) => secret)
    ).rejects.toMatchObject({ code: "provider_mismatch" });
    await expect(
      vault.withSecret(session, first.id, "bad provider", async (secret) => secret)
    ).rejects.toMatchObject({ code: "invalid_provider_id" });
  });

  it("fails authentication when entry fields are swapped or changed", async () => {
    const { vault, store } = setup();
    const session = await vault.setup(PASSPHRASE);
    const { first } = await createEntries(vault, session);
    const baseline = await vault.get();

    if (baseline === null) {
      throw new Error("Expected a vault record");
    }

    const cases: Array<{
      name: string;
      providerId: string;
      expectedCode: string;
      mutate: (record: VaultRecordV1) => void;
    }> = [
      {
        name: "ciphertext",
        providerId: "openai",
        expectedCode: "authentication_failed",
        mutate: (record) => {
          Object.assign(record.entries[0]!, {
            ciphertext: record.entries[1]!.ciphertext,
          });
        },
      },
      {
        name: "provider",
        providerId: "anthropic",
        expectedCode: "authentication_failed",
        mutate: (record) => {
          Object.assign(record.entries[0]!, { providerId: "anthropic" });
        },
      },
      {
        name: "label",
        providerId: "openai",
        expectedCode: "authentication_failed",
        mutate: (record) => {
          Object.assign(record.entries[0]!, { accountLabel: "Personal" });
        },
      },
      {
        name: "entry ID",
        providerId: "anthropic",
        expectedCode: "authentication_failed",
        mutate: (record) => {
          Object.assign(record.entries[0]!, { id: baseline.entries[1]!.id });
          Object.assign(record.entries[1]!, { id: baseline.entries[0]!.id });
        },
      },
      {
        name: "key ID",
        providerId: "openai",
        expectedCode: "vault_corrupt",
        mutate: (record) => {
          Object.assign(record.entries[0]!, { kid: "vk_other" });
        },
      },
    ];

    for (const testCase of cases) {
      const next = structuredClone(baseline);
      testCase.mutate(next);
      await store.put(next);
      await expect(
        vault.withSecret(session, first.id, testCase.providerId, async (secret) => secret)
      ).rejects.toMatchObject({ code: testCase.expectedCode });
    }
  });

  it("uses a unique nonce for every wrapped key and ciphertext", async () => {
    const { vault } = setup();
    const session = await vault.setup(PASSPHRASE);

    for (let index = 0; index < 3; index += 1) {
      await vault.create(session, {
        providerId: "openai",
        accountLabel: `Account ${index}`,
        secret: `secret-${index}`,
      });
    }

    const record = await vault.get();
    const nonces = record?.entries.flatMap((entry) => [entry.wrappedCek.iv, entry.iv]);

    expect(nonces).toBeDefined();
    expect(new Set(nonces).size).toBe(nonces?.length);
  });

  it("updates only the selected entry", async () => {
    const { vault } = setup();
    const session = await vault.setup(PASSPHRASE);
    const { first } = await createEntries(vault, session);
    const before = await vault.get();

    if (before === null) {
      throw new Error("Expected a vault record");
    }

    await vault.update(session, first.id, { secret: "sk-updated-secret" });
    const after = await vault.get();

    if (after === null) {
      throw new Error("Expected a vault record");
    }

    expect(after.entries[0]!.ciphertext).not.toBe(before.entries[0]!.ciphertext);
    expect(after.entries[1]).toEqual(before.entries[1]);
  });

  it("rotates every entry and invalidates the old DEK", async () => {
    const { vault } = setup();
    const session = await vault.setup(PASSPHRASE);
    const { first } = await createEntries(vault, session);
    const before = await vault.get();

    if (before === null) {
      throw new Error("Expected a vault record");
    }

    const oldKek = await importAesGcmKey(
      await deriveKekBytes(
        PASSPHRASE,
        base64UrlDecode(before.kdf.salt),
        before.kdf.iterations,
        before.kdf.domain
      )
    );
    const oldDek = await importAesGcmKey(
      await unwrapKeyBytes(
        oldKek,
        before.wrappedDek,
        vaultDekAad(before.vaultId, before.activeKid)
      )
    );

    await vault.rotate(session);
    const after = await vault.get();

    if (after === null) {
      throw new Error("Expected a vault record");
    }

    expect(after.activeKid).not.toBe(before.activeKid);
    expect(after.wrappedDek.ciphertext).not.toBe(before.wrappedDek.ciphertext);
    await expect(
      vault.withSecret(session, first.id, "openai", async (secret) => secret)
    ).resolves.toBe(SECRET);

    const rotatedEntry = after.entries[0]!;
    const aad = entryKeyAad({
      vaultId: after.vaultId,
      activeKid: after.activeKid,
      entryId: rotatedEntry.id,
      providerId: rotatedEntry.providerId,
      accountLabel: rotatedEntry.accountLabel,
      entryVersion: 1,
    });

    await expect(
      unwrapKeyBytes(oldDek, rotatedEntry.wrappedCek, aad)
    ).rejects.toMatchObject({ code: "authentication_failed" });

    const unlocked = await vault.unlock(PASSPHRASE);
    await expect(
      vault.withSecret(unlocked, first.id, "openai", async (secret) => secret)
    ).resolves.toBe(SECRET);
  });

  it("rejects locked and expired sessions", async () => {
    const { vault, advance } = setup();
    const session = await vault.setup(PASSPHRASE, { autoLockMs: 1_000 });
    const { first } = await createEntries(vault, session);

    advance(1_000);
    expect(session.isUnlocked(NOW + 1_000)).toBe(false);
    await expect(vault.list(session)).rejects.toMatchObject({
      code: "vault_session_expired",
    });

    const unlocked = await vault.unlock(PASSPHRASE, { autoLockMs: 1_000 });
    unlocked.lock();
    await expect(vault.list(unlocked)).rejects.toMatchObject({
      code: "vault_locked",
    });
    await expect(
      vault.create(unlocked, {
        providerId: "openai",
        accountLabel: "Work",
        secret: SECRET,
      })
    ).rejects.toMatchObject({ code: "vault_locked" });
    await expect(
      vault.update(unlocked, first.id, { accountLabel: "Work" })
    ).rejects.toMatchObject({ code: "vault_locked" });
    await expect(vault.remove(unlocked, first.id)).rejects.toMatchObject({
      code: "vault_locked",
    });
    await expect(
      vault.withSecret(unlocked, first.id, "openai", async (secret) => secret)
    ).rejects.toMatchObject({ code: "vault_locked" });
  });

  it("does not serialize plaintext secrets", async () => {
    const { vault } = setup();
    const session = await vault.setup(PASSPHRASE);
    await vault.create(session, {
      providerId: "openai",
      accountLabel: "Work",
      secret: SECRET,
    });
    const json = JSON.stringify(await vault.get());

    expect(json).not.toContain(SECRET);
  });
});
