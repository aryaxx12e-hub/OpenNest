export interface Limits {
  readonly maxNameLength: number;
  readonly maxNoteTitleLength: number;
  readonly maxNoteContentLength: number;
  readonly maxTagNameLength: number;
  readonly maxFileSizeBytes: number;
  readonly allowedMimeTypes: readonly string[];
  readonly checksumHexLength: number;
  readonly maxFolderDepth: number;
  readonly maxPageSize: number;
  readonly maxSearchTextLength: number;
}

export const limits: Limits = Object.freeze({
  maxNameLength: 255,
  maxNoteTitleLength: 200,
  maxNoteContentLength: 1_000_000,
  maxTagNameLength: 50,
  maxFileSizeBytes: 25 * 1024 * 1024,
  allowedMimeTypes: Object.freeze([
    "application/pdf",
    "text/plain",
    "text/markdown",
    "image/png",
    "image/jpeg",
    "image/webp",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]),
  checksumHexLength: 64,
  maxFolderDepth: 1000,
  maxPageSize: 500,
  maxSearchTextLength: 1_000,
});
