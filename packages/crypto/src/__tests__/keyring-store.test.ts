import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { createIndexedDbKeyringStore, createMemoryKeyringStore } from "../index";
import type { KeyringRecordV1 } from "../index";

function record(activeKid: string): KeyringRecordV1 {
  return {
    version: 1,
    workspaceId: "workspace-1",
    activeKid,
    kdf: {
      name: "PBKDF2-SHA-256",
      hash: "SHA-256",
      iterations: 600000,
      salt: "AAAAAAAAAAAAAAAAAAAAAA",
      domain: "opennest:workspace-kek:v1",
    },
    wrappedDek: {
      iv: "AAAAAAAAAAAAAAAA",
      ciphertext: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      tag: "AAAAAAAAAAAAAAAAAAAAAA",
    },
    recovery: {
      kid: "recovery-key-1",
      wrappedKek: {
        iv: "AAAAAAAAAAAAAAAA",
        ciphertext: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        tag: "AAAAAAAAAAAAAAAAAAAAAA",
      },
      wrappedDek: {
        iv: "AAAAAAAAAAAAAAAA",
        ciphertext: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        tag: "AAAAAAAAAAAAAAAAAAAAAA",
      },
    },
    state: "active",
    pending: null,
    failedAttempts: 0,
    retryAfter: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("memory keyring store", () => {
  it("puts, gets, deletes, and clears records", async () => {
    const store = createMemoryKeyringStore();
    const first = record("kid-1");
    const second = { ...record("kid-2"), workspaceId: "workspace-2" };

    expect(await store.get("workspace-1")).toBeNull();
    await store.put(first);
    await store.put(second);
    expect(await store.get("workspace-1")).toEqual(first);
    expect(await store.get("workspace-2")).toEqual(second);

    await store.delete("workspace-1");
    expect(await store.get("workspace-1")).toBeNull();
    expect(await store.get("workspace-2")).toEqual(second);

    await store.clear();
    expect(await store.get("workspace-2")).toBeNull();
  });

  it("does not expose its internal record by reference", async () => {
    const store = createMemoryKeyringStore();
    await store.put(record("kid-1"));

    const loaded = await store.get("workspace-1");
    if (loaded === null) {
      throw new Error("record missing");
    }
    loaded.activeKid = "mutated";

    expect((await store.get("workspace-1"))?.activeKid).toBe("kid-1");
  });
});

describe("IndexedDB keyring store", () => {
  it("puts, gets, deletes, clears, and closes records", async () => {
    const store = createIndexedDbKeyringStore({
      indexedDB: new IDBFactory(),
      databaseName: "opennest-crypto-test",
    });
    const first = record("kid-1");
    const second = { ...record("kid-2"), workspaceId: "workspace-2" };

    await store.put(first);
    await store.put(second);
    expect(await store.get("workspace-1")).toEqual(first);
    expect(await store.get("workspace-2")).toEqual(second);

    await store.delete("workspace-1");
    expect(await store.get("workspace-1")).toBeNull();
    expect(await store.get("workspace-2")).toEqual(second);

    await store.clear();
    expect(await store.get("workspace-2")).toBeNull();
    await store.close?.();
  });
});
