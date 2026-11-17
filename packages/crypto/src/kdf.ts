import { importAesGcmKey } from "./aes";
import { base64UrlDecode, base64UrlEncode } from "./base64url";
import { copyBytes, utf8 } from "./bytes";
import { CryptoError } from "./errors";
import { getWebCrypto, randomBytes } from "./random";

export const WORKSPACE_KEK_DOMAIN = "opennest:workspace-kek:v1";
export const BACKUP_KEK_DOMAIN = "opennest:backup-kek:v1";
export const MIN_PBKDF2_ITERATIONS = 600_000;
export const KDF_SALT_BYTES = 16;
export const KEK_BYTES = 32;

const ALLOWED_DOMAINS = new Set([WORKSPACE_KEK_DOMAIN, BACKUP_KEK_DOMAIN]);

export interface KdfParameters {
  name: "PBKDF2-SHA-256";
  hash: "SHA-256";
  iterations: number;
  salt: string;
  domain: string;
}

export function createKdfParameters(domain: string): KdfParameters {
  assertAllowedDomain(domain);

  return {
    name: "PBKDF2-SHA-256",
    hash: "SHA-256",
    iterations: MIN_PBKDF2_ITERATIONS,
    salt: base64UrlEncode(randomBytes(KDF_SALT_BYTES)),
    domain,
  };
}

export function parseKdfParameters(value: unknown): KdfParameters {
  if (typeof value !== "object" || value === null) {
    throw new CryptoError("invalid_kdf_parameters", "KDF parameters must be an object");
  }

  const record = value as Record<string, unknown>;
  const { name, hash, iterations, salt, domain } = record;

  if (name !== "PBKDF2-SHA-256" || hash !== "SHA-256") {
    throw new CryptoError("invalid_kdf_parameters", "Unsupported KDF algorithm");
  }

  if (
    typeof iterations !== "number" ||
    !Number.isInteger(iterations) ||
    iterations < MIN_PBKDF2_ITERATIONS
  ) {
    throw new CryptoError(
      "invalid_kdf_parameters",
      `PBKDF2 must use at least ${MIN_PBKDF2_ITERATIONS} iterations`
    );
  }

  if (typeof salt !== "string" || salt.length === 0) {
    throw new CryptoError("invalid_kdf_parameters", "KDF salt is missing");
  }

  let saltBytes: Uint8Array;

  try {
    saltBytes = base64UrlDecode(salt);
  } catch (error) {
    throw new CryptoError("invalid_kdf_parameters", "KDF salt is not valid base64url", {
      cause: error,
    });
  }

  if (saltBytes.length !== KDF_SALT_BYTES) {
    throw new CryptoError("invalid_kdf_parameters", "KDF salt must be 16 bytes");
  }

  if (typeof domain !== "string") {
    throw new CryptoError("invalid_kdf_parameters", "KDF domain is missing");
  }

  assertAllowedDomain(domain);

  return {
    name: "PBKDF2-SHA-256",
    hash: "SHA-256",
    iterations,
    salt,
    domain,
  };
}

export async function pbkdf2Bits(
  passphrase: string | Uint8Array,
  salt: Uint8Array,
  iterations: number,
  length = KEK_BYTES
): Promise<Uint8Array> {
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new CryptoError("invalid_kdf_parameters", "PBKDF2 iterations must be positive");
  }

  if (salt.length === 0) {
    throw new CryptoError("invalid_kdf_parameters", "PBKDF2 salt is empty");
  }

  assertLength(length);

  const password =
    typeof passphrase === "string" ? utf8(passphrase) : copyBytes(passphrase);

  try {
    const key = await getWebCrypto().subtle.importKey("raw", password, "PBKDF2", false, [
      "deriveBits",
    ]);
    const bits = await getWebCrypto().subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: copyBytes(salt),
        iterations,
      },
      key,
      length * 8
    );

    return new Uint8Array(bits);
  } catch (error) {
    throw new CryptoError("invalid_kdf_parameters", "PBKDF2 derivation failed", {
      cause: error,
    });
  }
}

export async function hkdfBits(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length = KEK_BYTES
): Promise<Uint8Array> {
  if (ikm.length === 0) {
    throw new CryptoError("invalid_kdf_parameters", "HKDF input key material is empty");
  }

  assertLength(length);

  try {
    const key = await getWebCrypto().subtle.importKey(
      "raw",
      copyBytes(ikm),
      "HKDF",
      false,
      ["deriveBits"]
    );
    const bits = await getWebCrypto().subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: copyBytes(salt),
        info: copyBytes(info),
      },
      key,
      length * 8
    );

    return new Uint8Array(bits);
  } catch (error) {
    throw new CryptoError("invalid_kdf_parameters", "HKDF derivation failed", {
      cause: error,
    });
  }
}

export async function deriveKekBytes(
  passphrase: string | Uint8Array,
  salt: Uint8Array,
  iterations: number,
  domain: string
): Promise<Uint8Array> {
  assertAllowedDomain(domain);

  if (iterations < MIN_PBKDF2_ITERATIONS) {
    throw new CryptoError(
      "invalid_kdf_parameters",
      `PBKDF2 must use at least ${MIN_PBKDF2_ITERATIONS} iterations`
    );
  }

  if (salt.length !== KDF_SALT_BYTES) {
    throw new CryptoError("invalid_kdf_parameters", "KDF salt must be 16 bytes");
  }

  if (typeof passphrase === "string" && passphrase.length === 0) {
    throw new CryptoError("invalid_passphrase", "Passphrase is empty");
  }

  const password = typeof passphrase === "string" ? passphrase : copyBytes(passphrase);

  if (typeof password !== "string" && password.length === 0) {
    throw new CryptoError("invalid_passphrase", "Passphrase is empty");
  }

  const derived = await pbkdf2Bits(password, salt, iterations, KEK_BYTES);

  return hkdfBits(derived, new Uint8Array(), utf8(domain), KEK_BYTES);
}

export async function deriveWorkspaceKek(
  passphrase: string,
  parameters: KdfParameters
): Promise<CryptoKey> {
  return deriveKekKey(passphrase, parameters, WORKSPACE_KEK_DOMAIN);
}

export async function deriveBackupKek(
  passphrase: string,
  parameters: KdfParameters
): Promise<CryptoKey> {
  return deriveKekKey(passphrase, parameters, BACKUP_KEK_DOMAIN);
}

async function deriveKekKey(
  passphrase: string,
  parameters: KdfParameters,
  expectedDomain: string
): Promise<CryptoKey> {
  const parsed = parseKdfParameters(parameters);

  if (parsed.domain !== expectedDomain) {
    throw new CryptoError("invalid_kdf_parameters", "KDF domain does not match");
  }

  const salt = base64UrlDecode(parsed.salt);
  const bytes = await deriveKekBytes(passphrase, salt, parsed.iterations, parsed.domain);

  return importAesGcmKey(bytes);
}

function assertAllowedDomain(domain: string): void {
  if (!ALLOWED_DOMAINS.has(domain)) {
    throw new CryptoError("invalid_kdf_parameters", "Unknown KDF domain");
  }
}

function assertLength(length: number): void {
  if (!Number.isInteger(length) || length < 1 || length > 64) {
    throw new CryptoError("invalid_kdf_parameters", "KDF output length is invalid");
  }
}
