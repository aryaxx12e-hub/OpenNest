import { CryptoError } from "./errors";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CROCKFORD_LOOKUP = new Map<string, number>(
  Array.from(CROCKFORD, (character, index) => [character, index])
);
const RECOVERY_PREFIX = "ONRK1";
const BACKUP_PREFIX = "ONBK1";
const KEY_BYTES = 32;
const CHECKSUM_BYTES = 4;

export function encodeRecoveryKey(keyBytes: Uint8Array): string {
  return encodeKey(keyBytes, RECOVERY_PREFIX);
}

export function decodeRecoveryKey(value: string): Uint8Array {
  return decodeKey(value, RECOVERY_PREFIX);
}

export function encodeBackupKey(keyBytes: Uint8Array): string {
  return encodeKey(keyBytes, BACKUP_PREFIX);
}

export function decodeBackupKey(value: string): Uint8Array {
  return decodeKey(value, BACKUP_PREFIX);
}

function encodeKey(keyBytes: Uint8Array, prefix: string): string {
  if (keyBytes.length !== KEY_BYTES) {
    throw new CryptoError("invalid_recovery_key", "Recovery keys must be 32 bytes");
  }

  const checksum = crc32(keyBytes);
  const payload = new Uint8Array(KEY_BYTES + CHECKSUM_BYTES);
  payload.set(keyBytes, 0);
  payload[KEY_BYTES] = (checksum >>> 24) & 0xff;
  payload[KEY_BYTES + 1] = (checksum >>> 16) & 0xff;
  payload[KEY_BYTES + 2] = (checksum >>> 8) & 0xff;
  payload[KEY_BYTES + 3] = checksum & 0xff;

  return `${prefix}-${group(base32Encode(payload), 5)}`;
}

function decodeKey(value: string, prefix: string): Uint8Array {
  if (typeof value !== "string") {
    throw new CryptoError("invalid_recovery_key", "Recovery key must be a string");
  }

  const normalized = value.trim().toUpperCase().replace(/[\s-]/g, "");

  if (!normalized.startsWith(prefix) || normalized.length === prefix.length) {
    throw new CryptoError("invalid_recovery_key", "Recovery key has the wrong prefix");
  }

  const encoded = normalized.slice(prefix.length);
  const payload = base32Decode(encoded);

  if (payload.length !== KEY_BYTES + CHECKSUM_BYTES) {
    throw new CryptoError("invalid_recovery_key", "Recovery key has the wrong length");
  }

  const expected =
    ((payload[KEY_BYTES] ?? 0) << 24) |
    ((payload[KEY_BYTES + 1] ?? 0) << 16) |
    ((payload[KEY_BYTES + 2] ?? 0) << 8) |
    (payload[KEY_BYTES + 3] ?? 0);
  const keyBytes = payload.slice(0, KEY_BYTES);

  if (crc32(keyBytes) >>> 0 !== expected >>> 0) {
    throw new CryptoError("invalid_recovery_key", "Recovery key checksum does not match");
  }

  return keyBytes;
}

function group(value: string, size: number): string {
  const groups: string[] = [];

  for (let index = 0; index < value.length; index += size) {
    groups.push(value.slice(index, index + size));
  }

  return groups.join("-");
}

function base32Encode(value: Uint8Array): string {
  let output = "";
  let buffer = 0;
  let bits = 0;

  for (const byte of value) {
    buffer = (buffer << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      bits -= 5;
      output += CROCKFORD[(buffer >>> bits) & 0x1f] ?? "";
    }

    buffer &= (1 << bits) - 1;
  }

  if (bits > 0) {
    output += CROCKFORD[(buffer << (5 - bits)) & 0x1f] ?? "";
  }

  return output;
}

function base32Decode(value: string): Uint8Array {
  const result: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const rawCharacter of value) {
    const character =
      rawCharacter === "O"
        ? "0"
        : rawCharacter === "I" || rawCharacter === "L"
          ? "1"
          : rawCharacter;
    const decoded = CROCKFORD_LOOKUP.get(character);

    if (decoded === undefined) {
      throw new CryptoError(
        "invalid_recovery_key",
        "Recovery key contains an invalid character"
      );
    }

    buffer = (buffer << 5) | decoded;
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      result.push((buffer >>> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }

  if (bits > 0 && buffer !== 0) {
    throw new CryptoError(
      "invalid_recovery_key",
      "Recovery key has invalid padding bits"
    );
  }

  return Uint8Array.from(result);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
})();

function crc32(value: Uint8Array): number {
  let crc = 0xffffffff;

  for (const byte of value) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}
