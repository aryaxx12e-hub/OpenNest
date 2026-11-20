// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { createReadinessCheck, isDatabaseReady } from "../health";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "opennest-server-health-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

function createDatabase(file: string, table: string): void {
  const database = new DatabaseSync(file);

  try {
    database.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY)`);
  } finally {
    database.close();
  }
}

describe("readiness", () => {
  it("is ready when every required table exists", async () => {
    const root = await makeRoot();
    const workspace = path.join(root, "workspace.sqlite");
    const auth = path.join(root, "auth.sqlite");
    createDatabase(workspace, "workspaces");
    createDatabase(auth, "users");

    const check = createReadinessCheck([
      { databaseFile: workspace, requiredTable: "workspaces" },
      { databaseFile: auth, requiredTable: "users" },
    ]);

    await expect(check()).resolves.toBe(true);
  });

  it("is not ready when a database is missing", async () => {
    const root = await makeRoot();
    const workspace = path.join(root, "workspace.sqlite");
    createDatabase(workspace, "workspaces");

    await expect(
      isDatabaseReady({
        databaseFile: path.join(root, "missing.sqlite"),
        requiredTable: "users",
      })
    ).resolves.toBe(false);
  });

  it("is not ready when a required table is missing", async () => {
    const root = await makeRoot();
    const workspace = path.join(root, "workspace.sqlite");
    createDatabase(workspace, "notes");

    await expect(
      isDatabaseReady({ databaseFile: workspace, requiredTable: "workspaces" })
    ).resolves.toBe(false);
  });

  it("stops at the first failed target", async () => {
    const root = await makeRoot();
    const workspace = path.join(root, "workspace.sqlite");
    createDatabase(workspace, "workspaces");

    const check = createReadinessCheck([
      { databaseFile: path.join(root, "missing.sqlite"), requiredTable: "users" },
      { databaseFile: workspace, requiredTable: "workspaces" },
    ]);

    await expect(check()).resolves.toBe(false);
  });
});
