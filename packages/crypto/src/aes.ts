import { base64UrlDecode, base64UrlEncode } from "./base64url";
import { copyBytes } from "./bytes";
import { CryptoError } from "./errors";
import { getWebCrypto, randomBytes } from "./random";

export const AES_GCM_ALGORITHM = "AES-256-GCM";
export const AES_KEY_BYTES = 32;
export const GCM_NONCE_BYTES = 12;
export const GCM_TAG_BYTES = 16;

export interface WrappedKey {
  iv: string;
  ciphertext: string;
  tag: string;
}

export interface SealedBytes {
  ciphertext: Uint8Array;
  tag: Uint8Array;
}

export async function importAesGcmKey(
  keyBytes: Uint8Array,
  usages: KeyUsage[] = ["encrypt", "decrypt"]
): Promise<CryptoKey> {
  if (keyBytes.length !== AES_KEY_BYTES) {
    throw new CryptoError("invalid_wrapped_key", "AES-256-GCM keys must be 32 bytes");
  }

  try {
    return await getWebCrypto().subtle.importKey(
      "raw",
      copyBytes(keyBytes),
      { name: "AES-GCM" },
      false,
      usages
    );
  } catch (error) {
    throw new CryptoError("invalid_wrapped_key", "Could not import AES key", {
      cause: error,
    });
  }
}

export async function encryptAesGcm(
  key: CryptoKey,
  iv: Uint8Array,
  aad: Uint8Array,
  plaintext: Uint8Array
): Promise<SealedBytes> {
  if (iv.length !== GCM_NONCE_BYTES) {
    throw new CryptoError("invalid_envelope", "AES-GCM nonces must be 12 bytes");
  }

  try {
    const encrypted = await getWebCrypto().subtle.encrypt(
      {
        name: "AES-GCM",
        iv: copyBytes(iv),
        additionalData: copyBytes(aad),
        tagLength: 128,
      },
      key,
      copyBytes(plaintext)
    );
    const bytes = new Uint8Array(encrypted);
    const tagOffset = bytes.length - GCM_TAG_BYTES;

    if (tagOffset < 0) {
      throw new CryptoError("invalid_envelope", "AES-GCM output is too short");
    }

    return {
      ciphertext: bytes.slice(0, tagOffset),
      tag: bytes.slice(tagOffset),
    };
  } catch (error) {
    if (error instanceof CryptoError) {
      throw error;
    }

    throw new CryptoError("authentication_failed", "AES-GCM encryption failed", {
      cause: error,
    });
  }
}

export async function decryptAesGcm(
  key: CryptoKey,
  iv: Uint8Array,
  aad: Uint8Array,
  sealed: SealedBytes
): Promise<Uint8Array> {
  if (iv.length !== GCM_NONCE_BYTES || sealed.tag.length !== GCM_TAG_BYTES) {
    throw new CryptoError("invalid_envelope", "Invalid AES-GCM nonce or tag length");
  }

  const combined = new Uint8Array(sealed.ciphertext.length + sealed.tag.length);
  combined.set(sealed.ciphertext, 0);
  combined.set(sealed.tag, sealed.ciphertext.length);

  try {
    const plaintext = await getWebCrypto().subtle.decrypt(
      {
        name: "AES-GCM",
        iv: copyBytes(iv),
        additionalData: copyBytes(aad),
        tagLength: 128,
      },
      key,
      combined
    );

    return new Uint8Array(plaintext);
  } catch (error) {
    throw new CryptoError("authentication_failed", "AES-GCM authentication failed", {
      cause: error,
    });
  }
}

export async function wrapKeyBytes(
  wrappingKey: CryptoKey,
  keyBytes: Uint8Array,
  aad: Uint8Array
): Promise<WrappedKey> {
  if (keyBytes.length !== AES_KEY_BYTES) {
    throw new CryptoError("invalid_wrapped_key", "Wrapped keys must be 32 bytes");
  }

  const iv = randomBytes(GCM_NONCE_BYTES);
  const sealed = await encryptAesGcm(wrappingKey, iv, aad, keyBytes);

  return {
    iv: base64UrlEncode(iv),
    ciphertext: base64UrlEncode(sealed.ciphertext),
    tag: base64UrlEncode(sealed.tag),
  };
}

export async function unwrapKeyBytes(
  wrappingKey: CryptoKey,
  wrapped: WrappedKey,
  aad: Uint8Array
): Promise<Uint8Array> {
  const parsed = parseWrappedKey(wrapped, AES_KEY_BYTES);
  const keyBytes = await decryptAesGcm(wrappingKey, parsed.iv, aad, {
    ciphertext: parsed.ciphertext,
    tag: parsed.tag,
  });

  if (keyBytes.length !== AES_KEY_BYTES) {
    throw new CryptoError("invalid_wrapped_key", "Wrapped key has the wrong length");
  }

  return keyBytes;
}

export interface ParsedWrappedKey {
  iv: Uint8Array;
  ciphertext: Uint8Array;
  tag: Uint8Array;
}

export function parseWrappedKey(
  value: unknown,
  expectedCiphertextLength?: number
): ParsedWrappedKey {
  if (typeof value !== "object" || value === null) {
    throw new CryptoError("invalid_wrapped_key", "Wrapped key must be an object");
  }

  const record = value as Record<string, unknown>;
  const iv = decodeField(record.iv, "wrapped key nonce");
  const ciphertext = decodeField(record.ciphertext, "wrapped key ciphertext");
  const tag = decodeField(record.tag, "wrapped key tag");

  if (iv.length !== GCM_NONCE_BYTES || tag.length !== GCM_TAG_BYTES) {
    throw new CryptoError(
      "invalid_wrapped_key",
      "Wrapped key nonce or tag has the wrong length"
    );
  }

  if (ciphertext.length === 0) {
    throw new CryptoError("invalid_wrapped_key", "Wrapped key ciphertext is empty");
  }

  if (
    expectedCiphertextLength !== undefined &&
    ciphertext.length !== expectedCiphertextLength
  ) {
    throw new CryptoError(
      "invalid_wrapped_key",
      "Wrapped key ciphertext has the wrong length"
    );
  }

  return { iv, ciphertext, tag };
}

export function isWrappedKey(value: unknown): value is WrappedKey {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).iv === "string" &&
    typeof (value as Record<string, unknown>).ciphertext === "string" &&
    typeof (value as Record<string, unknown>).tag === "string"
  );
}

function decodeField(value: unknown, label: string): Uint8Array {
  if (typeof value !== "string") {
    throw new CryptoError("invalid_wrapped_key", `${label} must be a string`);
  }

  try {
    return base64UrlDecode(value);
  } catch (error) {
    throw new CryptoError("invalid_wrapped_key", `${label} is not valid base64url`, {
      cause: error,
    });
  }
}
