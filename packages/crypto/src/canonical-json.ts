import { CryptoError } from "./errors";

export function canonicalJson(value: Record<string, unknown>): string {
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  const fields = keys.map((key) => {
    const field = value[key];

    if (typeof field === "number" && !Number.isFinite(field)) {
      throw new CryptoError("invalid_aad", "AAD numbers must be finite");
    }

    if (
      field !== null &&
      typeof field !== "string" &&
      typeof field !== "number" &&
      typeof field !== "boolean"
    ) {
      throw new CryptoError("invalid_aad", "AAD values must be primitive");
    }

    return `${JSON.stringify(key)}:${JSON.stringify(field)}`;
  });

  return `{${fields.join(",")}}`;
}
