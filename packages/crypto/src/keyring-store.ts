import type { KeyringRecordV1 } from "./keyring";

export interface KeyringStore {
  get(workspaceId: string): Promise<KeyringRecordV1 | null>;
  put(record: KeyringRecordV1): Promise<void>;
  delete(workspaceId: string): Promise<void>;
  clear(): Promise<void>;
  close?(): Promise<void>;
}

export function createMemoryKeyringStore(): KeyringStore {
  const records = new Map<string, KeyringRecordV1>();

  return {
    async get(workspaceId) {
      const record = records.get(workspaceId);
      return record === undefined ? null : cloneRecord(record);
    },
    async put(record) {
      records.set(record.workspaceId, cloneRecord(record));
    },
    async delete(workspaceId) {
      records.delete(workspaceId);
    },
    async clear() {
      records.clear();
    },
  };
}

function cloneRecord(record: KeyringRecordV1): KeyringRecordV1 {
  return JSON.parse(JSON.stringify(record)) as KeyringRecordV1;
}
