import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

import { AuthError } from "./errors";

export const PASSWORD_SALT_BYTES = 16;
export const PASSWORD_HASH_BYTES = 32;
export const SCRYPT_N = 32768;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;

const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const MAX_PASSWORD_LENGTH = 4096;

export interface PasswordDigest {
  salt: string;
  hash: string;
}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      PASSWORD_HASH_BYTES,
      {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: SCRYPT_MAXMEM,
      },
      (error, derived) => {
        if (error) {
          reject(new AuthError("validation", "The password could not be processed."));
          return;
        }

        resolve(derived);
      }
    );
  });
}

export async function hashPassword(password: string): Promise<PasswordDigest> {
  if (
    typeof password !== "string" ||
    password.length === 0 ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    throw new AuthError("validation", "The password is not valid.");
  }

  const salt = randomBytes(PASSWORD_SALT_BYTES);
  const hash = await deriveKey(password, salt);

  return {
    salt: salt.toString("hex"),
    hash: hash.toString("hex"),
  };
}

export async function verifyPassword(
  password: string,
  digest: PasswordDigest
): Promise<boolean> {
  if (
    typeof password !== "string" ||
    password.length === 0 ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    return false;
  }

  if (!/^[0-9a-f]+$/.test(digest.salt) || !/^[0-9a-f]+$/.test(digest.hash)) {
    return false;
  }

  const salt = Buffer.from(digest.salt, "hex");
  const expected = Buffer.from(digest.hash, "hex");

  if (salt.length !== PASSWORD_SALT_BYTES || expected.length !== PASSWORD_HASH_BYTES) {
    return false;
  }

  const actual = await deriveKey(password, salt);

  return timingSafeEqual(actual, expected);
}
