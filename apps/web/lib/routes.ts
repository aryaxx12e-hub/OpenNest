export function noteHref(noteId: string): string {
  return `/notes?noteId=${encodeURIComponent(noteId)}`;
}

export function folderHref(folderId: string | null): string {
  return folderId ? `/library?folderId=${encodeURIComponent(folderId)}` : "/library";
}

export function fileHref(fileId: string): string {
  return `/files?fileId=${encodeURIComponent(fileId)}`;
}

export function extensionHref(extensionId: string): string {
  return `/extensions?extensionId=${encodeURIComponent(extensionId)}`;
}

export function legacyRouteRedirect(pathname: string): string | null {
  const match = /^\/(notes|library|files|extensions)\/([^/]+)\/?$/.exec(pathname);

  if (!match) {
    return null;
  }

  let id: string;

  try {
    id = decodeURIComponent(match[2] ?? "");
  } catch {
    return null;
  }

  if (!id) {
    return null;
  }

  switch (match[1]) {
    case "notes":
      return noteHref(id);
    case "library":
      return folderHref(id);
    case "files":
      return fileHref(id);
    case "extensions":
      return extensionHref(id);
    default:
      return null;
  }
}
