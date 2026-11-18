import {
  createCredentialVault,
  type CredentialVault,
  type CredentialVaultSession,
  type CredentialVaultStore,
} from "@opennest/credential-vault";
import { randomId } from "@opennest/crypto";

import { createDexieCredentialVaultStore } from "./dexie-store";
import { CredentialRuntimeError } from "./errors";
import {
  createSessionCredentialStore,
  type SessionCredentialMetadata,
  type SessionCredentialStore,
} from "./session-store";

export interface CredentialHandle {
  readonly kind: "session" | "vault";
  readonly id: string;
  readonly providerId: string;
}

export interface CredentialRuntime {
  readonly session: SessionCredentialStore;
  readonly vault: CredentialVault;
  createSessionCredential(input: {
    providerId: string;
    accountLabel: string;
    secret: string;
  }): Promise<SessionCredentialMetadata>;
  setupVault(passphrase: string): Promise<void>;
  unlockVault(passphrase: string): Promise<void>;
  getVaultSession(): CredentialVaultSession | null;
  lockVault(): void;
  resolve(handle: CredentialHandle): Promise<string>;
  clearAllData(): Promise<void>;
  dispose(): Promise<void>;
}

export interface CredentialRuntimeStore extends CredentialVaultStore {
  init?: () => Promise<void>;
  close?: () => Promise<void>;
}

export interface CreateCredentialRuntimeInput {
  store?: CredentialRuntimeStore;
  now?: () => number;
  generateId?: () => string;
}

export async function createCredentialRuntime(
  options: CreateCredentialRuntimeInput = {}
): Promise<CredentialRuntime> {
  const now = options.now ?? (() => Date.now());
  const generateId = options.generateId ?? (() => randomId("credential"));
  const store = options.store ?? createDexieCredentialVaultStore();

  await store.init?.();

  const vault = createCredentialVault({ store, now });
  const session = createSessionCredentialStore({ now, generateId });
  let vaultSession: CredentialVaultSession | null = null;
  let disposed = false;

  function assertActive(): void {
    if (disposed) {
      throw new CredentialRuntimeError(
        "runtime_disposed",
        "The credential runtime is disposed."
      );
    }
  }

  function lockCurrentSession(): void {
    if (vaultSession !== null) {
      vaultSession.lock();
      vaultSession = null;
    }
  }

  function replaceSession(next: CredentialVaultSession): void {
    lockCurrentSession();
    vaultSession = next;
  }

  function currentSession(): CredentialVaultSession | null {
    if (vaultSession === null) {
      return null;
    }

    if (!vaultSession.isUnlocked(now())) {
      lockCurrentSession();
      return null;
    }

    return vaultSession;
  }

  return {
    session,
    vault,
    async createSessionCredential(input) {
      assertActive();
      return session.put(input);
    },
    async setupVault(passphrase) {
      assertActive();
      replaceSession(await vault.setup(passphrase));
    },
    async unlockVault(passphrase) {
      assertActive();
      replaceSession(await vault.unlock(passphrase));
    },
    getVaultSession() {
      return currentSession();
    },
    lockVault() {
      lockCurrentSession();
    },
    async resolve(handle) {
      assertActive();

      switch (handle.kind) {
        case "session":
          return session.withSecret(
            handle.id,
            handle.providerId,
            async (secret) => secret
          );
        case "vault": {
          const unlocked = currentSession();

          if (unlocked === null) {
            throw new CredentialRuntimeError(
              "vault_locked",
              "Unlock the credential vault to use this credential."
            );
          }

          return vault.withSecret(
            unlocked,
            handle.id,
            handle.providerId,
            async (secret) => secret
          );
        }
        default:
          throw new CredentialRuntimeError(
            "invalid_handle",
            "The credential handle is not valid."
          );
      }
    },
    async clearAllData() {
      assertActive();
      session.clear();
      lockCurrentSession();
      await vault.delete();
    },
    async dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      session.clear();
      lockCurrentSession();
      await store.close?.();
    },
  };
}
