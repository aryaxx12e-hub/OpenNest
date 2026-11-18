import {
  AES_KEY_BYTES,
  CryptoError,
  GCM_NONCE_BYTES,
  base64UrlDecode,
  base64UrlEncode,
  createKdfParameters,
  decodeUtf8,
  decryptAesGcm,
  deriveKekBytes,
  encryptAesGcm,
  importAesGcmKey,
  randomBytes,
  randomId,
  unwrapKeyBytes,
  utf8,
  wrapKeyBytes,
} from "@opennest/crypto";

import { entryKeyAad, entrySecretAad, vaultDekAad } from "./aad";
import { CredentialVaultError } from "./errors";
import { assertProviderId, parseVaultRecord } from "./record";
import {
  CREDENTIAL_VAULT_KEK_DOMAIN,
  DEFAULT_VAULT_AUTO_LOCK_MS,
  MAX_SECRET_BYTES,
  MAX_VAULT_ENTRIES,
  MAX_VAULT_UNLOCK_ATTEMPTS,
  MIN_VAULT_PASSPHRASE_LENGTH,
  VAULT_UNLOCK_RETRY_MS,
  type CreateCredentialVaultOptions,
  type CredentialVault,
  type CredentialVaultSession,
  type VaultEntryMetadata,
  type VaultEntryRecord,
  type VaultRecordV1,
} from "./types";

interface SessionState {
  readonly vaultId: string;
  readonly unlockedAt: number;
  expiresAt: number;
  readonly autoLockMs: number;
  dek: CryptoKey | null;
  kek: CryptoKey | null;
  locked: boolean;
}

export function createCredentialVault(
  options: CreateCredentialVaultOptions
): CredentialVault {
  const store = options.store;
  const now = options.now ?? (() => Date.now());
  const states = new WeakMap<CredentialVaultSession, SessionState>();
  const sessions = new Map<string, Set<CredentialVaultSession>>();

  async function getRecord(): Promise<VaultRecordV1 | null> {
    const raw = await store.get();
    return raw === null ? null : parseVaultRecord(raw);
  }

  async function requireRecord(): Promise<VaultRecordV1> {
    const record = await getRecord();

    if (record === null) {
      throw new CredentialVaultError(
        "vault_missing",
        "The credential vault does not exist."
      );
    }

    return record;
  }

  async function saveRecord(record: VaultRecordV1): Promise<VaultRecordV1> {
    const parsed = parseVaultRecord(record);
    await store.put(parsed);
    return parsed;
  }

  async function enforceRateLimit(record: VaultRecordV1): Promise<VaultRecordV1> {
    if (record.retryAfter === null) {
      return record;
    }

    if (now() < record.retryAfter) {
      throw new CredentialVaultError(
        "rate_limited",
        "Too many unlock attempts. Try again later."
      );
    }

    return saveRecord({
      ...record,
      failedAttempts: 0,
      retryAfter: null,
      updatedAt: now(),
    });
  }

  async function clearFailures(record: VaultRecordV1): Promise<VaultRecordV1> {
    if (record.failedAttempts === 0 && record.retryAfter === null) {
      return record;
    }

    return saveRecord({
      ...record,
      failedAttempts: 0,
      retryAfter: null,
      updatedAt: now(),
    });
  }

  async function recordFailure(record: VaultRecordV1): Promise<never> {
    const at = now();
    const failedAttempts = record.failedAttempts + 1;
    const retryAfter =
      failedAttempts >= MAX_VAULT_UNLOCK_ATTEMPTS ? at + VAULT_UNLOCK_RETRY_MS : null;
    const next = await saveRecord({
      ...record,
      failedAttempts,
      retryAfter,
      updatedAt: at,
    });

    if (next.retryAfter !== null && at < next.retryAfter) {
      throw new CredentialVaultError(
        "rate_limited",
        "Too many unlock attempts. Try again later."
      );
    }

    throw new CredentialVaultError(
      "authentication_failed",
      "The vault passphrase is incorrect."
    );
  }

  async function openWithPassphrase(passphrase: string): Promise<{
    record: VaultRecordV1;
    kek: CryptoKey;
    dekBytes: Uint8Array;
  }> {
    assertPassphrase(passphrase);

    let record = await enforceRateLimit(await requireRecord());

    try {
      const kek = await deriveVaultKek(passphrase, record);
      const dekBytes = await unwrapKeyBytes(
        kek,
        record.wrappedDek,
        vaultDekAad(record.vaultId, record.activeKid)
      );
      record = await clearFailures(record);

      return { record, kek, dekBytes };
    } catch (error) {
      if (error instanceof CryptoError && error.code === "authentication_failed") {
        return recordFailure(record);
      }

      if (error instanceof CryptoError && error.code === "invalid_kdf_parameters") {
        throw new CredentialVaultError(
          "vault_corrupt",
          "The vault KDF parameters are invalid.",
          { cause: error }
        );
      }

      throw error;
    }
  }

  function trackSession(session: CredentialVaultSession, state: SessionState): void {
    states.set(session, state);
    const existing = sessions.get(state.vaultId) ?? new Set<CredentialVaultSession>();
    existing.add(session);
    sessions.set(state.vaultId, existing);
  }

  async function createSession(
    record: VaultRecordV1,
    kek: CryptoKey,
    dekBytes: Uint8Array,
    autoLockMs: number
  ): Promise<CredentialVaultSession> {
    const at = now();
    const state: SessionState = {
      vaultId: record.vaultId,
      unlockedAt: at,
      expiresAt: at + autoLockMs,
      autoLockMs,
      dek: await importAesGcmKey(dekBytes),
      kek,
      locked: false,
    };
    const session: CredentialVaultSession = {
      get vaultId() {
        return state.vaultId;
      },
      get unlockedAt() {
        return state.unlockedAt;
      },
      get expiresAt() {
        return state.locked ? 0 : state.expiresAt;
      },
      isUnlocked(at) {
        return !state.locked && state.dek !== null && at < state.expiresAt;
      },
      touch(at) {
        touchSession(state, at);
      },
      lock() {
        lockSession(state);
      },
    };

    trackSession(session, state);

    return session;
  }

  function assertSession(
    session: CredentialVaultSession,
    record: VaultRecordV1
  ): { state: SessionState; dek: CryptoKey; kek: CryptoKey } {
    const state = states.get(session);

    if (state === undefined || state.vaultId !== record.vaultId) {
      throw new CredentialVaultError("vault_locked", "The credential vault is locked.");
    }

    const { dek, kek } = state;

    if (state.locked || dek === null || kek === null) {
      throw new CredentialVaultError("vault_locked", "The credential vault is locked.");
    }

    if (now() >= state.expiresAt) {
      lockSession(state);
      throw new CredentialVaultError(
        "vault_session_expired",
        "The credential vault session has expired."
      );
    }

    state.expiresAt = now() + state.autoLockMs;

    return { state, dek, kek };
  }

  function updateSessionKek(vaultId: string, kek: CryptoKey): void {
    for (const session of sessions.get(vaultId) ?? []) {
      const state = states.get(session);

      if (state !== undefined && !state.locked) {
        state.kek = kek;
      }
    }
  }

  function updateSessionDek(vaultId: string, dek: CryptoKey): void {
    for (const session of sessions.get(vaultId) ?? []) {
      const state = states.get(session);

      if (state !== undefined && !state.locked) {
        state.dek = dek;
      }
    }
  }

  async function encryptEntry(input: {
    vaultId: string;
    activeKid: string;
    id: string;
    providerId: string;
    accountLabel: string;
    secret: string;
    dek: CryptoKey;
    createdAt: number;
    updatedAt: number;
  }): Promise<VaultEntryRecord> {
    const cekBytes = randomBytes(AES_KEY_BYTES);
    const aad = {
      vaultId: input.vaultId,
      activeKid: input.activeKid,
      entryId: input.id,
      providerId: input.providerId,
      accountLabel: input.accountLabel,
      entryVersion: 1 as const,
    };
    const wrappedCek = await wrapKeyBytes(input.dek, cekBytes, entryKeyAad(aad));
    const cek = await importAesGcmKey(cekBytes);
    const iv = randomBytes(GCM_NONCE_BYTES);
    const sealed = await encryptAesGcm(cek, iv, entrySecretAad(aad), utf8(input.secret));

    return {
      id: input.id,
      providerId: input.providerId,
      accountLabel: input.accountLabel,
      version: 1,
      kid: input.activeKid,
      wrappedCek,
      iv: base64UrlEncode(iv),
      ciphertext: base64UrlEncode(sealed.ciphertext),
      tag: base64UrlEncode(sealed.tag),
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    };
  }

  async function decryptEntry(
    record: VaultRecordV1,
    entry: VaultEntryRecord,
    dek: CryptoKey
  ): Promise<string> {
    if (entry.kid !== record.activeKid) {
      throw new CredentialVaultError(
        "vault_corrupt",
        "The credential entry key ID does not match the vault."
      );
    }

    const aad = {
      vaultId: record.vaultId,
      activeKid: record.activeKid,
      entryId: entry.id,
      providerId: entry.providerId,
      accountLabel: entry.accountLabel,
      entryVersion: 1 as const,
    };

    try {
      const cekBytes = await unwrapKeyBytes(dek, entry.wrappedCek, entryKeyAad(aad));
      const cek = await importAesGcmKey(cekBytes);
      const plaintext = await decryptAesGcm(
        cek,
        base64UrlDecode(entry.iv),
        entrySecretAad(aad),
        {
          ciphertext: base64UrlDecode(entry.ciphertext),
          tag: base64UrlDecode(entry.tag),
        }
      );

      return decodeUtf8(plaintext);
    } catch (error) {
      if (error instanceof CryptoError) {
        throw new CredentialVaultError(
          "authentication_failed",
          "The credential entry could not be authenticated.",
          { cause: error }
        );
      }

      throw error;
    }
  }

  return {
    get: getRecord,

    async hasVault() {
      return (await getRecord()) !== null;
    },

    async setup(passphrase, setupOptions) {
      if ((await store.get()) !== null) {
        throw new CredentialVaultError(
          "vault_exists",
          "A credential vault already exists."
        );
      }

      assertNewPassphrase(passphrase);
      const autoLockMs = resolveAutoLock(setupOptions?.autoLockMs);
      const kdf = createKdfParameters(CREDENTIAL_VAULT_KEK_DOMAIN);
      const kek = await deriveVaultKek(passphrase, { kdf });
      const dekBytes = randomBytes(AES_KEY_BYTES);
      const vaultId = randomId("vault");
      const activeKid = randomId("vk");
      const at = now();
      const record = await saveRecord({
        version: 1,
        vaultId,
        activeKid,
        kdf,
        wrappedDek: await wrapKeyBytes(kek, dekBytes, vaultDekAad(vaultId, activeKid)),
        entries: [],
        failedAttempts: 0,
        retryAfter: null,
        createdAt: at,
        updatedAt: at,
      });

      return createSession(record, kek, dekBytes, autoLockMs);
    },

    async unlock(passphrase, unlockOptions) {
      const autoLockMs = resolveAutoLock(unlockOptions?.autoLockMs);
      const { record, kek, dekBytes } = await openWithPassphrase(passphrase);

      return createSession(record, kek, dekBytes, autoLockMs);
    },

    async changePassphrase(session, currentPassphrase, nextPassphrase) {
      assertNewPassphrase(nextPassphrase);
      const opened = await openWithPassphrase(currentPassphrase);
      assertSession(session, opened.record);

      const nextKdf = createKdfParameters(CREDENTIAL_VAULT_KEK_DOMAIN);
      const nextKek = await deriveVaultKek(nextPassphrase, { kdf: nextKdf });
      const next = await saveRecord({
        ...opened.record,
        kdf: nextKdf,
        wrappedDek: await wrapKeyBytes(
          nextKek,
          opened.dekBytes,
          vaultDekAad(opened.record.vaultId, opened.record.activeKid)
        ),
        updatedAt: now(),
      });

      updateSessionKek(next.vaultId, nextKek);
    },

    async list(session) {
      const record = await requireRecord();
      assertSession(session, record);

      return record.entries.map(toMetadata);
    },

    async create(session, input) {
      const record = await requireRecord();
      const { dek } = assertSession(session, record);
      assertProviderId(input.providerId);
      assertAccountLabel(input.accountLabel);
      assertSecret(input.secret);

      if (record.entries.length >= MAX_VAULT_ENTRIES) {
        throw new CredentialVaultError(
          "vault_full",
          `The vault can hold at most ${MAX_VAULT_ENTRIES} entries.`
        );
      }

      const at = now();
      const entry = await encryptEntry({
        vaultId: record.vaultId,
        activeKid: record.activeKid,
        id: randomId("entry"),
        providerId: input.providerId,
        accountLabel: input.accountLabel,
        secret: input.secret,
        dek,
        createdAt: at,
        updatedAt: at,
      });
      await saveRecord({
        ...record,
        entries: [...record.entries, entry],
        updatedAt: at,
      });

      return toMetadata(entry);
    },

    async update(session, entryId, input) {
      const record = await requireRecord();
      const { dek } = assertSession(session, record);
      const index = record.entries.findIndex((entry) => entry.id === entryId);

      if (index === -1) {
        throw new CredentialVaultError(
          "entry_not_found",
          "The credential entry does not exist."
        );
      }

      const current = record.entries[index];

      if (current === undefined) {
        throw new CredentialVaultError(
          "entry_not_found",
          "The credential entry does not exist."
        );
      }

      if (input.accountLabel === undefined && input.secret === undefined) {
        return toMetadata(current);
      }

      if (input.accountLabel !== undefined) {
        assertAccountLabel(input.accountLabel);
      }

      if (input.secret !== undefined) {
        assertSecret(input.secret);
      }

      const accountLabel = input.accountLabel ?? current.accountLabel;
      const secret = input.secret ?? (await decryptEntry(record, current, dek));
      const at = now();
      const next = await encryptEntry({
        vaultId: record.vaultId,
        activeKid: record.activeKid,
        id: current.id,
        providerId: current.providerId,
        accountLabel,
        secret,
        dek,
        createdAt: current.createdAt,
        updatedAt: at,
      });
      const entries = [...record.entries];
      entries[index] = next;
      await saveRecord({
        ...record,
        entries,
        updatedAt: at,
      });

      return toMetadata(next);
    },

    async remove(session, entryId) {
      const record = await requireRecord();
      assertSession(session, record);

      if (!record.entries.some((entry) => entry.id === entryId)) {
        throw new CredentialVaultError(
          "entry_not_found",
          "The credential entry does not exist."
        );
      }

      await saveRecord({
        ...record,
        entries: record.entries.filter((entry) => entry.id !== entryId),
        updatedAt: now(),
      });
    },

    async withSecret(session, entryId, providerId, operation) {
      const record = await requireRecord();
      const { dek } = assertSession(session, record);
      assertProviderId(providerId);
      const entry = record.entries.find((candidate) => candidate.id === entryId);

      if (entry === undefined) {
        throw new CredentialVaultError(
          "entry_not_found",
          "The credential entry does not exist."
        );
      }

      if (entry.providerId !== providerId) {
        throw new CredentialVaultError(
          "provider_mismatch",
          "The credential entry belongs to a different provider."
        );
      }

      return operation(await decryptEntry(record, entry, dek));
    },

    async rotate(session) {
      const record = await requireRecord();
      const { dek, kek } = assertSession(session, record);
      const at = now();
      const nextDekBytes = randomBytes(AES_KEY_BYTES);
      const nextDek = await importAesGcmKey(nextDekBytes);
      const nextActiveKid = randomId("vk");
      const entries: VaultEntryRecord[] = [];

      for (const entry of record.entries) {
        const secret = await decryptEntry(record, entry, dek);
        entries.push(
          await encryptEntry({
            vaultId: record.vaultId,
            activeKid: nextActiveKid,
            id: entry.id,
            providerId: entry.providerId,
            accountLabel: entry.accountLabel,
            secret,
            dek: nextDek,
            createdAt: entry.createdAt,
            updatedAt: at,
          })
        );
      }

      await saveRecord({
        ...record,
        activeKid: nextActiveKid,
        wrappedDek: await wrapKeyBytes(
          kek,
          nextDekBytes,
          vaultDekAad(record.vaultId, nextActiveKid)
        ),
        entries,
        updatedAt: at,
      });
      updateSessionDek(record.vaultId, nextDek);
    },

    async delete() {
      for (const sessionSet of sessions.values()) {
        for (const session of sessionSet) {
          const state = states.get(session);

          if (state !== undefined) {
            lockSession(state);
          }
        }
      }

      await store.delete();
    },
  };
}

function toMetadata(entry: VaultEntryRecord): VaultEntryMetadata {
  return {
    id: entry.id,
    providerId: entry.providerId,
    accountLabel: entry.accountLabel,
    version: 1,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function assertAccountLabel(value: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 120) {
    throw new CredentialVaultError(
      "invalid_account_label",
      "The account label must be between 1 and 120 characters."
    );
  }
}

function assertSecret(value: string): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    utf8(value).length > MAX_SECRET_BYTES
  ) {
    throw new CredentialVaultError(
      "invalid_secret",
      `The secret must be between 1 and ${MAX_SECRET_BYTES} bytes.`
    );
  }
}

async function deriveVaultKek(
  passphrase: string,
  record: { kdf: VaultRecordV1["kdf"] }
): Promise<CryptoKey> {
  const keyBytes = await deriveKekBytes(
    passphrase,
    base64UrlDecode(record.kdf.salt),
    record.kdf.iterations,
    record.kdf.domain
  );

  return importAesGcmKey(keyBytes);
}

function assertPassphrase(passphrase: string): void {
  if (typeof passphrase !== "string" || passphrase.length === 0) {
    throw new CredentialVaultError("invalid_passphrase", "The passphrase is empty.");
  }
}

function assertNewPassphrase(passphrase: string): void {
  if (typeof passphrase !== "string" || passphrase.length < MIN_VAULT_PASSPHRASE_LENGTH) {
    throw new CredentialVaultError(
      "invalid_passphrase",
      `The passphrase must be at least ${MIN_VAULT_PASSPHRASE_LENGTH} characters.`
    );
  }
}

function resolveAutoLock(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_VAULT_AUTO_LOCK_MS;
  }

  if (!Number.isFinite(value) || value <= 0) {
    throw new CredentialVaultError(
      "invalid_auto_lock",
      "The auto-lock interval must be positive."
    );
  }

  return value;
}

function touchSession(state: SessionState, at: number): void {
  if (state.locked || state.dek === null) {
    throw new CredentialVaultError("vault_locked", "The credential vault is locked.");
  }

  if (at >= state.expiresAt) {
    lockSession(state);
    throw new CredentialVaultError(
      "vault_session_expired",
      "The credential vault session has expired."
    );
  }

  state.expiresAt = at + state.autoLockMs;
}

function lockSession(state: SessionState): void {
  state.dek = null;
  state.kek = null;
  state.locked = true;
  state.expiresAt = 0;
}
