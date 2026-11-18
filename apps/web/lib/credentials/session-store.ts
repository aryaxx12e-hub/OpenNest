import { MAX_SECRET_BYTES, isValidProviderId } from "@opennest/credential-vault";
import { randomId, utf8 } from "@opennest/crypto";

import { CredentialRuntimeError } from "./errors";

export interface SessionCredentialMetadata {
  readonly id: string;
  readonly providerId: string;
  readonly accountLabel: string;
  readonly createdAt: number;
}

export interface SessionCredentialStore {
  put(input: {
    providerId: string;
    accountLabel: string;
    secret: string;
  }): Promise<SessionCredentialMetadata>;
  list(): readonly SessionCredentialMetadata[];
  remove(id: string): void;
  removeProvider(providerId: string): void;
  clear(): void;
  withSecret<T>(
    id: string,
    providerId: string,
    operation: (secret: string) => Promise<T>
  ): Promise<T>;
}

interface SessionCredentialRecord {
  readonly metadata: SessionCredentialMetadata;
  readonly secret: string;
}

export interface CreateSessionCredentialStoreOptions {
  now?: () => number;
  generateId?: () => string;
}

export function createSessionCredentialStore(
  options: CreateSessionCredentialStoreOptions = {}
): SessionCredentialStore {
  const now = options.now ?? (() => Date.now());
  const generateId = options.generateId ?? (() => randomId("credential"));
  const records = new Map<string, SessionCredentialRecord>();

  return {
    async put(input) {
      assertProviderId(input.providerId);
      assertAccountLabel(input.accountLabel);
      assertSecret(input.secret);

      const metadata: SessionCredentialMetadata = {
        id: generateId(),
        providerId: input.providerId,
        accountLabel: input.accountLabel,
        createdAt: now(),
      };

      records.set(metadata.id, { metadata, secret: input.secret });

      return metadata;
    },
    list() {
      return [...records.values()].map((record) => record.metadata);
    },
    remove(id) {
      records.delete(id);
    },
    removeProvider(providerId) {
      for (const [id, record] of records) {
        if (record.metadata.providerId === providerId) {
          records.delete(id);
        }
      }
    },
    clear() {
      records.clear();
    },
    async withSecret(id, providerId, operation) {
      assertProviderId(providerId);
      const record = records.get(id);

      if (record === undefined) {
        throw new CredentialRuntimeError(
          "credential_not_found",
          "The session credential does not exist."
        );
      }

      if (record.metadata.providerId !== providerId) {
        throw new CredentialRuntimeError(
          "provider_mismatch",
          "The session credential belongs to a different provider."
        );
      }

      return operation(record.secret);
    },
  };
}

function assertProviderId(value: string): void {
  if (!isValidProviderId(value)) {
    throw new CredentialRuntimeError(
      "invalid_provider_id",
      "The provider ID is not valid."
    );
  }
}

function assertAccountLabel(value: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 120) {
    throw new CredentialRuntimeError(
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
    throw new CredentialRuntimeError(
      "invalid_secret",
      `The secret must be between 1 and ${MAX_SECRET_BYTES} bytes.`
    );
  }
}
