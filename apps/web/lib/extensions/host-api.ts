import type { AppServices } from "@/lib/data/services";
import type { Note, NoteId, StoredFile, Workspace } from "@opennest/core";
import {
  ExtensionError,
  type ExtensionCapability,
  type ExtensionFileMetadata,
  type ExtensionHostRequest,
  type ExtensionNote,
  type ExtensionNoteMetadata,
  type ExtensionPage,
  type ExtensionStorageStore,
  type ExtensionWorkspaceInfo,
  type ExtensionWorkspaceSummary,
} from "@opennest/extensions";
import type {
  CapabilityBroker,
  ResourceScope,
  WorkspaceCapability,
} from "@opennest/privacy";
import { z } from "zod";

import type { ExtensionAiCapability } from "./ai-capability";

const emptyParamsSchema = z.strictObject({});
const listParamsSchema = z.strictObject({
  limit: z.number().int().min(1).max(50).optional(),
  cursor: z.string().min(1).max(4_096).optional(),
});
const readNoteParamsSchema = z.strictObject({
  noteId: z.string().min(1).max(200),
});
const storageKeyParamsSchema = z.strictObject({
  key: z.string(),
});
const storageSetParamsSchema = z.strictObject({
  key: z.string(),
  value: z.string(),
});

export type {
  ExtensionFileMetadata,
  ExtensionNote,
  ExtensionNoteMetadata,
  ExtensionPage,
  ExtensionWorkspaceInfo,
  ExtensionWorkspaceSummary,
} from "@opennest/extensions";

export interface ExtensionHostApi {
  handle(request: ExtensionHostRequest): Promise<unknown>;
}

export interface ExtensionHostApiInput {
  readonly extensionId: string;
  readonly extensionName: string;
  readonly workspace: Workspace;
  readonly services: AppServices;
  readonly broker: CapabilityBroker;
  readonly storage: ExtensionStorageStore;
  readonly ai?: ExtensionAiCapability | null;
  readonly capabilities?: readonly ExtensionCapability[];
  readonly now: () => number;
}

function parseParams<T>(schema: z.ZodType<T>, params: unknown): T {
  const result = schema.safeParse(params);

  if (!result.success) {
    throw new ExtensionError("invalid_params", "The request parameters are invalid.");
  }

  return result.data;
}

function workspaceScope(workspaceId: string): ResourceScope {
  return { kind: "workspace", workspaceId };
}

function noteScope(workspaceId: string, noteId: string): ResourceScope {
  return { kind: "notes", workspaceId, noteIds: [noteId] };
}

function workspaceInfo(workspace: Workspace): ExtensionWorkspaceInfo {
  return {
    id: workspace.id,
    name: workspace.name,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}

function noteMetadata(note: Note): ExtensionNoteMetadata {
  return {
    id: note.id,
    folderId: note.folderId,
    title: note.title,
    pinned: note.pinned,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

function noteDto(note: Note): ExtensionNote {
  return {
    ...noteMetadata(note),
    content: note.content,
  };
}

function fileMetadata(file: StoredFile): ExtensionFileMetadata {
  return {
    id: file.id,
    folderId: file.folderId,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
}

function pageDto<T, R>(
  page: { items: readonly T[]; nextCursor: string | null; total: number },
  map: (item: T) => R
): ExtensionPage<R> {
  return {
    items: page.items.map(map),
    nextCursor: page.nextCursor,
    total: page.total,
  };
}

export function createExtensionHostApi(input: ExtensionHostApiInput): ExtensionHostApi {
  const { extensionId, extensionName, workspace, services, broker, storage } = input;
  const workspaceId = workspace.id;
  const ai = input.ai ?? null;
  const capabilities = input.capabilities ?? [];

  async function run<T>(
    capability: WorkspaceCapability,
    scope: ResourceScope,
    purpose: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const handle = await broker.request({
      capability,
      scope,
      purpose: `${purpose} for ${extensionName}`,
    });

    return broker.invoke(handle, () => operation());
  }

  return {
    async handle(request) {
      switch (request.method) {
        case "workspace.getInfo": {
          parseParams(emptyParamsSchema, request.params);

          return run(
            "workspace.read.metadata",
            workspaceScope(workspaceId),
            "Read workspace information",
            async () => workspaceInfo(workspace)
          );
        }

        case "workspace.summary": {
          parseParams(emptyParamsSchema, request.params);

          return run(
            "workspace.read.metadata",
            workspaceScope(workspaceId),
            "Read workspace summary",
            async () => {
              const [notes, files, folders, tags] = await Promise.all([
                services.note.list(workspaceId, {}, { limit: 1 }),
                services.file.list(workspaceId, {}, { limit: 1 }),
                services.folder.list(workspaceId, { limit: 1 }),
                services.tag.list(workspaceId, { limit: 1 }),
              ]);

              return {
                notes: notes.total,
                files: files.total,
                folders: folders.total,
                tags: tags.total,
              } satisfies ExtensionWorkspaceSummary;
            }
          );
        }

        case "workspace.listNotes": {
          const params = parseParams(listParamsSchema, request.params);

          return run(
            "workspace.read.metadata",
            workspaceScope(workspaceId),
            "List workspace notes",
            async () =>
              pageDto(
                await services.note.list(
                  workspaceId,
                  {},
                  { limit: params.limit ?? 50, cursor: params.cursor }
                ),
                noteMetadata
              )
          );
        }

        case "workspace.listFiles": {
          const params = parseParams(listParamsSchema, request.params);

          return run(
            "workspace.read.metadata",
            workspaceScope(workspaceId),
            "List workspace files",
            async () =>
              pageDto(
                await services.file.list(
                  workspaceId,
                  {},
                  { limit: params.limit ?? 50, cursor: params.cursor }
                ),
                fileMetadata
              )
          );
        }

        case "workspace.readNote": {
          const params = parseParams(readNoteParamsSchema, request.params);

          return run(
            "workspace.read.content",
            noteScope(workspaceId, params.noteId),
            "Read note content",
            async () => {
              const note = await services.note.get(params.noteId as NoteId);

              if (note === null || note.workspaceId !== workspaceId) {
                throw new ExtensionError(
                  "invalid_params",
                  "The note does not exist in this workspace."
                );
              }

              return noteDto(note);
            }
          );
        }

        case "ai.generate": {
          if (!capabilities.includes("ai.generate")) {
            throw new ExtensionError(
              "unknown_method",
              "The AI capability is not declared by this extension."
            );
          }

          if (ai === null) {
            throw new ExtensionError("ai_unavailable", "AI is not available.");
          }

          return ai.generate({ id: extensionId, name: extensionName }, request.params);
        }

        case "storage.get": {
          const params = parseParams(storageKeyParamsSchema, request.params);

          return storage.get(extensionId, params.key);
        }

        case "storage.set": {
          const params = parseParams(storageSetParamsSchema, request.params);

          return storage.set(extensionId, params.key, params.value);
        }

        case "storage.delete": {
          const params = parseParams(storageKeyParamsSchema, request.params);

          return storage.delete(extensionId, params.key);
        }

        case "storage.keys": {
          parseParams(emptyParamsSchema, request.params);

          return storage.keys(extensionId);
        }

        default:
          throw new ExtensionError(
            "unknown_method",
            `The host method ${String(request.method)} is not supported.`
          );
      }
    },
  };
}
