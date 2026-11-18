import type {
  AuditEntry,
  AuditStore,
  CapabilityGrant,
  ConsentRecord,
  ConsentStore,
  GrantStore,
  PrivacyStore,
} from "./types";

export function createMemoryGrantStore(): GrantStore {
  const rows = new Map<string, CapabilityGrant>();

  return {
    async list() {
      return [...rows.values()];
    },
    async get(id) {
      return rows.get(id) ?? null;
    },
    async put(grant) {
      rows.set(grant.id, grant);
    },
    async delete(id) {
      rows.delete(id);
    },
    async clear() {
      rows.clear();
    },
  };
}

export function createMemoryAuditStore(): AuditStore {
  const rows: AuditEntry[] = [];

  return {
    async list() {
      return [...rows];
    },
    async append(entry) {
      rows.push(entry);
    },
    async clear() {
      rows.length = 0;
    },
  };
}

export function createMemoryConsentStore(): ConsentStore {
  const rows = new Map<string, ConsentRecord>();

  return {
    async list() {
      return [...rows.values()];
    },
    async get(id) {
      return rows.get(id) ?? null;
    },
    async put(record) {
      rows.set(record.id, record);
    },
    async delete(id) {
      rows.delete(id);
    },
    async clear() {
      rows.clear();
    },
  };
}

export function createMemoryPrivacyStore(): PrivacyStore {
  const grants = createMemoryGrantStore();
  const audit = createMemoryAuditStore();
  const consents = createMemoryConsentStore();

  return {
    async init() {
      return undefined;
    },
    async close() {
      return undefined;
    },
    async reset() {
      await grants.clear();
      await audit.clear();
      await consents.clear();
    },
    grants,
    audit,
    consents,
  };
}

export function createSequenceIds(prefix: string): () => string {
  let value = 0;

  return () => {
    value += 1;
    return `${prefix}-${value}`;
  };
}

export function fixedNow(value: number): () => number {
  return () => value;
}
