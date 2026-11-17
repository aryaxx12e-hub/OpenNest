import { describe, expect, it } from "vitest";

import {
  MAX_UNLOCK_ATTEMPTS,
  UNLOCK_RETRY_MS,
  createKeyring,
  createMemoryKeyringStore,
} from "../index";
import type { KeyringRecordV1 } from "../index";

const PASSPHRASE = "correct horse battery staple";
const NEXT_PASSPHRASE = "another long passphrase";

function setup(now?: () => number) {
  const store = createMemoryKeyringStore();
  const keyring = createKeyring({
    store,
    workspaceId: "workspace-1",
    now,
  });
  return { store, keyring };
}

async function invalidRecoveryKey(): Promise<string> {
  return "ONRK1-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-00";
}

describe("keyring", () => {
  it("sets up a workspace and unlocks with the passphrase", async () => {
    const { keyring } = setup();

    const created = await keyring.setup({ passphrase: PASSPHRASE });

    expect(created.recoveryKey).toMatch(/^ONRK1-/);
    expect(created.record).toMatchObject({
      version: 1,
      workspaceId: "workspace-1",
      state: "active",
      failedAttempts: 0,
      retryAfter: null,
      pending: null,
    });
    expect(created.context.workspaceId).toBe("workspace-1");
    expect(created.context.keyId).toBe(created.record.activeKid);

    const unlocked = await keyring.unlock(PASSPHRASE);
    expect(unlocked.workspaceId).toBe("workspace-1");
    expect(unlocked.keyId).toBe(created.record.activeKid);
    await expect(keyring.setup({ passphrase: PASSPHRASE })).rejects.toMatchObject({
      code: "already_exists",
    });
  });

  it("rejects a wrong passphrase and resets the failure count after success", async () => {
    const { keyring } = setup();
    await keyring.setup({ passphrase: PASSPHRASE });

    await expect(keyring.unlock("wrong")).rejects.toMatchObject({
      code: "authentication_failed",
    });
    expect((await keyring.get())?.failedAttempts).toBe(1);

    await expect(keyring.unlock(PASSPHRASE)).resolves.toBeDefined();
    expect((await keyring.get())?.failedAttempts).toBe(0);
    expect((await keyring.get())?.retryAfter).toBeNull();
  });

  it("rate limits repeated failures and unlocks after the retry window", async () => {
    let now = 1_000_000;
    const { keyring } = setup(() => now);
    await keyring.setup({ passphrase: PASSPHRASE });

    for (let attempt = 1; attempt < MAX_UNLOCK_ATTEMPTS; attempt += 1) {
      await expect(keyring.unlock("wrong")).rejects.toMatchObject({
        code: "authentication_failed",
      });
    }
    await expect(keyring.unlock("wrong")).rejects.toMatchObject({ code: "rate_limited" });
    expect((await keyring.get())?.retryAfter).toBe(now + UNLOCK_RETRY_MS);

    await expect(keyring.unlock(PASSPHRASE)).rejects.toMatchObject({
      code: "rate_limited",
    });

    now += UNLOCK_RETRY_MS;
    await expect(keyring.unlock(PASSPHRASE)).resolves.toBeDefined();
    expect((await keyring.get())?.failedAttempts).toBe(0);
    expect((await keyring.get())?.retryAfter).toBeNull();
  });

  it("unlocks with the recovery key and keeps recovery working after a passphrase change", async () => {
    const { keyring } = setup();
    const created = await keyring.setup({ passphrase: PASSPHRASE });

    const recovered = await keyring.unlockWithRecoveryKey(created.recoveryKey);
    expect(recovered.keyId).toBe(created.record.activeKid);

    await expect(
      keyring.unlockWithRecoveryKey(await invalidRecoveryKey())
    ).rejects.toMatchObject({ code: "invalid_recovery_key" });

    const changed = await keyring.changePassphrase(PASSPHRASE, NEXT_PASSPHRASE);
    expect(changed.record.kdf.salt).not.toBe(created.record.kdf.salt);
    expect(changed.record.activeKid).toBe(created.record.activeKid);
    expect(changed.context.keyId).toBe(created.record.activeKid);
    await expect(keyring.unlock(PASSPHRASE)).rejects.toMatchObject({
      code: "authentication_failed",
    });
    await expect(keyring.unlock(NEXT_PASSPHRASE)).resolves.toBeDefined();
    await expect(
      keyring.unlockWithRecoveryKey(created.recoveryKey)
    ).resolves.toBeDefined();
  });

  it("stages, aborts, and commits pending rotation state", async () => {
    const { keyring } = setup();
    const created = await keyring.setup({ passphrase: PASSPHRASE });

    const staged = await keyring.stageRotation(PASSPHRASE);
    expect(staged.pending).not.toBeNull();
    expect(staged.pending?.kid).not.toBe(staged.activeKid);
    expect(staged.pending?.wrappedDek).toBeDefined();

    const aborted = await keyring.abortRotation();
    expect(aborted.pending).toBeNull();
    expect(aborted.activeKid).toBe(created.record.activeKid);

    const stagedAgain = await keyring.stageRotation(PASSPHRASE);
    const committed = await keyring.commitRotation();
    expect(committed.pending).toBeNull();
    expect(committed.activeKid).toBe(stagedAgain.pending?.kid);

    const unlocked = await keyring.unlock(PASSPHRASE);
    expect(unlocked.keyId).toBe(committed.activeKid);
    await expect(
      keyring.unlockWithRecoveryKey(created.recoveryKey)
    ).resolves.toBeDefined();
  });

  it("unlocks a pending rotation with the recovery key", async () => {
    const { keyring } = setup();
    const created = await keyring.setup({ passphrase: PASSPHRASE });
    const staged = await keyring.stageRotation(PASSPHRASE);

    const pending = await keyring.unlockPendingWithRecoveryKey(created.recoveryKey);
    expect(pending.keyId).toBe(staged.pending?.kid);
    expect(pending.workspaceId).toBe("workspace-1");
  });

  it("rejects a corrupted record and supports deletion", async () => {
    const { keyring, store } = setup();
    const created = await keyring.setup({ passphrase: PASSPHRASE });

    await store.put({ ...created.record, version: 2 } as unknown as KeyringRecordV1);
    await expect(keyring.unlock(PASSPHRASE)).rejects.toMatchObject({
      code: "keyring_corrupt",
    });

    await store.put(created.record);
    await keyring.delete();
    expect(await store.get("workspace-1")).toBeNull();
    await expect(keyring.unlock(PASSPHRASE)).rejects.toMatchObject({
      code: "keyring_missing",
    });
  });

  it("rejects setup without a passphrase and rotation without pending state", async () => {
    const { keyring } = setup();

    await expect(keyring.setup({ passphrase: "" })).rejects.toMatchObject({
      code: "invalid_passphrase",
    });
    await keyring.setup({ passphrase: PASSPHRASE });
    await expect(keyring.commitRotation()).rejects.toMatchObject({
      code: "no_pending_rotation",
    });
    await expect(keyring.abortRotation()).rejects.toMatchObject({
      code: "no_pending_rotation",
    });
  });
});
