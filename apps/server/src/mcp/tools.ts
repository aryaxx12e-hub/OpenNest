import type { StorageAdapter } from "@opennest/core";

export const MAX_MCP_CONTENT_BYTES = 64 * 1024;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const MAX_CURSOR_LENGTH = 512;
const MAX_QUERY_LENGTH = 500;
const MAX_ID_LENGTH = 128;
const TEXT_MIME_TYPES = new Set(["text/plain", "text/markdown"]);

export type McpToolErrorCode =
  | "invalid_arguments"
  | "unknown_tool"
  | "not_found"
  | "unsupported_file_type"
  | "content_too_large";

export class McpToolError extends Error {
  readonly code: McpToolErrorCode;

  constructor(code: McpToolErrorCode, message: string) {
    super(message);
    this.name = "McpToolError";
    this.code = code;
  }
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: readonly string[];
    additionalProperties: false;
  };
}

export interface McpToolContext {
  workspaceId: string;
}

export interface McpTools {
  list(): readonly McpToolDefinition[];
  call(name: string, args: unknown, context: McpToolContext): Promise<unknown>;
}

const TOOLS: readonly McpToolDefinition[] = [
  {
    name: "list_notes",
    description:
      "List note identifiers, titles, and timestamps from the token workspace.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
        cursor: { type: "string", maxLength: MAX_CURSOR_LENGTH },
      },
      additionalProperties: false,
    },
  },
  {
    name: "read_note",
    description:
      "Read one note's Markdown content and metadata from the token workspace.",
    inputSchema: {
      type: "object",
      properties: {
        noteId: { type: "string", minLength: 1, maxLength: MAX_ID_LENGTH },
      },
      required: ["noteId"],
      additionalProperties: false,
    },
  },
  {
    name: "search",
    description:
      "Search note content and text-readable file names in the token workspace.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: MAX_QUERY_LENGTH },
        limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "list_files",
    description: "List file metadata from the token workspace without file bytes.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
        cursor: { type: "string", maxLength: MAX_CURSOR_LENGTH },
      },
      additionalProperties: false,
    },
  },
  {
    name: "read_text_file",
    description: "Read one plain-text or Markdown file from the token workspace.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string", minLength: 1, maxLength: MAX_ID_LENGTH },
      },
      required: ["fileId"],
      additionalProperties: false,
    },
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): never {
  throw new McpToolError("invalid_arguments", message);
}

function assertKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      invalid("The tool arguments are not valid.");
    }
  }
}

function parseLimit(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_LIMIT;
  }

  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_LIMIT
  ) {
    invalid("The limit is not valid.");
  }

  return value;
}

function parseCursor(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_CURSOR_LENGTH
  ) {
    invalid("The cursor is not valid.");
  }

  return value;
}

function parseId(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH) {
    invalid(`The ${field} is not valid.`);
  }

  return value;
}

function parseQuery(value: unknown): string {
  if (typeof value !== "string") {
    invalid("The query is not valid.");
  }

  const query = value.trim();

  if (query.length === 0 || query.length > MAX_QUERY_LENGTH) {
    invalid("The query is not valid.");
  }

  return query;
}

function textBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function notFound(): never {
  throw new McpToolError("not_found", "The requested object was not found.");
}

export function createMcpTools(options: { storage: StorageAdapter }): McpTools {
  const { storage } = options;

  return {
    list() {
      return TOOLS;
    },

    async call(name, args, context) {
      if (!isRecord(args)) {
        invalid("The tool arguments are not valid.");
      }

      const workspaceId = context.workspaceId as never;

      switch (name) {
        case "list_notes": {
          assertKeys(args, ["limit", "cursor"]);
          const page = await storage.notes.list(
            workspaceId,
            {},
            {
              limit: parseLimit(args.limit),
              cursor: parseCursor(args.cursor),
            }
          );

          return {
            items: page.items.map((note) => ({
              id: note.id,
              title: note.title,
              pinned: note.pinned,
              folderId: note.folderId,
              createdAt: note.createdAt,
              updatedAt: note.updatedAt,
            })),
            nextCursor: page.nextCursor,
            total: page.total,
          };
        }

        case "read_note": {
          assertKeys(args, ["noteId"]);
          const noteId = parseId(args.noteId, "noteId");
          const note = await storage.notes.get(noteId as never);

          if (note === null || note.workspaceId !== workspaceId) {
            notFound();
          }

          if (textBytes(note.content) > MAX_MCP_CONTENT_BYTES) {
            throw new McpToolError(
              "content_too_large",
              "The note exceeds the MCP output limit."
            );
          }

          return {
            id: note.id,
            title: note.title,
            pinned: note.pinned,
            folderId: note.folderId,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
            content: note.content,
          };
        }

        case "search": {
          assertKeys(args, ["query", "limit"]);
          const hits = await storage.search.search({
            workspaceId,
            text: parseQuery(args.query),
            limit: parseLimit(args.limit),
          });

          return { hits };
        }

        case "list_files": {
          assertKeys(args, ["limit", "cursor"]);
          const page = await storage.files.list(
            workspaceId,
            {},
            {
              limit: parseLimit(args.limit),
              cursor: parseCursor(args.cursor),
            }
          );

          return {
            items: page.items.map((file) => ({
              id: file.id,
              name: file.name,
              mimeType: file.mimeType,
              sizeBytes: file.sizeBytes,
              folderId: file.folderId,
              createdAt: file.createdAt,
              updatedAt: file.updatedAt,
            })),
            nextCursor: page.nextCursor,
            total: page.total,
          };
        }

        case "read_text_file": {
          assertKeys(args, ["fileId"]);
          const fileId = parseId(args.fileId, "fileId");
          const file = await storage.files.get(fileId as never);

          if (file === null || file.workspaceId !== workspaceId) {
            notFound();
          }

          if (!TEXT_MIME_TYPES.has(file.mimeType ?? "")) {
            throw new McpToolError(
              "unsupported_file_type",
              "The file type is not readable as text."
            );
          }

          if (file.sizeBytes > MAX_MCP_CONTENT_BYTES) {
            throw new McpToolError(
              "content_too_large",
              "The file exceeds the MCP output limit."
            );
          }

          const blob = await storage.blobs.get(file.blobKey);

          if (blob === null) {
            notFound();
          }

          if (blob.size > MAX_MCP_CONTENT_BYTES) {
            throw new McpToolError(
              "content_too_large",
              "The file exceeds the MCP output limit."
            );
          }

          let content: string;

          try {
            content = new TextDecoder("utf-8", { fatal: true }).decode(
              await blob.arrayBuffer()
            );
          } catch {
            throw new McpToolError(
              "unsupported_file_type",
              "The file is not valid UTF-8 text."
            );
          }

          return {
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            folderId: file.folderId,
            createdAt: file.createdAt,
            updatedAt: file.updatedAt,
            content,
          };
        }

        default:
          throw new McpToolError("unknown_tool", "The tool does not exist.");
      }
    },
  };
}
