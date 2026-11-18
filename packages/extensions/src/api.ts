export const EXTENSION_HOST_METHODS = [
  "workspace.getInfo",
  "workspace.summary",
  "workspace.listNotes",
  "workspace.listFiles",
  "workspace.readNote",
  "storage.get",
  "storage.set",
  "storage.delete",
  "storage.keys",
] as const;

export type ExtensionHostMethod = (typeof EXTENSION_HOST_METHODS)[number];

export interface ExtensionHostRequest {
  readonly id: string;
  readonly method: ExtensionHostMethod;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface ExtensionWorkspaceInfo {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ExtensionWorkspaceSummary {
  readonly notes: number;
  readonly files: number;
  readonly folders: number;
  readonly tags: number;
}

export interface ExtensionNoteMetadata {
  readonly id: string;
  readonly folderId: string | null;
  readonly title: string;
  readonly pinned: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ExtensionNote extends ExtensionNoteMetadata {
  readonly content: string;
}

export interface ExtensionFileMetadata {
  readonly id: string;
  readonly folderId: string | null;
  readonly name: string;
  readonly mimeType: string | null;
  readonly sizeBytes: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ExtensionPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly total: number;
}
