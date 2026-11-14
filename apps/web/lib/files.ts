import { limits } from "@opennest/core";

const extensionTypes: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export const uploadAccept = [
  ...limits.allowedMimeTypes,
  ...Object.keys(extensionTypes).map((extension) => `.${extension}`),
].join(",");

export function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");

  return index < 0 ? "" : name.slice(index + 1).toLowerCase();
}

export function uploadMimeType(file: File): string {
  const reported = file.type.toLowerCase();

  if ((limits.allowedMimeTypes as readonly string[]).includes(reported)) {
    return reported;
  }

  const inferred = extensionTypes[extensionOf(file.name)];

  return inferred ?? "application/octet-stream";
}

export function isPreviewableMime(mimeType: string | null): boolean {
  return (
    mimeType === "image/png" ||
    mimeType === "image/jpeg" ||
    mimeType === "image/webp" ||
    mimeType === "application/pdf" ||
    mimeType === "text/plain" ||
    mimeType === "text/markdown"
  );
}
