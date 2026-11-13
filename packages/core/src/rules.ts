import { ConstraintError, UnsafeKeyError, ValidationError } from "./errors";
import { limits } from "./limits";

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/;
const CHECKSUM_HEX = /^[0-9a-f]{64}$/;
const COMBINING_MARKS = /[\u0300-\u036f]/g;
const WHITESPACE = /\s+/g;

export interface NoteInput {
  title: string;
  content?: string;
}

export interface ValidatedNoteInput {
  title: string;
  content: string;
}

export interface UploadMeta {
  name: string;
  mimeType: string | null;
  sizeBytes: number;
}

export interface TagName {
  display: string;
  key: string;
}

export function normalizeName(input: string): string {
  const trimmed = input.trim();

  if (trimmed.length === 0) {
    throw new ValidationError("Name must not be empty.");
  }

  if (trimmed.length > limits.maxNameLength) {
    throw new ValidationError(
      `Name must be at most ${limits.maxNameLength} characters long.`
    );
  }

  return trimmed;
}

export function validateDisplayName(input: string): string {
  const name = normalizeName(input);

  if (name.includes("/") || name.includes("\\")) {
    throw new ValidationError("Name must not contain a path separator.");
  }

  if (CONTROL_CHARACTER.test(name)) {
    throw new ValidationError("Name must not contain control characters.");
  }

  if (name === "." || name === "..") {
    throw new ValidationError("Name must not be a reserved path segment.");
  }

  if (name.startsWith(".") || name.endsWith(".")) {
    throw new ValidationError("Name must not start or end with a dot.");
  }

  return name;
}

export function assertSafeBlobKey(key: string): void {
  if (key === ".." || key.includes("..") || key.includes("/") || key.includes("\\")) {
    throw new UnsafeKeyError("Blob key must not contain a path.");
  }

  if (!UUID_V4.test(key)) {
    throw new UnsafeKeyError("Blob key must be a lowercase UUID v4.");
  }
}

export function validateUpload(meta: UploadMeta): void {
  const { sizeBytes, mimeType } = meta;

  if (!Number.isFinite(sizeBytes) || !Number.isInteger(sizeBytes) || sizeBytes < 0) {
    throw new ValidationError(
      "File size must be a non-negative integer number of bytes."
    );
  }

  if (sizeBytes > limits.maxFileSizeBytes) {
    throw new ValidationError(
      `File size must be at most ${limits.maxFileSizeBytes} bytes.`
    );
  }

  if (mimeType !== null && !limits.allowedMimeTypes.includes(mimeType)) {
    throw new ValidationError(`Unsupported MIME type: ${mimeType}.`);
  }
}

export function validateChecksum(input: string | null): string | null {
  if (input === null) {
    return null;
  }

  const checksum = input.toLowerCase();

  if (!CHECKSUM_HEX.test(checksum)) {
    throw new ValidationError(
      `Checksum must be ${limits.checksumHexLength} lowercase hex characters.`
    );
  }

  return checksum;
}

export function normalizeTagName(input: string): TagName {
  const display = input.trim();

  if (display.length === 0) {
    throw new ValidationError("Tag name must not be empty.");
  }

  if (display.length > limits.maxTagNameLength) {
    throw new ValidationError(
      `Tag name must be at most ${limits.maxTagNameLength} characters long.`
    );
  }

  return { display, key: display.replace(WHITESPACE, " ").toLowerCase() };
}

export function validateTagColor(input: string | null): string | null {
  if (input === null) {
    return null;
  }

  const color = input.toLowerCase();

  if (!HEX_COLOR.test(color)) {
    throw new ValidationError("Tag colour must be a six-digit hex value.");
  }

  return color;
}

export function validateNoteInput(input: NoteInput): ValidatedNoteInput {
  const title = input.title.trim();
  const content = input.content ?? "";

  if (title.length === 0) {
    throw new ValidationError("Note title must not be empty.");
  }

  if (title.length > limits.maxNoteTitleLength) {
    throw new ValidationError(
      `Note title must be at most ${limits.maxNoteTitleLength} characters long.`
    );
  }

  if (content.length > limits.maxNoteContentLength) {
    throw new ValidationError(
      `Note content must be at most ${limits.maxNoteContentLength} characters long.`
    );
  }

  return { title, content };
}

export function assertNoSelfLink(noteId: string, targetId: string): void {
  if (noteId === targetId) {
    throw new ConstraintError("A note must not link to itself.", "self_link");
  }
}

export function normalizeForSearch(input: string): string {
  return input
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(WHITESPACE, " ")
    .trim();
}

export function searchTokens(input: string): string[] {
  return normalizeForSearch(input)
    .split(" ")
    .filter((token) => /[\p{L}\p{N}]/u.test(token));
}

export function toMatchQuery(input: string): string {
  return searchTokens(input)
    .map((token) => `"${token.replace(/"/g, '""')}"*`)
    .join(" ");
}
