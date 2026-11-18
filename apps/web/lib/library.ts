export type LibraryFileType = "all" | "documents" | "images";

const mimeTypesByType: Readonly<
  Record<Exclude<LibraryFileType, "all">, readonly string[]>
> = Object.freeze({
  documents: Object.freeze([
    "application/pdf",
    "text/plain",
    "text/markdown",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]),
  images: Object.freeze(["image/png", "image/jpeg", "image/webp"]),
});

export function libraryTypeMimeTypes(
  type: LibraryFileType
): readonly string[] | undefined {
  return type === "all" ? undefined : mimeTypesByType[type];
}
