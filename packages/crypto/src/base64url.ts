import { CryptoError } from "./errors";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const LOOKUP = new Map<string, number>(
  Array.from(ALPHABET, (character, index) => [character, index])
);

export function base64UrlEncode(value: Uint8Array): string {
  let output = "";

  for (let index = 0; index < value.length; index += 3) {
    const first = value[index] ?? 0;
    const second = value[index + 1];
    const third = value[index + 2];

    output += ALPHABET[first >> 2] ?? "";
    output += ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)] ?? "";

    if (second === undefined) {
      break;
    }

    output += ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)] ?? "";

    if (third === undefined) {
      break;
    }

    output += ALPHABET[third & 0x3f] ?? "";
  }

  return output;
}

export function base64UrlDecode(value: string): Uint8Array {
  if (value.length % 4 === 1) {
    throw new CryptoError("invalid_base64url", "Invalid base64url length");
  }

  const result: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const character of value) {
    const decoded = LOOKUP.get(character);

    if (decoded === undefined) {
      throw new CryptoError("invalid_base64url", "Invalid base64url character");
    }

    buffer = (buffer << 6) | decoded;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      result.push((buffer >> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }

  if (bits > 0 && buffer !== 0) {
    throw new CryptoError("invalid_base64url", "Invalid base64url padding bits");
  }

  return Uint8Array.from(result);
}
