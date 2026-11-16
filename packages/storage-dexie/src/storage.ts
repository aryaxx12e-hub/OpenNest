import {
  ConflictError,
  ConstraintError,
  DomainError,
  NotFoundError,
  StorageError,
  UnsupportedError,
  ValidationError,
  assertNoSelfLink,
  generateId,
  normalizeForSearch,
  normalizeTagName,
  searchTokens,
  type BackupSnapshot,
  type BlobStore,
  type DexieStorageConfig,
  type FileRepository,
  type Folder,
  type FolderId,
  type FolderRepository,
  type IsoDate,
  type Note,
  type NoteLink,
  type NoteRepository,
  type Page,
  type SearchHit,
  type SearchRepository,
  type SortField,
  type StoredFile,
  type Tag,
  type TagRepository,
  type Workspace,
  type WorkspaceRepository,
} from "@opennest/core";
import {
  DEFAULT_SYNC_POLICY,
  SyncError,
  canonicalIdList,
  prepareSyncChanges,
  recordPreparedSyncChanges,
  type SyncCapableStorage,
  type SyncChange,
  type SyncPolicy,
} from "@opennest/sync";
import { backupSnapshotSchema } from "@opennest/validation";
import Dexie from "dexie";

import { mapStorageError } from "./errors";
import { createDexieSyncStore } from "./sync-store";
import { DEFAULT_LIMIT, paginate } from "./pagination";
import { laterOf, requireAt } from "./repo-helpers";
import {
  OpenNestDexie,
  type BlobRow,
  type FileRow,
  type FolderRow,
  type NoteRow,
  type StorageOptions,
  type TagRow,
  type WorkspaceRow,
} from "./schema";

export interface DexieStorageOptions extends DexieStorageConfig {
  indexedDB?: IDBFactory;
  IDBKeyRange?: typeof IDBKeyRange;
  syncPolicy?: SyncPolicy;
}

// Decimal "storage schema" version, not Dexie's engine version. Version 3 adds
// the local sequence high-water mark while backup v1 stays unchanged. See
// schema.ts for the Dexie version itself.
const SCHEMA_VERSION = 3;
const DEFAULT_WORKSPACE_NAME = "Workspace";

function toWorkspace(row: WorkspaceRow): Workspace {
  return { ...row } as Workspace;
}

function toFolder(row: FolderRow): Folder {
  return { ...row } as Folder;
}

function toFile(row: FileRow): StoredFile {
  return { ...row } as StoredFile;
}

function toNote(row: NoteRow): Note {
  return { ...row, pinned: row.pinned === 1 } as Note;
}

function toTag(row: TagRow): Tag {
  return { ...row } as Tag;
}

function sortValueOf(
  sort: SortField,
  row: { name?: string; title?: string; createdAt: string; updatedAt?: string },
  isNote: boolean
): string {
  if (sort === "name") {
    return normalizeForSearch(isNote ? (row.title ?? "") : (row.name ?? ""));
  }

  return sort === "createdAt" ? row.createdAt : (row.updatedAt ?? row.createdAt);
}

function snippetOf(text: string, tokens: string[]): string {
  const folded = normalizeForSearch(text);
  const position = tokens
    .map((token) => folded.indexOf(token))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  if (position === undefined) {
    return text.slice(0, 80);
  }

  const start = Math.max(0, position - 20);

  return text.slice(start, start + 100);
}

export function createDexieStorage(config: DexieStorageOptions): SyncCapableStorage {
  const options: StorageOptions = {
    ...(config.indexedDB === undefined ? {} : { indexedDB: config.indexedDB }),
    ...(config.IDBKeyRange === undefined ? {} : { IDBKeyRange: config.IDBKeyRange }),
  };
  const db = new OpenNestDexie(config.databaseName, options);
  const policy = config.syncPolicy ?? DEFAULT_SYNC_POLICY;
  const syncTables = [
    db.sync_meta,
    db.sync_field_meta,
    db.sync_outbox,
    db.workspace_sync_state,
    db.sync_tombstone,
    db.sync_conflict,
    db.sync_devices,
  ];
  const sync = createDexieSyncStore(db);

  let closed = false;
  let transactionDepth = 0;
  let currentWorkspaceRevisions = new Map<string, number>();

  function guard(): void {
    if (closed) {
      throw new StorageError("The storage adapter is closed.", "closed");
    }
  }

  async function run<T>(work: () => Promise<T>): Promise<T> {
    guard();

    try {
      return await work();
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async function withSyncWrite<T>(
    tables: readonly Dexie.Table[],
    work: () => Promise<{ result: T; changes: SyncChange[] }>
  ): Promise<T> {
    guard();

    const execute = async (): Promise<T> => {
      const { result, changes } = await work();
      const pending = { changes, policy };
      const prepared =
        transactionDepth > 0 && policy.outbox.enabled
          ? await Dexie.waitFor(prepareSyncChanges(pending))
          : await prepareSyncChanges(pending);

      if (prepared.length > 0) {
        const workspaceId = prepared[0]?.workspaceId;
        const revision =
          workspaceId === undefined
            ? undefined
            : currentWorkspaceRevisions.get(workspaceId);
        const recorded = await recordPreparedSyncChanges(sync, {
          changes: prepared,
          policy,
          ...(revision === undefined ? {} : { workspaceRevision: revision }),
        });
        if (workspaceId !== undefined) {
          currentWorkspaceRevisions.set(workspaceId, recorded.workspaceRevision);
        }
      }

      return result;
    };

    if (transactionDepth > 0) {
      try {
        return await execute();
      } catch (error) {
        try {
          Dexie.currentTransaction?.abort();
        } catch {
          // The transaction was already aborted.
        }
        throw error;
      }
    }

    try {
      return await db.transaction("rw", [...tables, ...syncTables], async () => {
        const previousWorkspaceRevisions = currentWorkspaceRevisions;
        currentWorkspaceRevisions = new Map();
        transactionDepth += 1;

        try {
          return await execute();
        } finally {
          transactionDepth -= 1;
          currentWorkspaceRevisions = previousWorkspaceRevisions;
        }
      });
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }

      const inner =
        typeof error === "object" && error !== null
          ? (error as { inner?: unknown }).inner
          : undefined;
      if (inner instanceof DomainError) {
        throw inner;
      }

      throw error;
    }
  }

  async function bootstrapSync(): Promise<void> {
    const devices = await db.sync_devices.toArray();
    const installationId = devices[0]?.deviceId ?? generateId();
    const workspaces = await db.workspaces.toArray();

    for (const workspace of workspaces) {
      const at = workspace.updatedAt;
      await db.transaction("rw", [db.workspaces, ...syncTables], async () => {
        const device = await db.sync_devices.get([workspace.id, installationId]);
        if (device === undefined) {
          await db.sync_devices.put({
            workspaceId: workspace.id,
            deviceId: installationId,
            registeredAt: at,
            lastSeenAt: at,
            lastAckedTombstoneWorkspaceRevision: 0,
            state: "active",
            publicKey: null,
          });
        }

        const legacy = await db.workspace_sync_state.get([workspace.id, "legacy"]);
        const existing = await db.workspace_sync_state.get([
          workspace.id,
          installationId,
        ]);
        if (existing === undefined) {
          await db.workspace_sync_state.put({
            workspaceId: workspace.id,
            deviceId: installationId,
            remoteWorkspaceId: legacy?.remoteWorkspaceId ?? null,
            lastServerCursor: legacy?.lastServerCursor ?? null,
            lastLocalWorkspaceRevision: legacy?.lastLocalWorkspaceRevision ?? 0,
            lastLocalSequence: legacy?.lastLocalSequence ?? 0,
            tombstoneFloor: legacy?.tombstoneFloor ?? 0,
            lastFullResyncAt: legacy?.lastFullResyncAt ?? null,
          });
        }
        if (legacy !== undefined) {
          await db.workspace_sync_state.delete([workspace.id, "legacy"]);
        }

        await db.sync_meta
          .filter(
            (row) => row.workspaceId === workspace.id && row.originDeviceId === "legacy"
          )
          .modify({ originDeviceId: installationId });
      });
    }
  }

  async function requireFolder(id: FolderId): Promise<FolderRow> {
    const row = await db.folders.get(id);

    if (row === undefined) {
      throw new NotFoundError("Folder does not exist.");
    }

    return row;
  }

  async function requireNote(id: string): Promise<NoteRow> {
    const row = await db.notes.get(id);

    if (row === undefined) {
      throw new NotFoundError("Note does not exist.");
    }

    return row;
  }

  async function requireFile(id: string): Promise<FileRow> {
    const row = await db.files.get(id);

    if (row === undefined) {
      throw new NotFoundError("File does not exist.");
    }

    return row;
  }

  async function requireTag(id: string): Promise<TagRow> {
    const row = await db.tags.get(id);

    if (row === undefined) {
      throw new NotFoundError("Tag does not exist.");
    }

    return row;
  }

  async function subtreeIds(folderId: FolderId): Promise<Set<string>> {
    const ids = new Set<string>([folderId]);
    const all = await db.folders.toArray();
    let changed = true;

    while (changed) {
      changed = false;

      for (const folder of all) {
        if (folder.parentId !== null && ids.has(folder.parentId) && !ids.has(folder.id)) {
          ids.add(folder.id);
          changed = true;
        }
      }
    }

    return ids;
  }

  async function fileTagIds(fileId: string): Promise<Set<string>> {
    const rows = await db.fileTags.where("fileId").equals(fileId).toArray();

    return new Set(rows.map((row) => row.tagId));
  }

  async function noteTagIds(noteId: string): Promise<Set<string>> {
    const rows = await db.noteTags.where("noteId").equals(noteId).toArray();

    return new Set(rows.map((row) => row.tagId));
  }

  async function filterByFolder<T extends { folderId: string | null }>(
    rows: T[],
    folderId: FolderId | null | undefined
  ): Promise<T[]> {
    if (folderId === undefined) {
      return rows;
    }

    if (folderId === null) {
      return rows.filter((row) => row.folderId === null);
    }

    const ids = await subtreeIds(folderId);

    return rows.filter((row) => row.folderId !== null && ids.has(row.folderId));
  }

  const workspaces: WorkspaceRepository = {
    get(id) {
      return run(async () => {
        const row = await db.workspaces.get(id);

        return row === undefined ? null : toWorkspace(row);
      });
    },
    list() {
      return run(async () => (await db.workspaces.toArray()).map(toWorkspace));
    },
    create(input) {
      return run(async () =>
        withSyncWrite([db.workspaces], async () => {
          const at = requireAt(input.at);
          const row: WorkspaceRow = {
            id: generateId(),
            name: input.name,
            createdAt: at,
            updatedAt: at,
          };
          await db.workspaces.add(row);

          return {
            result: toWorkspace(row),
            changes: [
              {
                workspaceId: row.id,
                entityType: "workspace",
                entityId: row.id,
                operation: "create",
                fieldPatches: { name: row.name },
                at,
                contentHash: null,
              },
            ],
          };
        })
      );
    },
    update(id, patch) {
      return run(async () =>
        withSyncWrite([db.workspaces], async () => {
          const row = await db.workspaces.get(id);

          if (row === undefined) {
            throw new NotFoundError("Workspace does not exist.");
          }

          const at = requireAt(patch.at);
          const next: WorkspaceRow = {
            ...row,
            name: patch.name,
            updatedAt: laterOf(at, row.updatedAt as IsoDate),
          };
          await db.workspaces.put(next);

          return {
            result: toWorkspace(next),
            changes: [
              {
                workspaceId: id,
                entityType: "workspace",
                entityId: id,
                operation: "update",
                fieldPatches: { name: next.name },
                at: next.updatedAt,
                contentHash: null,
              },
            ],
          };
        })
      );
    },
    delete(id) {
      return run(async () =>
        withSyncWrite(
          [
            db.workspaces,
            db.folders,
            db.files,
            db.notes,
            db.tags,
            db.fileTags,
            db.noteTags,
            db.noteLinks,
          ],
          async () => {
            if ((await db.workspaces.get(id)) === undefined) {
              throw new NotFoundError("Workspace does not exist.");
            }

            const at = new Date().toISOString();
            const folders = await db.folders.where("workspaceId").equals(id).toArray();
            const files = await db.files.where("workspaceId").equals(id).toArray();
            const notes = await db.notes.where("workspaceId").equals(id).toArray();
            const tags = await db.tags.where("workspaceId").equals(id).toArray();
            const tagIds = new Set(tags.map((row) => row.id));
            const fileIds = new Set(files.map((row) => row.id));
            const noteIds = new Set(notes.map((row) => row.id));
            const changes: SyncChange[] = [
              {
                workspaceId: id,
                entityType: "workspace",
                entityId: id,
                operation: "delete",
                fieldPatches: {},
                at,
                contentHash: null,
              },
              ...folders.map((row) => ({
                workspaceId: id,
                entityType: "folder" as const,
                entityId: row.id,
                operation: "delete" as const,
                fieldPatches: {},
                at,
                contentHash: null,
              })),
              ...files.map((row) => ({
                workspaceId: id,
                entityType: "file" as const,
                entityId: row.id,
                operation: "delete" as const,
                fieldPatches: {},
                at,
                contentHash: null,
              })),
              ...notes.map((row) => ({
                workspaceId: id,
                entityType: "note" as const,
                entityId: row.id,
                operation: "delete" as const,
                fieldPatches: {},
                at,
                contentHash: null,
              })),
              ...tags.map((row) => ({
                workspaceId: id,
                entityType: "tag" as const,
                entityId: row.id,
                operation: "delete" as const,
                fieldPatches: {},
                at,
                contentHash: null,
              })),
            ];

            await db.folders.where("workspaceId").equals(id).delete();
            await db.files.where("workspaceId").equals(id).delete();
            await db.notes.where("workspaceId").equals(id).delete();
            await db.tags.where("workspaceId").equals(id).delete();

            await db.fileTags
              .filter((row) => fileIds.has(row.fileId) || tagIds.has(row.tagId))
              .delete();
            await db.noteTags
              .filter((row) => noteIds.has(row.noteId) || tagIds.has(row.tagId))
              .delete();
            await db.noteLinks
              .filter(
                (row) => noteIds.has(row.sourceNoteId) || noteIds.has(row.targetNoteId)
              )
              .delete();
            await db.workspaces.delete(id);

            return { result: undefined, changes };
          }
        )
      );
    },
    ensureWorkspace(input) {
      return run(async () => {
        const ensured = await withSyncWrite([db.workspaces], async () => {
          const all = await db.workspaces.toArray();

          if (all.length > 1) {
            return { result: null, changes: [] };
          }

          const existing = all[0];

          if (existing !== undefined) {
            return { result: toWorkspace(existing), changes: [] };
          }

          const at = requireAt(input?.at);
          const row: WorkspaceRow = {
            id: generateId(),
            name: input?.name ?? DEFAULT_WORKSPACE_NAME,
            createdAt: at,
            updatedAt: at,
          };
          await db.workspaces.add(row);

          return {
            result: toWorkspace(row),
            changes: [
              {
                workspaceId: row.id,
                entityType: "workspace" as const,
                entityId: row.id,
                operation: "create" as const,
                fieldPatches: { name: row.name },
                at,
                contentHash: null,
              },
            ],
          };
        });

        if (ensured === null) {
          throw new ConstraintError(
            "More than one workspace exists; refusing to guess which to use.",
            "multiple_workspaces"
          );
        }

        return ensured;
      });
    },
  };

  const folders: FolderRepository = {
    create(input) {
      return run(async () =>
        withSyncWrite([db.folders], async () => {
          const at = requireAt(input.at);

          if (input.parentId !== null) {
            await requireFolder(input.parentId);
          }

          const row: FolderRow = {
            id: generateId(),
            workspaceId: input.workspaceId,
            parentId: input.parentId,
            name: input.name,
            createdAt: at,
            updatedAt: at,
          };
          await db.folders.add(row);

          return {
            result: toFolder(row),
            changes: [
              {
                workspaceId: row.workspaceId,
                entityType: "folder" as const,
                entityId: row.id,
                operation: "create" as const,
                fieldPatches: { name: row.name, parentId: row.parentId },
                at,
                contentHash: null,
              },
            ],
          };
        })
      );
    },
    get(id) {
      return run(async () => {
        const row = await db.folders.get(id);

        return row === undefined ? null : toFolder(row);
      });
    },
    update(id, patch) {
      return run(async () =>
        withSyncWrite([db.folders], async () => {
          const row = await requireFolder(id);
          const at = requireAt(patch.at);
          const next: FolderRow = {
            ...row,
            name: patch.name ?? row.name,
            parentId: patch.parentId === undefined ? row.parentId : patch.parentId,
            updatedAt: laterOf(at, row.updatedAt as IsoDate),
          };
          await db.folders.put(next);
          const fieldPatches: Record<string, unknown> = {};

          if (patch.name !== undefined) {
            fieldPatches.name = next.name;
          }
          if (patch.parentId !== undefined) {
            fieldPatches.parentId = next.parentId;
          }

          return {
            result: toFolder(next),
            changes: [
              {
                workspaceId: next.workspaceId,
                entityType: "folder" as const,
                entityId: next.id,
                operation: "update" as const,
                fieldPatches,
                at: next.updatedAt,
                contentHash: null,
              },
            ],
          };
        })
      );
    },
    delete(id) {
      return run(async () =>
        withSyncWrite([db.folders, db.files, db.notes], async () => {
          const folder = await requireFolder(id);
          const at = new Date().toISOString();
          const childFolders = await db.folders.where("parentId").equals(id).toArray();
          const files = await db.files.where("folderId").equals(id).toArray();
          const notes = await db.notes.where("folderId").equals(id).toArray();
          const changes: SyncChange[] = [
            {
              workspaceId: folder.workspaceId,
              entityType: "folder",
              entityId: id,
              operation: "delete",
              fieldPatches: {},
              at,
              contentHash: null,
            },
            ...childFolders.map((row) => ({
              workspaceId: row.workspaceId,
              entityType: "folder" as const,
              entityId: row.id,
              operation: "update" as const,
              fieldPatches: { parentId: null },
              at,
              contentHash: null,
            })),
            ...files.map((row) => ({
              workspaceId: row.workspaceId,
              entityType: "file" as const,
              entityId: row.id,
              operation: "update" as const,
              fieldPatches: { folderId: null },
              at,
              contentHash: row.checksum ?? null,
            })),
            ...notes.map((row) => ({
              workspaceId: row.workspaceId,
              entityType: "note" as const,
              entityId: row.id,
              operation: "update" as const,
              fieldPatches: { folderId: null },
              at,
              contentHash: null,
            })),
          ];

          await db.folders.where("parentId").equals(id).modify({ parentId: null });
          await db.files.where("folderId").equals(id).modify({ folderId: null });
          await db.notes.where("folderId").equals(id).modify({ folderId: null });
          await db.folders.delete(id);

          return { result: undefined, changes };
        })
      );
    },
    list(workspaceId, options) {
      return run(async () => {
        const rows = await db.folders.where("workspaceId").equals(workspaceId).toArray();
        const sort = options?.sort ?? "name";

        return mapPage(
          paginate(
            rows,
            options,
            (row) => sortValueOf(sort, { ...row }, false),
            (row) => row.id
          ),
          toFolder
        );
      });
    },
    listChildren(workspaceId, parentId) {
      return run(async () => {
        const rows = await db.folders.where("workspaceId").equals(workspaceId).toArray();

        return rows.filter((row) => row.parentId === parentId).map(toFolder);
      });
    },
    ancestors(id) {
      return run(async () => {
        const chain: Folder[] = [];
        let cursor = (await db.folders.get(id))?.parentId ?? null;

        while (cursor !== null) {
          const parent = await db.folders.get(cursor);

          if (parent === undefined) {
            break;
          }

          chain.unshift(toFolder(parent));
          cursor = parent.parentId;
        }

        return chain;
      });
    },
    descendants(id) {
      return run(async () => {
        const ids = await subtreeIds(id);
        ids.delete(id);

        const rows = await db.folders.toArray();

        return rows.filter((row) => ids.has(row.id)).map(toFolder);
      });
    },
  };

  const files: FileRepository = {
    create(input) {
      return run(async () =>
        withSyncWrite([db.files], async () => {
          const at = requireAt(input.at);
          const row: FileRow = {
            id: generateId(),
            workspaceId: input.workspaceId,
            folderId: input.folderId,
            name: input.name,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            blobKey: input.blobKey,
            checksum: input.checksum,
            createdAt: at,
            updatedAt: at,
          };
          await db.files.add(row);

          return {
            result: toFile(row),
            changes: [
              {
                workspaceId: row.workspaceId,
                entityType: "file" as const,
                entityId: row.id,
                operation: "create" as const,
                fieldPatches: {
                  name: row.name,
                  folderId: row.folderId,
                  mimeType: row.mimeType,
                  tagIds: [],
                },
                at,
                contentHash: row.checksum ?? null,
              },
            ],
          };
        })
      );
    },
    get(id) {
      return run(async () => {
        const row = await db.files.get(id);

        return row === undefined ? null : toFile(row);
      });
    },
    update(id, patch) {
      return run(async () =>
        withSyncWrite([db.files], async () => {
          const row = await requireFile(id);
          const at = requireAt(patch.at);
          const next: FileRow = {
            ...row,
            name: patch.name ?? row.name,
            folderId: patch.folderId === undefined ? row.folderId : patch.folderId,
            updatedAt: laterOf(at, row.updatedAt as IsoDate),
          };
          await db.files.put(next);
          const fieldPatches: Record<string, unknown> = {};

          if (patch.name !== undefined) {
            fieldPatches.name = next.name;
          }
          if (patch.folderId !== undefined) {
            fieldPatches.folderId = next.folderId;
          }

          return {
            result: toFile(next),
            changes: [
              {
                workspaceId: next.workspaceId,
                entityType: "file" as const,
                entityId: next.id,
                operation: "update" as const,
                fieldPatches,
                at: next.updatedAt,
                contentHash: next.checksum ?? null,
              },
            ],
          };
        })
      );
    },
    delete(id) {
      return run(async () =>
        withSyncWrite([db.files, db.fileTags], async () => {
          const row = await requireFile(id);
          const at = new Date().toISOString();

          await db.fileTags.where("fileId").equals(id).delete();
          await db.files.delete(id);

          return {
            result: undefined,
            changes: [
              {
                workspaceId: row.workspaceId,
                entityType: "file" as const,
                entityId: id,
                operation: "delete" as const,
                fieldPatches: {},
                at,
                contentHash: null,
              },
            ],
          };
        })
      );
    },
    list(workspaceId, filter, options) {
      return run(async () => {
        let rows = await db.files.where("workspaceId").equals(workspaceId).toArray();
        rows = await filterByFolder(rows, filter.folderId);

        if (filter.mimeTypes !== undefined) {
          const allowed = new Set(filter.mimeTypes);
          rows = rows.filter((row) => row.mimeType !== null && allowed.has(row.mimeType));
        }

        if (filter.tagIds !== undefined && filter.tagIds.length > 0) {
          const required = [...new Set<string>(filter.tagIds)];
          const matches: FileRow[] = [];

          for (const row of rows) {
            const owned = await fileTagIds(row.id);

            if (required.every((tagId) => owned.has(tagId))) {
              matches.push(row);
            }
          }

          rows = matches;
        }

        if (filter.text !== undefined) {
          const tokens = searchTokens(filter.text);

          if (tokens.length > 0) {
            rows = rows.filter((row) => matchesTokens(row.name, tokens));
          }
        }

        const sort = options?.sort ?? "name";

        return mapPage(
          paginate(
            rows,
            options,
            (row) => sortValueOf(sort, { ...row }, false),
            (row) => row.id
          ),
          toFile
        );
      });
    },
    setTags(id, tagIds) {
      return run(async () =>
        withSyncWrite([db.files, db.fileTags], async () => {
          const row = await requireFile(id);
          const at = new Date().toISOString();
          const unique = canonicalIdList(tagIds);

          await db.fileTags.where("fileId").equals(id).delete();

          for (const tagId of unique) {
            await db.fileTags.put({ fileId: id, tagId });
          }

          return {
            result: undefined,
            changes: [
              {
                workspaceId: row.workspaceId,
                entityType: "file" as const,
                entityId: id,
                operation: "update" as const,
                fieldPatches: { tagIds: unique },
                at,
                contentHash: row.checksum ?? null,
              },
            ],
          };
        })
      );
    },
    tags(id) {
      return run(async () => {
        const ids = await fileTagIds(id);
        const rows = await db.tags.toArray();

        return rows.filter((row) => ids.has(row.id)).map(toTag);
      });
    },
  };

  const notes: NoteRepository = {
    create(input) {
      return run(async () =>
        withSyncWrite([db.notes], async () => {
          const at = requireAt(input.at);
          const row: NoteRow = {
            id: generateId(),
            workspaceId: input.workspaceId,
            folderId: input.folderId,
            title: input.title,
            content: input.content ?? "",
            pinned: input.pinned === true ? 1 : 0,
            createdAt: at,
            updatedAt: at,
          };
          await db.notes.add(row);

          return {
            result: toNote(row),
            changes: [
              {
                workspaceId: row.workspaceId,
                entityType: "note" as const,
                entityId: row.id,
                operation: "create" as const,
                fieldPatches: {
                  title: row.title,
                  content: row.content,
                  folderId: row.folderId,
                  pinned: row.pinned === 1,
                  tagIds: [],
                  targetNoteIds: [],
                },
                at,
                contentHash: null,
              },
            ],
          };
        })
      );
    },
    get(id) {
      return run(async () => {
        const row = await db.notes.get(id);

        return row === undefined ? null : toNote(row);
      });
    },
    update(id, patch) {
      return run(async () =>
        withSyncWrite([db.notes], async () => {
          const row = await db.notes.get(id);

          if (row === undefined) {
            throw new NotFoundError("Note does not exist.");
          }

          const at = requireAt(patch.at);
          const changes: Partial<NoteRow> = {
            updatedAt: laterOf(at, row.updatedAt as IsoDate),
          };

          if (patch.title !== undefined) {
            changes.title = patch.title;
          }

          if (patch.content !== undefined) {
            changes.content = patch.content;
          }

          if (patch.folderId !== undefined) {
            changes.folderId = patch.folderId;
          }

          if (patch.pinned !== undefined) {
            changes.pinned = patch.pinned ? 1 : 0;
          }

          await db.notes.update(id, changes);

          const next: NoteRow = {
            ...row,
            title: changes.title ?? row.title,
            content: changes.content ?? row.content,
            folderId: changes.folderId === undefined ? row.folderId : changes.folderId,
            pinned: changes.pinned === undefined ? row.pinned : changes.pinned,
            updatedAt: changes.updatedAt ?? row.updatedAt,
          };
          const fieldPatches: Record<string, unknown> = {};

          if (patch.title !== undefined) {
            fieldPatches.title = next.title;
          }
          if (patch.content !== undefined) {
            fieldPatches.content = next.content;
          }
          if (patch.folderId !== undefined) {
            fieldPatches.folderId = next.folderId;
          }
          if (patch.pinned !== undefined) {
            fieldPatches.pinned = next.pinned === 1;
          }

          return {
            result: toNote(next),
            changes: [
              {
                workspaceId: next.workspaceId,
                entityType: "note" as const,
                entityId: next.id,
                operation: "update" as const,
                fieldPatches,
                at: next.updatedAt,
                contentHash: null,
              },
            ],
          };
        })
      );
    },
    delete(id) {
      return run(async () =>
        withSyncWrite([db.notes, db.noteTags, db.noteLinks], async () => {
          const row = await requireNote(id);
          const at = new Date().toISOString();
          const incoming = await db.noteLinks.where("targetNoteId").equals(id).toArray();
          const sourceIds = [...new Set(incoming.map((link) => link.sourceNoteId))];
          const sources = await Promise.all(
            sourceIds.map(async (sourceId) => {
              const links = await db.noteLinks
                .where("sourceNoteId")
                .equals(sourceId)
                .toArray();

              return {
                sourceId,
                targetNoteIds: canonicalIdList(
                  links
                    .map((link) => link.targetNoteId)
                    .filter((targetId) => targetId !== id)
                ),
              };
            })
          );
          const changes: SyncChange[] = [
            {
              workspaceId: row.workspaceId,
              entityType: "note",
              entityId: id,
              operation: "delete",
              fieldPatches: {},
              at,
              contentHash: null,
            },
            ...sources.map((source) => ({
              workspaceId: row.workspaceId,
              entityType: "note" as const,
              entityId: source.sourceId,
              operation: "update" as const,
              fieldPatches: { targetNoteIds: source.targetNoteIds },
              at,
              contentHash: null,
            })),
          ];

          await db.noteTags.where("noteId").equals(id).delete();
          await db.noteLinks.where("sourceNoteId").equals(id).delete();
          await db.noteLinks.where("targetNoteId").equals(id).delete();
          await db.notes.delete(id);

          return { result: undefined, changes };
        })
      );
    },
    list(workspaceId, filter, options) {
      return run(async () => {
        let rows = await db.notes.where("workspaceId").equals(workspaceId).toArray();
        rows = await filterByFolder(rows, filter.folderId);

        if (filter.pinned !== undefined) {
          const wanted = filter.pinned ? 1 : 0;
          rows = rows.filter((row) => row.pinned === wanted);
        }

        if (filter.tagIds !== undefined && filter.tagIds.length > 0) {
          const required = [...new Set<string>(filter.tagIds)];
          const matches: NoteRow[] = [];

          for (const row of rows) {
            const owned = await noteTagIds(row.id);

            if (required.every((tagId) => owned.has(tagId))) {
              matches.push(row);
            }
          }

          rows = matches;
        }

        if (filter.text !== undefined) {
          const tokens = searchTokens(filter.text);

          if (tokens.length > 0) {
            rows = rows.filter((row) =>
              matchesTokens(`${row.title} ${row.content}`, tokens)
            );
          }
        }

        const sort = options?.sort ?? "name";

        return mapPage(
          paginate(
            rows,
            options,
            (row) => sortValueOf(sort, { ...row }, true),
            (row) => row.id
          ),
          toNote
        );
      });
    },
    setTags(id, tagIds) {
      return run(async () =>
        withSyncWrite([db.notes, db.noteTags], async () => {
          const row = await requireNote(id);
          const at = new Date().toISOString();
          const unique = canonicalIdList(tagIds);

          await db.noteTags.where("noteId").equals(id).delete();

          for (const tagId of unique) {
            await db.noteTags.put({ noteId: id, tagId });
          }

          return {
            result: undefined,
            changes: [
              {
                workspaceId: row.workspaceId,
                entityType: "note" as const,
                entityId: id,
                operation: "update" as const,
                fieldPatches: { tagIds: unique },
                at,
                contentHash: null,
              },
            ],
          };
        })
      );
    },
    tags(id) {
      return run(async () => {
        const ids = await noteTagIds(id);
        const rows = await db.tags.toArray();

        return rows.filter((row) => ids.has(row.id)).map(toTag);
      });
    },
    setLinks(id, targetIds) {
      return run(async () =>
        withSyncWrite([db.notes, db.noteLinks], async () => {
          const row = await requireNote(id);
          const at = new Date().toISOString();
          const unique = canonicalIdList(targetIds);

          for (const targetId of unique) {
            assertNoSelfLink(id, targetId);
          }

          await db.noteLinks.where("sourceNoteId").equals(id).delete();

          for (const targetId of unique) {
            await db.noteLinks.put({ sourceNoteId: id, targetNoteId: targetId });
          }

          return {
            result: undefined,
            changes: [
              {
                workspaceId: row.workspaceId,
                entityType: "note" as const,
                entityId: id,
                operation: "update" as const,
                fieldPatches: { targetNoteIds: unique },
                at,
                contentHash: null,
              },
            ],
          };
        })
      );
    },
    links(id) {
      return run(async () => {
        const rows = await db.noteLinks.where("sourceNoteId").equals(id).toArray();

        return rows.map((row) => ({
          sourceNoteId: row.sourceNoteId,
          targetNoteId: row.targetNoteId,
        })) as NoteLink[];
      });
    },
  };

  const tags: TagRepository = {
    create(input) {
      return run(async () =>
        withSyncWrite([db.tags], async () => {
          const at = requireAt(input.at);
          const { display } = normalizeTagName(input.name);
          const row: TagRow = {
            id: generateId(),
            workspaceId: input.workspaceId,
            name: display,
            color: input.color ?? null,
            createdAt: at,
          };

          try {
            await db.tags.add(row);
          } catch (error) {
            if (isUniqueViolation(error)) {
              throw new ConflictError(
                "A tag with that name already exists.",
                "duplicate_tag_name",
                { cause: error }
              );
            }

            throw error;
          }

          return {
            result: toTag(row),
            changes: [
              {
                workspaceId: row.workspaceId,
                entityType: "tag" as const,
                entityId: row.id,
                operation: "create" as const,
                fieldPatches: { name: row.name, color: row.color },
                at,
                contentHash: null,
              },
            ],
          };
        })
      );
    },
    get(id) {
      return run(async () => {
        const row = await db.tags.get(id);

        return row === undefined ? null : toTag(row);
      });
    },
    update(id, patch) {
      return run(async () =>
        withSyncWrite([db.tags], async () => {
          const row = await requireTag(id);
          const at = requireAt(patch.at);
          const next: TagRow = {
            ...row,
            name:
              patch.name === undefined ? row.name : normalizeTagName(patch.name).display,
            color: patch.color === undefined ? row.color : patch.color,
          };

          try {
            await db.tags.put(next);
          } catch (error) {
            if (isUniqueViolation(error)) {
              throw new ConflictError(
                "A tag with that name already exists.",
                "duplicate_tag_name",
                { cause: error }
              );
            }

            throw error;
          }

          const fieldPatches: Record<string, unknown> = {};

          if (patch.name !== undefined) {
            fieldPatches.name = next.name;
          }
          if (patch.color !== undefined) {
            fieldPatches.color = next.color;
          }

          return {
            result: toTag(next),
            changes: [
              {
                workspaceId: next.workspaceId,
                entityType: "tag" as const,
                entityId: next.id,
                operation: "update" as const,
                fieldPatches,
                at,
                contentHash: null,
              },
            ],
          };
        })
      );
    },
    delete(id) {
      return run(async () =>
        withSyncWrite([db.tags, db.fileTags, db.noteTags, db.files], async () => {
          const row = await requireTag(id);
          const at = new Date().toISOString();
          const fileLinks = await db.fileTags.where("tagId").equals(id).toArray();
          const noteLinks = await db.noteTags.where("tagId").equals(id).toArray();
          const filePatchIds = [...new Set(fileLinks.map((link) => link.fileId))];
          const notePatchIds = [...new Set(noteLinks.map((link) => link.noteId))];
          const files = await Promise.all(
            filePatchIds.map(async (fileId) => {
              const links = await db.fileTags.where("fileId").equals(fileId).toArray();
              const file = await db.files.get(fileId);

              return {
                fileId,
                tagIds: canonicalIdList(
                  links.map((link) => link.tagId).filter((tagId) => tagId !== id)
                ),
                contentHash: file?.checksum ?? null,
              };
            })
          );
          const notes = await Promise.all(
            notePatchIds.map(async (noteId) => {
              const links = await db.noteTags.where("noteId").equals(noteId).toArray();

              return {
                noteId,
                tagIds: canonicalIdList(
                  links.map((link) => link.tagId).filter((tagId) => tagId !== id)
                ),
              };
            })
          );
          const changes: SyncChange[] = [
            {
              workspaceId: row.workspaceId,
              entityType: "tag",
              entityId: id,
              operation: "delete",
              fieldPatches: {},
              at,
              contentHash: null,
            },
            ...files.map((file) => ({
              workspaceId: row.workspaceId,
              entityType: "file" as const,
              entityId: file.fileId,
              operation: "update" as const,
              fieldPatches: { tagIds: file.tagIds },
              at,
              contentHash: file.contentHash,
            })),
            ...notes.map((note) => ({
              workspaceId: row.workspaceId,
              entityType: "note" as const,
              entityId: note.noteId,
              operation: "update" as const,
              fieldPatches: { tagIds: note.tagIds },
              at,
              contentHash: null,
            })),
          ];

          await db.fileTags.where("tagId").equals(id).delete();
          await db.noteTags.where("tagId").equals(id).delete();
          await db.tags.delete(id);

          return { result: undefined, changes };
        })
      );
    },
    list(workspaceId, options) {
      return run(async () => {
        const rows = await db.tags.where("workspaceId").equals(workspaceId).toArray();
        const sort = options?.sort ?? "name";

        return mapPage(
          paginate(
            rows,
            options,
            (row) =>
              sort === "name"
                ? normalizeForSearch(row.name)
                : sortValueOf(sort, { ...row }, false),
            (row) => row.id
          ),
          toTag
        );
      });
    },
    findByName(workspaceId, key) {
      return run(async () => {
        const rows = await db.tags.where("workspaceId").equals(workspaceId).toArray();
        const row = rows.find(
          (candidate) => normalizeTagName(candidate.name).key === key
        );

        return row === undefined ? null : toTag(row);
      });
    },
  };

  const search: SearchRepository = {
    search(query) {
      return run(async () => {
        const tokens = searchTokens(query.text);

        if (tokens.length === 0) {
          return [];
        }

        const foldedQuery = normalizeForSearch(query.text);
        const kinds = new Set(query.kinds ?? ["file", "note"]);
        const hits: SearchHit[] = [];

        if (kinds.has("file")) {
          let rows = await db.files
            .where("workspaceId")
            .equals(query.workspaceId)
            .toArray();
          rows = await filterByFolder(rows, query.folderId);

          if (query.tagIds !== undefined && query.tagIds.length > 0) {
            const required = [...new Set<string>(query.tagIds)];
            const matches: FileRow[] = [];

            for (const row of rows) {
              const owned = await fileTagIds(row.id);

              if (required.every((tagId) => owned.has(tagId))) {
                matches.push(row);
              }
            }

            rows = matches;
          }

          for (const row of rows) {
            if (matchesTokens(row.name, tokens)) {
              hits.push({
                kind: "file",
                id: row.id,
                title: row.name,
                snippet: snippetOf(row.name, tokens),
                score: 0,
              });
            }
          }
        }

        if (kinds.has("note")) {
          let rows = await db.notes
            .where("workspaceId")
            .equals(query.workspaceId)
            .toArray();
          rows = await filterByFolder(rows, query.folderId);

          if (query.tagIds !== undefined && query.tagIds.length > 0) {
            const required = [...new Set<string>(query.tagIds)];
            const matches: NoteRow[] = [];

            for (const row of rows) {
              const owned = await noteTagIds(row.id);

              if (required.every((tagId) => owned.has(tagId))) {
                matches.push(row);
              }
            }

            rows = matches;
          }

          for (const row of rows) {
            if (matchesTokens(`${row.title} ${row.content}`, tokens)) {
              hits.push({
                kind: "note",
                id: row.id,
                title: row.title,
                snippet: snippetOf(`${row.title} ${row.content}`, tokens),
                score: 0,
              });
            }
          }
        }

        const tierOf = (hit: SearchHit): number => {
          const foldedTitle = normalizeForSearch(hit.title);

          if (foldedTitle === foldedQuery) {
            return 0;
          }

          if (foldedTitle.startsWith(foldedQuery)) {
            return 1;
          }

          if (
            tokens.every((token) =>
              foldedTitle.split(" ").some((word) => word.startsWith(token))
            )
          ) {
            return 2;
          }

          return 3;
        };

        const offset = query.offset ?? 0;
        const limit = query.limit ?? DEFAULT_LIMIT;

        return hits
          .sort((left, right) => {
            const tier = tierOf(left) - tierOf(right);

            if (tier !== 0) {
              return tier;
            }

            const leftTitle = normalizeForSearch(left.title);
            const rightTitle = normalizeForSearch(right.title);

            if (leftTitle !== rightTitle) {
              return leftTitle < rightTitle ? -1 : 1;
            }

            return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
          })
          .slice(offset, offset + limit);
      });
    },
    reindexAll() {
      return run(async () => undefined);
    },
  };

  const blobs: BlobStore = {
    put(key, data) {
      return run(async () => {
        const bytes =
          data instanceof Uint8Array
            ? new Uint8Array(data)
            : new Uint8Array(await data.arrayBuffer());
        const mimeType = data instanceof Uint8Array ? "" : data.type;
        const row: BlobRow = {
          key,
          type: mimeType,
          size: bytes.byteLength,
          data: bytes,
        };
        await db.blobs.put(row);
      });
    },
    get(key) {
      return run(async () => {
        const row = await db.blobs.get(key);

        if (row === undefined) {
          return null;
        }

        return new Blob([new Uint8Array(row.data).buffer], { type: row.type });
      });
    },
    delete(key) {
      return run(async () => {
        await db.blobs.delete(key);
      });
    },
    has(key) {
      return run(async () => (await db.blobs.get(key)) !== undefined);
    },
    usage() {
      return run(async () => {
        const rows = await db.blobs.toArray();

        return {
          bytes: rows.reduce((total, row) => total + row.size, 0),
          items: rows.length,
        };
      });
    },
    purgeOrphans(knownKeys) {
      return run(async () => {
        const known = new Set<string>(knownKeys);
        const rows = await db.blobs.toArray();
        const orphans = rows.filter((row) => !known.has(row.key)).map((row) => row.key);

        if (orphans.length > 0) {
          await db.blobs.bulkDelete(orphans);
        }

        return orphans.length;
      });
    },
  };

  const adapter: SyncCapableStorage = {
    kind: "dexie",
    schemaVersion: SCHEMA_VERSION,
    workspaces,
    folders,
    files,
    notes,
    tags,
    search,
    blobs,
    sync,
    async transaction(work) {
      guard();

      if (transactionDepth > 0) {
        throw new UnsupportedError(
          "Nested transactions are not supported.",
          "nested_transaction"
        );
      }

      const previousWorkspaceRevisions = currentWorkspaceRevisions;
      currentWorkspaceRevisions = new Map();
      transactionDepth += 1;

      try {
        return await db.transaction(
          "rw",
          [
            db.workspaces,
            db.folders,
            db.files,
            db.notes,
            db.tags,
            db.fileTags,
            db.noteTags,
            db.noteLinks,
            db.blobs,
            ...syncTables,
          ],
          async () => work(adapter)
        );
      } catch (error) {
        throw mapStorageError(error);
      } finally {
        transactionDepth -= 1;
        currentWorkspaceRevisions = previousWorkspaceRevisions;
      }
    },
    async init() {
      closed = false;

      try {
        await db.open();
        await bootstrapSync();
      } catch (error) {
        throw mapStorageError(error);
      }
    },
    async close() {
      if (closed) {
        return;
      }

      db.close();
      closed = true;
    },
    async reset() {
      return run(async () => {
        await db.transaction(
          "rw",
          [
            db.workspaces,
            db.folders,
            db.files,
            db.notes,
            db.tags,
            db.fileTags,
            db.noteTags,
            db.noteLinks,
            db.blobs,
            ...syncTables,
          ],
          async () => {
            for (const table of syncTables) {
              await table.clear();
            }

            await Promise.all([
              db.workspaces.clear(),
              db.folders.clear(),
              db.files.clear(),
              db.notes.clear(),
              db.tags.clear(),
              db.fileTags.clear(),
              db.noteTags.clear(),
              db.noteLinks.clear(),
              db.blobs.clear(),
            ]);
          }
        );
      });
    },
    async restore(snapshot) {
      return run(async () => {
        const parsed = parseSnapshot(snapshot);
        const prepared = await prepareSyncChanges({
          changes: restoreChanges(parsed),
          policy,
        });

        try {
          await db.transaction(
            "rw",
            [
              db.workspaces,
              db.folders,
              db.files,
              db.notes,
              db.tags,
              db.fileTags,
              db.noteTags,
              db.noteLinks,
              db.blobs,
              ...syncTables,
            ],
            async () => {
              const currentWorkspaces = await db.workspaces.toArray();
              for (const workspace of currentWorkspaces) {
                if (await sync.hasRemoteTarget(workspace.id)) {
                  throw new SyncError(
                    "Restore is blocked while a remote workspace target exists.",
                    "remote_target_present"
                  );
                }
              }

              const devices = await db.sync_devices.toArray();
              const installationDeviceId = devices[0]?.deviceId ?? generateId();
              const previousState = await db.workspace_sync_state.get([
                parsed.workspace.id,
                installationDeviceId,
              ]);
              const previousHighWater = previousState?.lastLocalSequence ?? 0;

              for (const table of syncTables) {
                await table.clear();
              }

              await Promise.all([
                db.workspaces.clear(),
                db.folders.clear(),
                db.files.clear(),
                db.notes.clear(),
                db.tags.clear(),
                db.fileTags.clear(),
                db.noteTags.clear(),
                db.noteLinks.clear(),
                db.blobs.clear(),
              ]);

              await db.workspaces.add({
                id: parsed.workspace.id,
                name: parsed.workspace.name,
                createdAt: parsed.workspace.createdAt,
                updatedAt: parsed.workspace.updatedAt,
              });
              await db.sync_devices.put({
                workspaceId: parsed.workspace.id,
                deviceId: installationDeviceId,
                registeredAt: parsed.workspace.updatedAt,
                lastSeenAt: parsed.workspace.updatedAt,
                lastAckedTombstoneWorkspaceRevision: 0,
                state: "active",
                publicKey: null,
              });
              await db.workspace_sync_state.put({
                workspaceId: parsed.workspace.id,
                deviceId: installationDeviceId,
                remoteWorkspaceId: null,
                lastServerCursor: null,
                lastLocalWorkspaceRevision: 0,
                lastLocalSequence: previousHighWater,
                tombstoneFloor: 0,
                lastFullResyncAt: parsed.workspace.updatedAt,
              });

              for (const folder of parsed.folders) {
                await db.folders.put({
                  id: folder.id,
                  workspaceId: folder.workspaceId,
                  parentId: folder.parentId,
                  name: folder.name,
                  createdAt: folder.createdAt,
                  updatedAt: folder.updatedAt,
                });
              }

              for (const file of parsed.files) {
                await db.files.put({
                  id: file.id,
                  workspaceId: file.workspaceId,
                  folderId: file.folderId,
                  name: file.name,
                  mimeType: file.mimeType,
                  sizeBytes: file.sizeBytes,
                  blobKey: file.blobKey,
                  checksum: file.checksum,
                  createdAt: file.createdAt,
                  updatedAt: file.updatedAt,
                });
              }

              for (const note of parsed.notes) {
                await db.notes.put({
                  id: note.id,
                  workspaceId: note.workspaceId,
                  folderId: note.folderId,
                  title: note.title,
                  content: note.content,
                  pinned: note.pinned ? 1 : 0,
                  createdAt: note.createdAt,
                  updatedAt: note.updatedAt,
                });
              }

              for (const tag of parsed.tags) {
                await db.tags.put({
                  id: tag.id,
                  workspaceId: tag.workspaceId,
                  name: tag.name,
                  color: tag.color,
                  createdAt: tag.createdAt,
                });
              }

              for (const link of parsed.fileTags) {
                await db.fileTags.put({ fileId: link.fileId, tagId: link.tagId });
              }

              for (const link of parsed.noteTags) {
                await db.noteTags.put({ noteId: link.noteId, tagId: link.tagId });
              }

              for (const link of parsed.noteLinks) {
                await db.noteLinks.put({
                  sourceNoteId: link.sourceNoteId,
                  targetNoteId: link.targetNoteId,
                });
              }

              for (const blob of parsed.blobs) {
                const bytes = new Uint8Array(blob.data);
                await db.blobs.put({
                  key: blob.key,
                  type: blob.mimeType,
                  size: bytes.byteLength,
                  data: bytes,
                });
              }

              await recordPreparedSyncChanges(sync, { changes: prepared, policy });
            }
          );
        } catch (error) {
          const inner =
            typeof error === "object" && error !== null
              ? (error as { inner?: unknown }).inner
              : undefined;
          if (inner !== undefined) {
            throw inner;
          }

          throw error;
        }
      });
    },
  };

  return adapter;
}

function matchesTokens(text: string, tokens: string[]): boolean {
  const words = normalizeForSearch(text)
    .split(" ")
    .filter((word) => word.length > 0);

  return tokens.every((token) => words.some((word) => word.startsWith(token)));
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "ConstraintError"
  );
}

function parseSnapshot(snapshot: BackupSnapshot): BackupSnapshot {
  const result = backupSnapshotSchema.safeParse(snapshot);

  if (!result.success) {
    throw new ValidationError(
      result.error.issues[0]?.message ?? "The snapshot is not valid.",
      { cause: result.error }
    );
  }

  return result.data;
}

function restoreChanges(snapshot: BackupSnapshot): SyncChange[] {
  const fileTags = new Map<string, string[]>();
  for (const link of snapshot.fileTags) {
    fileTags.set(link.fileId, [...(fileTags.get(link.fileId) ?? []), link.tagId]);
  }
  const noteTags = new Map<string, string[]>();
  for (const link of snapshot.noteTags) {
    noteTags.set(link.noteId, [...(noteTags.get(link.noteId) ?? []), link.tagId]);
  }
  const noteLinks = new Map<string, string[]>();
  for (const link of snapshot.noteLinks) {
    noteLinks.set(link.sourceNoteId, [
      ...(noteLinks.get(link.sourceNoteId) ?? []),
      link.targetNoteId,
    ]);
  }

  return [
    {
      workspaceId: snapshot.workspace.id,
      entityType: "workspace",
      entityId: snapshot.workspace.id,
      operation: "restore",
      fieldPatches: { name: snapshot.workspace.name },
      at: snapshot.workspace.updatedAt,
      contentHash: null,
    },
    ...snapshot.folders.map((folder) => ({
      workspaceId: folder.workspaceId,
      entityType: "folder" as const,
      entityId: folder.id,
      operation: "restore" as const,
      fieldPatches: { name: folder.name, parentId: folder.parentId },
      at: folder.updatedAt,
      contentHash: null,
    })),
    ...snapshot.files.map((file) => ({
      workspaceId: file.workspaceId,
      entityType: "file" as const,
      entityId: file.id,
      operation: "restore" as const,
      fieldPatches: {
        name: file.name,
        folderId: file.folderId,
        mimeType: file.mimeType,
        tagIds: canonicalIdList(fileTags.get(file.id) ?? []),
      },
      at: file.updatedAt,
      contentHash: file.checksum,
    })),
    ...snapshot.notes.map((note) => ({
      workspaceId: note.workspaceId,
      entityType: "note" as const,
      entityId: note.id,
      operation: "restore" as const,
      fieldPatches: {
        title: note.title,
        content: note.content,
        folderId: note.folderId,
        pinned: note.pinned,
        tagIds: canonicalIdList(noteTags.get(note.id) ?? []),
        targetNoteIds: canonicalIdList(noteLinks.get(note.id) ?? []),
      },
      at: note.updatedAt,
      contentHash: null,
    })),
    ...snapshot.tags.map((tag) => ({
      workspaceId: tag.workspaceId,
      entityType: "tag" as const,
      entityId: tag.id,
      operation: "restore" as const,
      fieldPatches: { name: tag.name, color: tag.color },
      at: tag.createdAt,
      contentHash: null,
    })),
  ];
}

function mapPage<T, R>(page: Page<T>, map: (row: T) => R): Page<R> {
  return {
    items: page.items.map(map),
    nextCursor: page.nextCursor,
    total: page.total,
  };
}
