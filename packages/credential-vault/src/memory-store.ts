import type { CredentialVaultStore, VaultRecordV1 } from "./types";

export function createMemoryCredentialVaultStore(): CredentialVaultStore {
  let record: VaultRecordV1 | null = null;

  return {
    async get() {
      return record === null ? null : cloneRecord(record);
    },
    async put(next) {
      record = cloneRecord(next);
    },
    async delete() {
      record = null;
    },
  };
}

function cloneRecord(record: VaultRecordV1): VaultRecordV1 {
  return structuredClone(record);
}
