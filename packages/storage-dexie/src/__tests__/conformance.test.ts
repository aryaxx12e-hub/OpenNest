import "fake-indexeddb/auto";

import { runStorageConformance, runSyncConformance } from "@opennest/storage-conformance";
import type { SyncPolicy } from "@opennest/sync";

import { createDexieStorage } from "../index";

let counter = 0;

const factory = async (name?: string, policy?: SyncPolicy) => {
  counter += 1;

  return createDexieStorage({
    databaseName: name ?? `opennest-conformance-${counter}`,
    ...(policy === undefined ? {} : { syncPolicy: policy }),
  });
};

runStorageConformance("dexie", factory);
runSyncConformance("dexie sync", factory);
