// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { IsoDate } from "@opennest/core";
import { createSqliteStorage } from "@opennest/storage-sqlite";

import { createEncryptedStorage, importAesGcmKey, randomBytes } from "../index";
import {
  runEncryptedStorageSuite,
  type EncryptedHarness,
} from "./encrypted-storage.suite";

const AT = "2026-11-17T00:00:00.000Z" as IsoDate;

async function createHarness(options?: { outbox?: boolean }): Promise<EncryptedHarness> {
  const root = await mkdtemp(path.join(tmpdir(), "opennest-encrypted-sqlite-"));
  const base = createSqliteStorage({
    databaseFile: path.join(root, "database.sqlite"),
    blobRoot: path.join(root, "blobs"),
    ...(options?.outbox === true
      ? {
          syncPolicy: {
            outbox: { enabled: true, maxRows: 1000, retentionMs: 86_400_000 },
          },
        }
      : {}),
  });

  try {
    await base.init();
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
        await rm(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await base.close();
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

runEncryptedStorageSuite("sqlite", createHarness);
