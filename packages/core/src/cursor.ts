import { ValidationError } from "./errors";

export type CursorTuple = [sortValue: string, id: string];

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function base64UrlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(encoded: string): string {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new TextDecoder().decode(bytes);
}

export function encodeCursor(tuple: readonly string[]): string {
  return base64UrlEncode(JSON.stringify(tuple));
}

export function decodeCursor(cursor: string): CursorTuple {
  if (cursor.length === 0 || !BASE64URL.test(cursor)) {
    throw new ValidationError("Cursor is malformed.");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(base64UrlDecode(cursor));
  } catch (error) {
    throw new ValidationError("Cursor is malformed.", { cause: error });
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== "string" ||
    typeof parsed[1] !== "string"
  ) {
    throw new ValidationError("Cursor is malformed.");
  }

  return [parsed[0], parsed[1]];
}
