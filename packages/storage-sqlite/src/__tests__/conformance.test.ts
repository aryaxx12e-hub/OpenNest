// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { runStorageConformance, runSyncConformance } from "@opennest/storage-conformance";
import type { SyncPolicy } from "@opennest/sync";
import { afterAll } from "vitest";

import { createSqliteStorage } from "../index";

const root = await mkdtemp(path.join(tmpdir(), "opennest-sqlite-"));
const databases = new Map<string, string>();
let counter = 0;

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function databaseFileFor(name?: string): string {
  if (name === undefined) {
    return ":memory:";
  }

  const existing = databases.get(name);

  if (existing !== undefined) {
    return existing;
  }

  const created = path.join(root, `database-${databases.size + 1}.sqlite`);
  databases.set(name, created);

  return created;
}

function createFactory(label: string, forceFile: boolean) {
  return async (name?: string, policy?: SyncPolicy) => {
    counter += 1;
    const key = name === undefined ? `${label}-${counter}` : `${label}:${name}`;

    return createSqliteStorage({
      databaseFile: forceFile || name !== undefined ? databaseFileFor(key) : ":memory:",
      blobRoot: path.join(root, `blobs-${counter}`),
      ...(policy === undefined ? {} : { syncPolicy: policy }),
    });
  };
}

const memoryFactory = createFactory("memory", false);
const fileFactory = createFactory("file", true);

runStorageConformance("sqlite (:memory:)", memoryFactory);
runStorageConformance("sqlite (file)", fileFactory);
runSyncConformance("sqlite (:memory:) sync", memoryFactory);
runSyncConformance("sqlite (file) sync", fileFactory);
