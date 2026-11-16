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

import {
  clearAllNoteDrafts,
  readDraftJournal,
  type DraftStorage,
} from "../autosave/draft-journal";
import { buildBackup, type BuiltBackup } from "../data/backup";

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
  exportAll(): Promise<BuiltBackup>;
  restore(snapshot: BackupSnapshot): Promise<RestoreResult>;
  deleteAll(): Promise<void>;
  readBlob(blobKey: BlobKey): Promise<Blob | null>;
}

export interface DataControlsInput {
  storage: StorageAdapter;
  drafts: DraftStorage;
  workspaceName: string;
  broker: CapabilityBroker;
  grants: GrantRegistry;
  audit: AuditLog;
  now: () => number;
  getWorkspace: () => Workspace;
  setWorkspace: (workspace: Workspace) => void;
  resetPrivacy: () => Promise<void>;
  reconcileBuiltIns: (workspaceId: string, auditNew: boolean) => Promise<void>;
}

export function createDataControls(input: DataControlsInput): DataControls {
  const {
    storage,
    drafts,
    workspaceName,
    broker,
    grants,
    audit,
    now,
    getWorkspace,
    setWorkspace,
    resetPrivacy,
    reconcileBuiltIns,
  } = input;

  async function overview(): Promise<DataOverview> {
    const workspace = getWorkspace();
    const [files, notes, folders, tags, usage, grantRows, auditRows] = await Promise.all([
      storage.files.list(workspace.id, {}, { limit: 1 }),
      storage.notes.list(workspace.id, {}, { limit: 1 }),
      storage.folders.list(workspace.id, { limit: 1 }),
      storage.tags.list(workspace.id, { limit: 1 }),
      storage.blobs.usage(),
      grants.list(),
      audit.list(),
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
      drafts: draftCount(drafts),
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
    const result = clearAllNoteDrafts(drafts);

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
    async exportAll() {
      const workspace = getWorkspace();
      const counts = await overview();
      const built = await runHighRisk(
        "workspace.export",
        workspace.id,
        counts.totalItems,
        "Export all local data",
        () =>
          buildBackup(storage, workspace.id, {
            now: () => new Date(now()).toISOString(),
          })
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
      setWorkspace(snapshot.workspace);
      await reconcileBuiltIns(snapshot.workspace.id, true);

      return { draftClearFailed: clearAllNoteDrafts(drafts).failed > 0 };
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
        () => storage.reset()
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

function draftCount(drafts: DraftStorage): number {
  const journal = readDraftJournal(drafts);

  return journal.ok ? journal.drafts.length : 0;
}
