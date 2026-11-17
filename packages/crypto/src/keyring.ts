import {
  AES_GCM_ALGORITHM,
  importAesGcmKey,
  parseWrappedKey,
  unwrapKeyBytes,
  wrapKeyBytes,
} from "./aes";
import { utf8 } from "./bytes";
import { canonicalJson } from "./canonical-json";
import { CryptoError } from "./errors";
import type { WrappedKey } from "./aes";
import type { WorkspaceCryptoContext } from "./envelope";
import {
  WORKSPACE_KEK_DOMAIN,
  createKdfParameters,
  deriveWorkspaceKek,
  parseKdfParameters,
} from "./kdf";
import type { KdfParameters } from "./kdf";
import { randomBytes, randomId } from "./random";
import { decodeRecoveryKey, encodeRecoveryKey } from "./recovery-key";
import type { KeyringStore } from "./keyring-store";

export const MAX_UNLOCK_ATTEMPTS = 5;
export const UNLOCK_RETRY_MS = 30_000;

const KEY_BYTES = 32;
const ENCRYPTION_STATES = new Set(["preparing", "committing", "cleanup", "active"]);

export type EncryptionState = "preparing" | "committing" | "cleanup" | "active";

export interface RecoveryKeySlot {
  kid: string;
  wrappedKek: WrappedKey;
  wrappedDek: WrappedKey;
}

export interface PendingRotation {
  kid: string;
  wrappedDek: WrappedKey;
  wrappedDekByRecovery: WrappedKey;
  createdAt: number;
}

export interface KeyringRecordV1 {
  version: 1;
  workspaceId: string;
  activeKid: string;
  kdf: KdfParameters;
  wrappedDek: WrappedKey;
  recovery: RecoveryKeySlot;
  state: EncryptionState;
  pending: PendingRotation | null;
  failedAttempts: number;
  retryAfter: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface KeyringSetupResult {
  record: KeyringRecordV1;
  recoveryKey: string;
  context: WorkspaceCryptoContext;
}

export interface KeyringPassphraseChangeResult {
  record: KeyringRecordV1;
  context: WorkspaceCryptoContext;
}

export interface Keyring {
  readonly workspaceId: string;
  get(): Promise<KeyringRecordV1 | null>;
  setup(input: {
    passphrase: string;
    recoveryKey?: string;
    state?: EncryptionState;
  }): Promise<KeyringSetupResult>;
  unlock(passphrase: string): Promise<WorkspaceCryptoContext>;
  unlockWithRecoveryKey(recoveryKey: string): Promise<WorkspaceCryptoContext>;
  unlockPending(passphrase: string): Promise<WorkspaceCryptoContext>;
  unlockPendingWithRecoveryKey(recoveryKey: string): Promise<WorkspaceCryptoContext>;
  changePassphrase(
    currentPassphrase: string,
    nextPassphrase: string
  ): Promise<KeyringPassphraseChangeResult>;
  setState(state: EncryptionState): Promise<KeyringRecordV1>;
  stageRotation(passphrase: string): Promise<KeyringRecordV1>;
  commitRotation(): Promise<KeyringRecordV1>;
  abortRotation(): Promise<KeyringRecordV1>;
  delete(): Promise<void>;
}

export interface CreateKeyringOptions {
  store: KeyringStore;
  workspaceId: string;
  now?: () => number;
}

export function createKeyring(options: CreateKeyringOptions): Keyring {
  if (typeof options.workspaceId !== "string" || options.workspaceId.length === 0) {
    throw new CryptoError("invalid_workspace_id", "Workspace ID is missing");
  }

  const workspaceId = options.workspaceId;
  const store = options.store;
  const now = options.now ?? (() => Date.now());

  async function getRecord(): Promise<KeyringRecordV1> {
    const raw = await store.get(workspaceId);

    if (raw === null) {
      throw new CryptoError("keyring_missing", "The workspace keyring does not exist");
    }

    const record = parseKeyringRecord(raw);

    if (record.workspaceId !== workspaceId) {
      throw new CryptoError("keyring_corrupt", "Keyring workspace ID does not match");
    }

    return record;
  }

  async function saveRecord(record: KeyringRecordV1): Promise<KeyringRecordV1> {
    const parsed = parseKeyringRecord(record);
    await store.put(parsed);
    return parsed;
  }

  async function enforceRateLimit(record: KeyringRecordV1): Promise<KeyringRecordV1> {
    if (record.retryAfter === null) {
      return record;
    }

    if (now() < record.retryAfter) {
      throw new CryptoError("rate_limited", "Too many unlock attempts");
    }

    return saveRecord({
      ...record,
      failedAttempts: 0,
      retryAfter: null,
      updatedAt: now(),
    });
  }

  async function clearFailures(record: KeyringRecordV1): Promise<KeyringRecordV1> {
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

  async function recordFailure(record: KeyringRecordV1): Promise<never> {
    const at = now();
    const failedAttempts = record.failedAttempts + 1;
    const retryAfter =
      failedAttempts >= MAX_UNLOCK_ATTEMPTS ? at + UNLOCK_RETRY_MS : record.retryAfter;
    const next = await saveRecord({
      ...record,
      failedAttempts,
      retryAfter,
      updatedAt: at,
    });

    if (next.retryAfter !== null && at < next.retryAfter) {
      throw new CryptoError("rate_limited", "Too many unlock attempts");
    }

    throw new CryptoError(
      "authentication_failed",
      "Passphrase or recovery key is incorrect"
    );
  }

  async function openWithPassphrase(
    passphrase: string
  ): Promise<{ record: KeyringRecordV1; kek: CryptoKey; dekBytes: Uint8Array }> {
    assertPassphrase(passphrase);

    let record = await enforceRateLimit(await getRecord());

    try {
      const kek = await deriveWorkspaceKek(passphrase, record.kdf);
      const dekBytes = await unwrapKeyBytes(
        kek,
        record.wrappedDek,
        workspaceDekAad(record.workspaceId, record.activeKid)
      );
      record = await clearFailures(record);

      return { record, kek, dekBytes };
    } catch (error) {
      if (isAuthenticationFailure(error)) {
        return recordFailure(record);
      }

      if (error instanceof CryptoError && error.code === "invalid_kdf_parameters") {
        throw new CryptoError("keyring_corrupt", "Keyring KDF parameters are invalid", {
          cause: error,
        });
      }

      throw error;
    }
  }

  async function openWithRecoveryKey(recoveryKey: string): Promise<{
    record: KeyringRecordV1;
    dekBytes: Uint8Array;
    recoveryKek: CryptoKey;
  }> {
    const recoveryBytes = decodeRecoveryKey(recoveryKey);
    const recoveryKek = await importAesGcmKey(recoveryBytes);
    let record = await enforceRateLimit(await getRecord());

    try {
      const dekBytes = await unwrapKeyBytes(
        recoveryKek,
        record.recovery.wrappedDek,
        recoveryDekAad(record.workspaceId, record.recovery.kid)
      );
      record = await clearFailures(record);

      return { record, dekBytes, recoveryKek };
    } catch (error) {
      if (isAuthenticationFailure(error)) {
        return recordFailure(record);
      }

      throw error;
    }
  }

  async function unwrapRecoveryBytes(
    record: KeyringRecordV1,
    kek: CryptoKey
  ): Promise<Uint8Array> {
    try {
      return await unwrapKeyBytes(
        kek,
        record.recovery.wrappedKek,
        recoveryKekAad(record.workspaceId, record.recovery.kid)
      );
    } catch (error) {
      throw new CryptoError("keyring_corrupt", "Recovery key slot is corrupt", {
        cause: error,
      });
    }
  }

  return {
    workspaceId,

    async get() {
      const raw = await store.get(workspaceId);

      if (raw === null) {
        return null;
      }

      const record = parseKeyringRecord(raw);

      if (record.workspaceId !== workspaceId) {
        throw new CryptoError("keyring_corrupt", "Keyring workspace ID does not match");
      }

      return record;
    },

    async setup(input) {
      if ((await store.get(workspaceId)) !== null) {
        throw new CryptoError(
          "already_exists",
          "A keyring already exists for this workspace"
        );
      }

      assertPassphrase(input.passphrase);

      const recoveryBytes =
        input.recoveryKey === undefined
          ? randomBytes(KEY_BYTES)
          : decodeRecoveryKey(input.recoveryKey);
      const recoveryKek = await importAesGcmKey(recoveryBytes);
      const kdf = createKdfParameters(WORKSPACE_KEK_DOMAIN);
      const kek = await deriveWorkspaceKek(input.passphrase, kdf);
      const dekBytes = randomBytes(KEY_BYTES);
      const activeKid = randomId("wk");
      const recoveryKid = randomId("rk");
      const at = now();
      const record = await saveRecord({
        version: 1,
        workspaceId,
        activeKid,
        kdf,
        wrappedDek: await wrapKeyBytes(
          kek,
          dekBytes,
          workspaceDekAad(workspaceId, activeKid)
        ),
        recovery: {
          kid: recoveryKid,
          wrappedKek: await wrapKeyBytes(
            kek,
            recoveryBytes,
            recoveryKekAad(workspaceId, recoveryKid)
          ),
          wrappedDek: await wrapKeyBytes(
            recoveryKek,
            dekBytes,
            recoveryDekAad(workspaceId, recoveryKid)
          ),
        },
        state: input.state ?? "active",
        pending: null,
        failedAttempts: 0,
        retryAfter: null,
        createdAt: at,
        updatedAt: at,
      });

      return {
        record,
        recoveryKey: encodeRecoveryKey(recoveryBytes),
        context: {
          workspaceId,
          keyId: activeKid,
          dek: await importAesGcmKey(dekBytes),
        },
      };
    },

    async unlock(passphrase) {
      const { record, dekBytes } = await openWithPassphrase(passphrase);

      return {
        workspaceId,
        keyId: record.activeKid,
        dek: await importAesGcmKey(dekBytes),
      };
    },

    async unlockWithRecoveryKey(recoveryKey) {
      const { record, dekBytes } = await openWithRecoveryKey(recoveryKey);

      return {
        workspaceId,
        keyId: record.activeKid,
        dek: await importAesGcmKey(dekBytes),
      };
    },

    async unlockPendingWithRecoveryKey(recoveryKey) {
      const { record, recoveryKek } = await openWithRecoveryKey(recoveryKey);

      if (record.pending === null) {
        throw new CryptoError("no_pending_rotation", "No rotation is pending");
      }

      let dekBytes: Uint8Array;

      try {
        dekBytes = await unwrapKeyBytes(
          recoveryKek,
          record.pending.wrappedDekByRecovery,
          recoveryDekAad(workspaceId, record.recovery.kid)
        );
      } catch (error) {
        throw new CryptoError("keyring_corrupt", "Pending rotation key is corrupt", {
          cause: error,
        });
      }

      return {
        workspaceId,
        keyId: record.pending.kid,
        dek: await importAesGcmKey(dekBytes),
      };
    },

    async unlockPending(passphrase) {
      const { record, kek } = await openWithPassphrase(passphrase);

      if (record.pending === null) {
        throw new CryptoError("no_pending_rotation", "No rotation is pending");
      }

      let dekBytes: Uint8Array;

      try {
        dekBytes = await unwrapKeyBytes(
          kek,
          record.pending.wrappedDek,
          workspaceDekAad(workspaceId, record.pending.kid)
        );
      } catch (error) {
        throw new CryptoError("keyring_corrupt", "Pending rotation key is corrupt", {
          cause: error,
        });
      }

      return {
        workspaceId,
        keyId: record.pending.kid,
        dek: await importAesGcmKey(dekBytes),
      };
    },

    async setState(state) {
      const record = await getRecord();

      if (record.state === state) {
        return record;
      }

      return saveRecord({
        ...record,
        state,
        updatedAt: now(),
      });
    },

    async changePassphrase(currentPassphrase, nextPassphrase) {
      assertPassphrase(nextPassphrase);
      const { record, kek, dekBytes } = await openWithPassphrase(currentPassphrase);

      if (record.pending !== null) {
        throw new CryptoError(
          "pending_rotation",
          "Finish or abort the pending rotation before changing the passphrase"
        );
      }

      const recoveryBytes = await unwrapRecoveryBytes(record, kek);
      const nextKdf = createKdfParameters(WORKSPACE_KEK_DOMAIN);
      const nextKek = await deriveWorkspaceKek(nextPassphrase, nextKdf);
      const at = now();
      const next = await saveRecord({
        ...record,
        kdf: nextKdf,
        wrappedDek: await wrapKeyBytes(
          nextKek,
          dekBytes,
          workspaceDekAad(workspaceId, record.activeKid)
        ),
        recovery: {
          ...record.recovery,
          wrappedKek: await wrapKeyBytes(
            nextKek,
            recoveryBytes,
            recoveryKekAad(workspaceId, record.recovery.kid)
          ),
        },
        updatedAt: at,
      });

      return {
        record: next,
        context: {
          workspaceId,
          keyId: record.activeKid,
          dek: await importAesGcmKey(dekBytes),
        },
      };
    },

    async stageRotation(passphrase) {
      const { record, kek } = await openWithPassphrase(passphrase);

      if (record.pending !== null) {
        throw new CryptoError("pending_rotation", "A rotation is already pending");
      }

      const recoveryBytes = await unwrapRecoveryBytes(record, kek);
      const recoveryKek = await importAesGcmKey(recoveryBytes);
      const newDekBytes = randomBytes(KEY_BYTES);
      const newKid = randomId("wk");
      const at = now();
      const next = await saveRecord({
        ...record,
        pending: {
          kid: newKid,
          wrappedDek: await wrapKeyBytes(
            kek,
            newDekBytes,
            workspaceDekAad(workspaceId, newKid)
          ),
          wrappedDekByRecovery: await wrapKeyBytes(
            recoveryKek,
            newDekBytes,
            recoveryDekAad(workspaceId, record.recovery.kid)
          ),
          createdAt: at,
        },
        updatedAt: at,
      });

      return next;
    },

    async commitRotation() {
      const record = await getRecord();

      if (record.pending === null) {
        throw new CryptoError("no_pending_rotation", "No rotation is pending");
      }

      const next = await saveRecord({
        ...record,
        activeKid: record.pending.kid,
        wrappedDek: record.pending.wrappedDek,
        recovery: {
          ...record.recovery,
          wrappedDek: record.pending.wrappedDekByRecovery,
        },
        pending: null,
        updatedAt: now(),
      });

      return next;
    },

    async abortRotation() {
      const record = await getRecord();

      if (record.pending === null) {
        throw new CryptoError("no_pending_rotation", "No rotation is pending");
      }

      return saveRecord({
        ...record,
        pending: null,
        updatedAt: now(),
      });
    },

    async delete() {
      await store.delete(workspaceId);
    },
  };
}

export function parseKeyringRecord(value: unknown): KeyringRecordV1 {
  try {
    const record = requireObject(value, "Keyring record");

    if (record.version !== 1) {
      throw new CryptoError("keyring_corrupt", "Unsupported keyring version");
    }

    const workspaceId = requireString(record.workspaceId, "workspaceId");
    const activeKid = requireString(record.activeKid, "activeKid");
    const kdf = parseKdfParameters(record.kdf);
    const wrappedDek = parseStoredWrappedKey(record.wrappedDek, "wrappedDek");
    const recovery = requireObject(record.recovery, "recovery");
    const recoveryKid = requireString(recovery.kid, "recovery.kid");
    const wrappedKek = parseStoredWrappedKey(recovery.wrappedKek, "recovery.wrappedKek");
    const recoveryWrappedDek = parseStoredWrappedKey(
      recovery.wrappedDek,
      "recovery.wrappedDek"
    );

    if (typeof record.state !== "string" || !ENCRYPTION_STATES.has(record.state)) {
      throw new CryptoError("keyring_corrupt", "Invalid encryption state");
    }

    const failedAttempts = requireNonNegativeInteger(
      record.failedAttempts,
      "failedAttempts"
    );
    const retryAfter = parseOptionalTimestamp(record.retryAfter, "retryAfter");
    const createdAt = requireTimestamp(record.createdAt, "createdAt");
    const updatedAt = requireTimestamp(record.updatedAt, "updatedAt");
    const pending = parsePendingRotation(record.pending);

    return {
      version: 1,
      workspaceId,
      activeKid,
      kdf,
      wrappedDek,
      recovery: {
        kid: recoveryKid,
        wrappedKek,
        wrappedDek: recoveryWrappedDek,
      },
      state: record.state as EncryptionState,
      pending,
      failedAttempts,
      retryAfter,
      createdAt,
      updatedAt,
    };
  } catch (error) {
    if (error instanceof CryptoError && error.code === "keyring_corrupt") {
      throw error;
    }

    throw new CryptoError("keyring_corrupt", "Keyring record is corrupt", {
      cause: error,
    });
  }
}

function parsePendingRotation(value: unknown): PendingRotation | null {
  if (value === null) {
    return null;
  }

  const pending = requireObject(value, "pending");

  return {
    kid: requireString(pending.kid, "pending.kid"),
    wrappedDek: parseStoredWrappedKey(pending.wrappedDek, "pending.wrappedDek"),
    wrappedDekByRecovery: parseStoredWrappedKey(
      pending.wrappedDekByRecovery,
      "pending.wrappedDekByRecovery"
    ),
    createdAt: requireTimestamp(pending.createdAt, "pending.createdAt"),
  };
}

function parseStoredWrappedKey(value: unknown, label: string): WrappedKey {
  try {
    parseWrappedKey(value, KEY_BYTES);
  } catch (error) {
    throw new CryptoError("keyring_corrupt", `${label} is invalid`, { cause: error });
  }

  const record = value as Record<string, unknown>;

  return {
    iv: record.iv as string,
    ciphertext: record.ciphertext as string,
    tag: record.tag as string,
  };
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CryptoError("keyring_corrupt", `${label} must be an object`);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CryptoError("keyring_corrupt", `${label} must be a non-empty string`);
  }

  return value;
}

function requireTimestamp(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new CryptoError("keyring_corrupt", `${label} must be a timestamp`);
  }

  return value;
}

function parseOptionalTimestamp(value: unknown, label: string): number | null {
  return value === null ? null : requireTimestamp(value, label);
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new CryptoError("keyring_corrupt", `${label} must be a non-negative integer`);
  }

  return value;
}

function assertPassphrase(passphrase: string): void {
  if (typeof passphrase !== "string" || passphrase.length === 0) {
    throw new CryptoError("invalid_passphrase", "Passphrase is empty");
  }
}

function isAuthenticationFailure(error: unknown): boolean {
  return error instanceof CryptoError && error.code === "authentication_failed";
}

function workspaceDekAad(workspaceId: string, kid: string): Uint8Array {
  return keyAad(workspaceId, kid, "workspace-dek-wrap");
}

function recoveryKekAad(workspaceId: string, kid: string): Uint8Array {
  return keyAad(workspaceId, kid, "recovery-kek-wrap");
}

function recoveryDekAad(workspaceId: string, kid: string): Uint8Array {
  return keyAad(workspaceId, kid, "recovery-dek-wrap");
}

function keyAad(workspaceId: string, kid: string, purpose: string): Uint8Array {
  return utf8(
    canonicalJson({
      alg: AES_GCM_ALGORITHM,
      envelopeVersion: 1,
      kid,
      purpose,
      workspaceId,
    })
  );
}
