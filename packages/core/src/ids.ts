import { NoRandomSourceError } from "./errors";

export type WorkspaceId = string & { readonly __brand: "WorkspaceId" };
export type FolderId = string & { readonly __brand: "FolderId" };
export type FileId = string & { readonly __brand: "FileId" };
export type NoteId = string & { readonly __brand: "NoteId" };
export type TagId = string & { readonly __brand: "TagId" };
export type IsoDate = string & { readonly __brand: "IsoDate" };
export type BlobKey = string & { readonly __brand: "BlobKey" };

export interface RandomSource {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView>(array: T) => T;
}

const HEX: readonly string[] = Array.from({ length: 256 }, (_, index) =>
  index.toString(16).padStart(2, "0")
);

function formatUuidV4(bytes: Uint8Array): string {
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => HEX[byte] ?? "00").join("");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export function createIdGenerator(source: RandomSource): () => string {
  const randomUUID = source.randomUUID;

  if (typeof randomUUID === "function") {
    return () => randomUUID.call(source);
  }

  const getRandomValues = source.getRandomValues;

  if (typeof getRandomValues !== "function") {
    throw new NoRandomSourceError("No cryptographic random source is available.");
  }

  return () =>
    formatUuidV4(getRandomValues.call(source, new Uint8Array(16)) as Uint8Array);
}

const globalCrypto = globalThis.crypto as RandomSource | undefined;

export const generateId: () => string =
  globalCrypto === undefined
    ? () => {
        throw new NoRandomSourceError("No cryptographic random source is available.");
      }
    : createIdGenerator(globalCrypto);
