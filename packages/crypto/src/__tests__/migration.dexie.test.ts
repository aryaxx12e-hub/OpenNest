import "fake-indexeddb/auto";

import type { IsoDate } from "@opennest/core";
import { createDexieStorage } from "@opennest/storage-dexie";

import { runMigrationSuite, type MigrationHarness } from "./migration.suite";

const AT = "2026-11-17T00:00:00.000Z" as IsoDate;
let counter = 0;

async function createHarness(): Promise<MigrationHarness> {
  counter += 1;
  const databaseName = `opennest-migration-dexie-${Date.now()}-${counter}`;
  const base = createDexieStorage({ databaseName });
  await base.init();

  try {
    const workspace = await base.workspaces.ensureWorkspace({ at: AT });

    return {
      base,
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

runMigrationSuite("dexie", createHarness);
