import {
  type BackupSnapshot,
  type BlobKey,
  type IsoDate,
  type StorageAdapter,
  type Workspace,
} from "@opennest/core";
import {
  PrivacyError,
  dataInventory,
  flowMatrix,
  scopeDigest,
  type AuditLog,
  type CapabilityBroker,
  type DataInventoryEntry,
  type FlowMatrixEntry,
  type GrantRegistry,
} from "@opennest/privacy";

import type { DraftStore } from "../autosave/draft-store";
import {
  buildBackup,
  buildBackupV2,
  type BackupExportOptions,
  type BuiltBackup,
} from "../data/backup";

export interface DataOverview {
  bytes: number;
  blobItems: number;
  files: number;
  notes: number;
  folders: number;
  tags: number;
  totalItems: number;
  grants: number;
  auditEntries: number;
  drafts: number;
}

export interface RestoreResult {
  draftClearFailed: boolean;
}

export interface DataControls {
  overview(): Promise<DataOverview>;
  inventory(): readonly DataInventoryEntry[];
  flows(): readonly FlowMatrixEntry[];
  exportAll(options?: BackupExportOptions): Promise<BuiltBackup>;
  restore(snapshot: BackupSnapshot): Promise<RestoreResult>;
  deleteAll(): Promise<void>;
  readBlob(blobKey: BlobKey): Promise<Blob | null>;
}

export interface DataControlsInput {
  storage: StorageAdapter;
  drafts: DraftStore;
  auxiliaryDrafts?: DraftStore;
  workspaceName: string;
  broker: CapabilityBroker;
  grants: GrantRegistry;
  audit: AuditLog;
  now: () => number;
  getWorkspace: () => Workspace;
  setWorkspace: (workspace: Workspace) => void;
  resetPrivacy: () => Promise<void>;
  auxiliaryCleanup: () => Promise<void>;
  reconcileBuiltIns: (workspaceId: string, auditNew: boolean) => Promise<void>;
}

export function createDataControls(input: DataControlsInput): DataControls {
  const {
    storage,
    drafts,
    auxiliaryDrafts,
    workspaceName,
    broker,
    grants,
    audit,
    now,
    getWorkspace,
    setWorkspace,
    resetPrivacy,
    auxiliaryCleanup,
    reconcileBuiltIns,
  } = input;

  const draftStores = [
    drafts,
    ...(auxiliaryDrafts === undefined ? [] : [auxiliaryDrafts]),
  ];

  async function countDrafts(): Promise<number> {
    let total = 0;

    for (const store of draftStores) {
      total += await store.count().catch(() => 0);
    }

    return total;
  }

  async function clearDrafts(): Promise<{ removed: number; failed: number }> {
    let removed = 0;
    let failed = 0;

    for (const store of draftStores) {
      const result = await store.clear();
      removed += result.removed;
      failed += result.failed;
    }

    return { removed, failed };
  }

  async function overview(): Promise<DataOverview> {
    const workspace = getWorkspace();
    const [files, notes, folders, tags, usage, grantRows, auditRows, draftRows] =
      await Promise.all([
        storage.files.list(workspace.id, {}, { limit: 1 }),
        storage.notes.list(workspace.id, {}, { limit: 1 }),
        storage.folders.list(workspace.id, { limit: 1 }),
        storage.tags.list(workspace.id, { limit: 1 }),
        storage.blobs.usage(),
        grants.list(),
        audit.list(),
        countDrafts(),
      ]);

    return {
      bytes: usage.bytes,
      blobItems: usage.items,
      files: files.total,
      notes: notes.total,
      folders: folders.total,
      tags: tags.total,
      totalItems: files.total + notes.total + folders.total + tags.total,
      grants: grantRows.length,
      auditEntries: auditRows.length,
      drafts: draftRows,
    };
  }

  async function runHighRisk<T>(
    capability: "workspace.export" | "workspace.delete",
    workspaceId: string,
    itemCount: number,
    purpose: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const scope = { kind: "workspace" as const, workspaceId };
    const handle = await broker.request({
      capability,
      scope,
      purpose,
      confirmation: {
        confirmedAt: now(),
        scopeDigest: await scopeDigest(scope),
        itemCount,
      },
    });

    return broker.invoke(handle, () => operation());
  }

  async function clearDraftsOrThrow(): Promise<void> {
    const result = await clearDrafts();

    if (result.failed > 0) {
      throw new PrivacyError(
        "draft_clear_failed",
        "Local drafts could not be cleared; no data was deleted."
      );
    }
  }

  return {
    overview,
    inventory() {
      return dataInventory;
    },
    flows() {
      return flowMatrix;
    },
    async exportAll(options: BackupExportOptions = { format: "v1" }) {
      const workspace = getWorkspace();
      const counts = await overview();
      const exportedAt = new Date(now()).toISOString();
      const built = await runHighRisk(
        "workspace.export",
        workspace.id,
        counts.totalItems,
        "Export all local data",
        async () => {
          const plaintext = await buildBackup(storage, workspace.id, {
            now: () => exportedAt,
          });

          if (options.format !== "v2") {
            return plaintext;
          }

          return buildBackupV2(plaintext.snapshot, options.keySource, {
            now: () => exportedAt,
          });
        }
      );

      await audit.append({
        event: "data.exported",
        outcome: "completed",
        principalId: "built-in:local",
        capability: "workspace.export",
        itemCount:
          built.summary.files +
          built.summary.notes +
          built.summary.folders +
          built.summary.tags,
      });

      return built;
    },
    async restore(snapshot) {
      const itemCount =
        snapshot.files.length +
        snapshot.notes.length +
        snapshot.folders.length +
        snapshot.tags.length;

      const current = getWorkspace();

      await runHighRisk(
        "workspace.delete",
        current.id,
        itemCount,
        "Restore a local backup",
        () => storage.restore(snapshot)
      );
      await audit.append({
        event: "data.restored",
        outcome: "completed",
        principalId: "built-in:local",
        capability: "workspace.delete",
        itemCount,
      });
      const restoredWorkspace = await storage.workspaces.ensureWorkspace({
        name: workspaceName,
        at: new Date(now()).toISOString() as IsoDate,
      });

      setWorkspace(restoredWorkspace);
      await reconcileBuiltIns(restoredWorkspace.id, true);

      return { draftClearFailed: (await clearDrafts()).failed > 0 };
    },
    async deleteAll() {
      await clearDraftsOrThrow();
      const workspace = getWorkspace();
      const counts = await overview();

      await runHighRisk(
        "workspace.delete",
        workspace.id,
        counts.totalItems,
        "Delete all local data",
        async () => {
          await auxiliaryCleanup();
          await storage.reset();
        }
      );
      await resetPrivacy();
      const restored = await storage.workspaces.ensureWorkspace({
        name: workspaceName,
        at: new Date(now()).toISOString() as IsoDate,
      });

      setWorkspace(restored);
      await grants.ensureBuiltIns(restored.id);
    },
    async readBlob(blobKey) {
      const workspace = getWorkspace();
      const handle = await broker.request({
        capability: "workspace.read.content",
        scope: { kind: "workspace", workspaceId: workspace.id },
        purpose: "Preview a local file",
      });

      return broker.invoke(handle, () => storage.blobs.get(blobKey));
    },
  };
}
