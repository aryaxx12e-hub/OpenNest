// @vitest-environment node

import "fake-indexeddb/auto";

import type { IsoDate } from "@opennest/core";
import { createDexieStorage } from "@opennest/storage-dexie";

import { createEncryptedStorage, importAesGcmKey, randomBytes } from "../index";
import {
  runEncryptedStorageSuite,
  type EncryptedHarness,
} from "./encrypted-storage.suite";

let counter = 0;
const AT = "2026-11-17T00:00:00.000Z" as IsoDate;

async function createHarness(options?: { outbox?: boolean }): Promise<EncryptedHarness> {
  counter += 1;
  const databaseName = `opennest-encrypted-dexie-${Date.now()}-${counter}`;
  const base = createDexieStorage({
    databaseName,
    ...(options?.outbox === true
      ? {
          syncPolicy: {
            outbox: { enabled: true, maxRows: 1000, retentionMs: 86_400_000 },
          },
        }
      : {}),
  });
  await base.init();

  try {
    const workspace = await base.workspaces.ensureWorkspace({ at: AT });
    const context = {
      workspaceId: workspace.id,
      keyId: "key-1",
      dek: await importAesGcmKey(randomBytes(32)),
    };

    return {
      base,
      storage: createEncryptedStorage({ base, context }),
      context,
      workspace,
      async cleanup() {
        await base.close();
        await new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase(databaseName);
          request.onsuccess = () => resolve();
          request.onerror = () => resolve();
          request.onblocked = () => resolve();
        });
      },
    };
  } catch (error) {
    await base.close();
    throw error;
  }
}

runEncryptedStorageSuite("dexie", createHarness);
