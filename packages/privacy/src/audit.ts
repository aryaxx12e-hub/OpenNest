import { canonicalJson, sha256Hex } from "./hash";
import type {
  AuditEntry,
  AuditInput,
  AuditLog,
  AuditStore,
  AuditVerification,
} from "./types";

export function createAuditLog(input: {
  store: AuditStore;
  now: () => number;
  generateId: () => string;
  hash?: (value: string) => Promise<string>;
}): AuditLog {
  const { store, now, generateId, hash = sha256Hex } = input;
  let queue: Promise<void> = Promise.resolve();

  function serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = queue.then(work, work);
    queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async function list(): Promise<AuditEntry[]> {
    const rows = await store.list();
    return [...rows].sort((left, right) => left.sequence - right.sequence);
  }

  async function append(input: AuditInput): Promise<AuditEntry> {
    return serialize(async () => {
      const rows = await list();
      const previous = rows.at(-1) ?? null;
      const sequence = previous === null ? 0 : previous.sequence + 1;
      const payload = {
        id: generateId(),
        sequence,
        at: now(),
        event: input.event,
        outcome: input.outcome,
        principalId: input.principalId ?? null,
        capability: input.capability ?? null,
        scopeDigest: input.scopeDigest ?? null,
        itemCount: input.itemCount ?? null,
        reason: input.reason ?? null,
        prevHash: previous?.hash ?? null,
      };
      const entry: AuditEntry = {
        ...payload,
        hash: await hash(canonicalJson(payload)),
      };

      await store.append(entry);

      return entry;
    });
  }

  async function verify(): Promise<AuditVerification> {
    const rows = await list();
    let previousHash: string | null = null;

    for (const [index, entry] of rows.entries()) {
      if (entry.sequence !== index || entry.prevHash !== previousHash) {
        return { valid: false, entries: rows.length, brokenAt: index };
      }

      const payload = {
        id: entry.id,
        sequence: entry.sequence,
        at: entry.at,
        event: entry.event,
        outcome: entry.outcome,
        principalId: entry.principalId,
        capability: entry.capability,
        scopeDigest: entry.scopeDigest,
        itemCount: entry.itemCount,
        reason: entry.reason,
        prevHash: entry.prevHash,
      };

      if ((await hash(canonicalJson(payload))) !== entry.hash) {
        return { valid: false, entries: rows.length, brokenAt: index };
      }

      previousHash = entry.hash;
    }

    return { valid: true, entries: rows.length, brokenAt: null };
  }

  return {
    append,
    list,
    verify,
    clear() {
      return serialize(() => store.clear());
    },
  };
}
