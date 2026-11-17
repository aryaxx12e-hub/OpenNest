import { bytesToHex } from "./bytes";
import { CryptoError } from "./errors";

export function getWebCrypto(): Crypto {
  const provider = globalThis.crypto;

  if (
    provider === undefined ||
    typeof provider.getRandomValues !== "function" ||
    provider.subtle === undefined
  ) {
    throw new CryptoError("crypto_unavailable", "WebCrypto is unavailable");
  }

  return provider;
}

export function randomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length <= 0) {
    throw new CryptoError("no_secure_random", "Invalid random length");
  }

  const result = new Uint8Array(length);

  try {
    getWebCrypto().getRandomValues(result);
  } catch (error) {
    throw new CryptoError("no_secure_random", "Secure randomness is unavailable", {
      cause: error,
    });
  }

  return result;
}

export function randomId(prefix: string): string {
  return `${prefix}_${bytesToHex(randomBytes(16))}`;
}
