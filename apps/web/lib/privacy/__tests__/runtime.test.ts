import { beforeEach, describe, expect, it } from "vitest";

import {
  createMemoryStorage,
  type BackupSnapshot,
  type IsoDate,
  type WorkspaceId,
} from "@opennest/core";
import {
  CapabilityDeniedError,
  createMemoryPrivacyStore,
  createSequenceIds,
} from "@opennest/privacy";

import { createAppServices, sha256Hex } from "@/lib/data/services";

import { createPrivacyRuntime, type PrivacyRuntime } from "../runtime";

const NOW = Date.parse("2026-11-15T08:00:00.000Z");
const AT = "2026-11-15T08:00:00.000Z" as IsoDate;

async function setup(): Promise<PrivacyRuntime> {
  const storage = createMemoryStorage();
  const { services, workspace } = await createAppServices(storage, {
    defaultWorkspaceName: "My Library",
    clock: () => AT,
    hash: sha256Hex,
    generateBlobKey: () => "11111111-1111-4111-8111-111111111111",
  });
  const openPrivacyStore = async () => {
    const store = createMemoryPrivacyStore();
    await store.init();
    return store;
  };

  return createPrivacyRuntime({
    storage,
    services,
    workspace,
    drafts: window.localStorage,
    openPrivacyStore,
    now: () => NOW,
    generateId: createSequenceIds("id"),
  });
}

function snapshotForWorkspace(workspaceId: string): BackupSnapshot {
  return {
    snapshotVersion: 1,
    schemaVersion: 1,
    kind: "dexie",
    createdAt: AT,
    workspace: {
      id: workspaceId as WorkspaceId,
      name: "Restored Library",
      createdAt: AT,
      updatedAt: AT,
    },
    folders: [],
    files: [],
    notes: [],
    tags: [],
    fileTags: [],
    noteTags: [],
    noteLinks: [],
    blobs: [],
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("privacy runtime", () => {
  it("bootstraps built-in grants and brokers an allowed capability", async () => {
    const runtime = await setup();
    const capabilities = (await runtime.grants.list()).map((grant) => grant.capability);

    expect(capabilities).toEqual(
      expect.arrayContaining(["workspace.read.metadata", "workspace.write"])
    );

    const grant = (await runtime.grants.list())[0];
    const workspaceId =
      grant?.scope.kind === "workspace" ? grant.scope.workspaceId : "missing";
    const handle = await runtime.broker.request({
      capability: "workspace.read.metadata",
      scope: { kind: "workspace", workspaceId },
      purpose: "Render the dashboard",
    });

    await expect(runtime.broker.invoke(handle, async () => "ok")).resolves.toBe("ok");
    await runtime.dispose();
  });

  it("denies a brokered service call when no grant exists", async () => {
    const runtime = await setup();
    await runtime.store.grants.clear();

    await expect(
      runtime.services.note.list("w1" as WorkspaceId, {})
    ).rejects.toBeInstanceOf(CapabilityDeniedError);
    await runtime.dispose();
  });

  it("reconciles built-in grants after a restore changes the workspace", async () => {
    const runtime = await setup();
    await runtime.data.restore(snapshotForWorkspace("w2"));

    const grants = await runtime.grants.list();

    expect(grants).toHaveLength(5);
    expect(
      grants.every(
        (grant) => grant.scope.kind === "workspace" && grant.scope.workspaceId === "w2"
      )
    ).toBe(true);
    await runtime.dispose();
  });

  it("disposes idempotently", async () => {
    const runtime = await setup();

    await expect(runtime.dispose()).resolves.toBeUndefined();
    await expect(runtime.dispose()).resolves.toBeUndefined();
  });
});
