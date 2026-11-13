import "fake-indexeddb/auto";

import { runStorageConformance } from "@opennest/storage-conformance";

import { createDexieStorage } from "../index";

let counter = 0;

runStorageConformance("dexie", async (name) => {
  counter += 1;

  return createDexieStorage({
    databaseName: name ?? `opennest-conformance-${counter}`,
  });
});
