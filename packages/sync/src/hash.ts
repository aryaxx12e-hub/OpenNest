import type { SyncHashEnvelope } from "./store";

function canonicalize(value: unknown): unknown {
  if (value === undefined) {
    throw new TypeError("canonicalJson cannot encode undefined");
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item === undefined) {
        throw new TypeError("canonicalJson cannot encode undefined");
      }
      return canonicalize(item);
    });
  }
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const target: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const item = source[key];
      if (item === undefined) {
        throw new TypeError("canonicalJson cannot encode undefined");
      }
      target[key] = canonicalize(item);
    }
    return target;
  }
  throw new TypeError(`canonicalJson cannot encode ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export async function payloadHash(envelope: SyncHashEnvelope): Promise<string> {
  const data = new TextEncoder().encode(canonicalJson(envelope));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
