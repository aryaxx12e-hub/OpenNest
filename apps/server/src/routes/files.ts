import type { IncomingMessage, ServerResponse } from "node:http";

import { limits } from "@opennest/core";

import type { AuthDatabase } from "../auth/auth-db";
import { HttpError } from "../errors";
import { sendJson, type Router } from "../http/router";
import {
  FileServiceError,
  type FileService,
  type FileServiceErrorCode,
} from "../files/file-service";
import { requireCsrf, requireSession } from "./auth";

const MAX_UPLOAD_BODY_BYTES = limits.maxFileSizeBytes + 1024 * 1024;

const ERROR_STATUS: Record<FileServiceErrorCode, number> = {
  forbidden: 403,
  file_too_large: 413,
  unsupported_mime_type: 415,
  invalid_file_name: 400,
  invalid_file_id: 400,
  invalid_version_id: 400,
  invalid_folder_id: 400,
  invalid_base_version: 400,
  base_version_required: 400,
  folder_not_found: 404,
  workspace_not_found: 404,
  not_found: 404,
  storage_error: 500,
};

export interface FileRouteDependencies {
  auth: AuthDatabase;
  files: FileService;
  now?: () => Date;
}

interface UploadedFile {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function mapFileError(error: unknown): unknown {
  if (error instanceof FileServiceError) {
    return new HttpError(ERROR_STATUS[error.code], error.code, error.message);
  }

  return error;
}

function isUploadedFile(value: unknown): value is UploadedFile {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { name?: unknown }).name === "string" &&
    typeof (value as { type?: unknown }).type === "string" &&
    typeof (value as { size?: unknown }).size === "number" &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function"
  );
}

function textField(form: FormData, name: string): string | null {
  const value = form.get(name);

  if (typeof value !== "string") {
    return null;
  }

  return value.length === 0 ? null : value;
}

async function readMultipartBody(request: IncomingMessage): Promise<FormData> {
  const contentType = request.headers["content-type"] ?? "";

  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new HttpError(
      415,
      "unsupported_media_type",
      "The request body must be multipart form data."
    );
  }

  const declaredLength = request.headers["content-length"];

  if (typeof declaredLength === "string" && /^\d+$/.test(declaredLength)) {
    const declaredBytes = Number(declaredLength);

    if (Number.isSafeInteger(declaredBytes) && declaredBytes > MAX_UPLOAD_BODY_BYTES) {
      request.resume();
      throw new HttpError(413, "payload_too_large", "The upload is too large.");
    }
  }

  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += bytes.length;

    if (size > MAX_UPLOAD_BODY_BYTES) {
      request.resume();
      throw new HttpError(413, "payload_too_large", "The upload is too large.");
    }

    chunks.push(bytes);
  }

  try {
    return await new Response(Buffer.concat(chunks), {
      headers: { "content-type": contentType },
    }).formData();
  } catch {
    throw new HttpError(400, "bad_request", "The upload form is not valid.");
  }
}

function encodeFilename(name: string): string {
  return encodeURIComponent(name).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function contentDisposition(name: string): string {
  const fallback =
    name
      .normalize("NFKD")
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/["\\]/g, "_")
      .slice(0, 150) || "download";

  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeFilename(name)}`;
}

function sendDownload(
  response: ServerResponse,
  data: Uint8Array,
  mimeType: string,
  fileName: string
): void {
  if (response.headersSent) {
    return;
  }

  response.writeHead(200, {
    "content-type": mimeType,
    "content-length": data.byteLength,
    "content-disposition": contentDisposition(fileName),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(Buffer.from(data));
}

export function registerFileRoutes(
  router: Router,
  dependencies: FileRouteDependencies
): void {
  const now = dependencies.now ?? (() => new Date());

  router.post("/api/files", async (request, response) => {
    try {
      const session = requireSession(request, dependencies.auth, now());
      requireCsrf(request, session.session);
      const workspace = dependencies.files.primaryWorkspace();

      if (workspace === null) {
        throw new HttpError(
          503,
          "workspace_unavailable",
          "The workspace is not available."
        );
      }

      const form = await readMultipartBody(request);
      const part = form.get("file");

      if (!isUploadedFile(part)) {
        throw new HttpError(400, "bad_request", "The upload is missing a file.");
      }

      const result = await dependencies.files.upload({
        workspaceId: workspace.id,
        actorId: session.user.id,
        role: session.membership.role,
        folderId: textField(form, "folderId"),
        fileId: textField(form, "fileId") ?? undefined,
        baseVersionId: textField(form, "baseVersionId"),
        name: part.name,
        mimeType: part.type,
        data: new Uint8Array(await part.arrayBuffer()),
      });

      sendJson(response, 201, result);
    } catch (error) {
      throw mapFileError(error);
    }
  });

  router.get("/api/files/:fileId", async (request, response, context) => {
    try {
      requireSession(request, dependencies.auth, now());
      const workspace = dependencies.files.primaryWorkspace();

      if (workspace === null) {
        throw new HttpError(
          503,
          "workspace_unavailable",
          "The workspace is not available."
        );
      }

      const versionId = context.url.searchParams.get("version") ?? undefined;
      const result = await dependencies.files.download({
        workspaceId: workspace.id,
        fileId: context.params.fileId ?? "",
        versionId,
      });

      sendDownload(response, result.data, result.mimeType, result.fileName);
    } catch (error) {
      throw mapFileError(error);
    }
  });
}
