import { PrivacyError } from "./errors";
import { canonicalJson, sha256Hex } from "./hash";
import type { ResourceScope } from "./types";

export const MAX_SELECTED_ITEMS = 500;

const EXACT_ID_FORBIDDEN = /[*?/\\#]/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function normalizeScope(scope: ResourceScope): ResourceScope {
  switch (scope.kind) {
    case "workspace":
      return {
        kind: "workspace",
        workspaceId: exactId(scope.workspaceId, "workspaceId"),
      };
    case "folder":
      return {
        kind: "folder",
        workspaceId: exactId(scope.workspaceId, "workspaceId"),
        folderId: exactId(scope.folderId, "folderId"),
        includeDescendants: Boolean(scope.includeDescendants),
      };
    case "notes":
      return {
        kind: "notes",
        workspaceId: exactId(scope.workspaceId, "workspaceId"),
        noteIds: exactIds(scope.noteIds, "noteId"),
      };
    case "files":
      return {
        kind: "files",
        workspaceId: exactId(scope.workspaceId, "workspaceId"),
        fileIds: exactIds(scope.fileIds, "fileId"),
      };
    case "origin":
      return {
        kind: "origin",
        origin: normalizeOrigin(scope.origin),
      };
    case "provider":
      return {
        kind: "provider",
        providerId: exactId(scope.providerId, "providerId"),
      };
  }
}

export async function scopeDigest(scope: ResourceScope): Promise<string> {
  const normalized = normalizeScope(scope);
  const canonical =
    normalized.kind === "notes"
      ? { ...normalized, noteIds: [...normalized.noteIds].sort() }
      : normalized.kind === "files"
        ? { ...normalized, fileIds: [...normalized.fileIds].sort() }
        : normalized;

  return sha256Hex(canonicalJson(canonical));
}

export function assertScopeSubset(
  granted: ResourceScope,
  requested: ResourceScope
): void {
  const allowed = normalizeScope(granted);
  const wanted = normalizeScope(requested);

  if (allowed.kind === "workspace") {
    if (hasWorkspace(wanted) && wanted.workspaceId === allowed.workspaceId) {
      return;
    }

    throw denied();
  }

  if (allowed.kind === "folder") {
    if (
      wanted.kind === "folder" &&
      wanted.workspaceId === allowed.workspaceId &&
      wanted.folderId === allowed.folderId
    ) {
      return;
    }

    throw denied();
  }

  if (allowed.kind === "notes") {
    if (
      wanted.kind === "notes" &&
      wanted.workspaceId === allowed.workspaceId &&
      wanted.noteIds.every((id) => allowed.noteIds.includes(id))
    ) {
      return;
    }

    throw denied();
  }

  if (allowed.kind === "files") {
    if (
      wanted.kind === "files" &&
      wanted.workspaceId === allowed.workspaceId &&
      wanted.fileIds.every((id) => allowed.fileIds.includes(id))
    ) {
      return;
    }

    throw denied();
  }

  if (allowed.kind === "origin") {
    if (wanted.kind === "origin" && wanted.origin === allowed.origin) {
      return;
    }

    throw denied();
  }

  if (wanted.kind === "provider" && wanted.providerId === allowed.providerId) {
    return;
  }

  throw denied();
}

export function normalizeOrigin(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new PrivacyError("invalid_scope", "The origin is not a valid URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new PrivacyError("invalid_scope", "Only HTTP and HTTPS origins are allowed.");
  }

  if (url.username.length > 0 || url.password.length > 0) {
    throw new PrivacyError("invalid_scope", "Origins cannot contain credentials.");
  }

  if (url.search.length > 0 || url.hash.length > 0) {
    throw new PrivacyError(
      "invalid_scope",
      "Origins cannot contain a query or fragment."
    );
  }

  if (url.hostname.length === 0 || url.hostname.includes("*")) {
    throw new PrivacyError("invalid_scope", "The origin host is invalid.");
  }

  if (url.protocol === "http:" && !isLoopback(url.hostname)) {
    throw new PrivacyError("invalid_scope", "Plain HTTP is allowed only for loopback.");
  }

  return url.origin;
}

export function hasWorkspace(
  scope: ResourceScope
): scope is Extract<ResourceScope, { workspaceId: string }> {
  return (
    scope.kind === "workspace" ||
    scope.kind === "folder" ||
    scope.kind === "notes" ||
    scope.kind === "files"
  );
}

function exactId(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 200 ||
    value.trim() !== value ||
    value.includes("..") ||
    EXACT_ID_FORBIDDEN.test(value) ||
    CONTROL_CHARACTERS.test(value) ||
    /\s/.test(value)
  ) {
    throw new PrivacyError("invalid_scope", `The ${label} is invalid.`);
  }

  return value;
}

function exactIds(values: readonly string[], label: string): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new PrivacyError("invalid_scope", "A selected-entity scope cannot be empty.");
  }

  if (values.length > MAX_SELECTED_ITEMS) {
    throw new PrivacyError("invalid_scope", "The selected-entity scope is too large.");
  }

  const result = values.map((value) => exactId(value, label));

  if (new Set(result).size !== result.length) {
    throw new PrivacyError(
      "invalid_scope",
      "A selected-entity scope contains duplicates."
    );
  }

  return result;
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

function denied(): PrivacyError {
  return new PrivacyError("invalid_scope", "The requested scope is outside the grant.");
}
