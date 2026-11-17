// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { IsoDate } from "@opennest/core";
import { createSqliteStorage } from "@opennest/storage-sqlite";

import { runMigrationSuite, type MigrationHarness } from "./migration.suite";

const AT = "2026-11-17T00:00:00.000Z" as IsoDate;

async function createHarness(): Promise<MigrationHarness> {
  const root = await mkdtemp(path.join(tmpdir(), "opennest-migration-sqlite-"));
  const base = createSqliteStorage({
    databaseFile: path.join(root, "database.sqlite"),
    blobRoot: path.join(root, "blobs"),
  });

  try {
    await base.init();
    const workspace = await base.workspaces.ensureWorkspace({ at: AT });

    return {
      base,
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

runMigrationSuite("sqlite", createHarness);
