import { describe, expect, it } from "vitest";

import {
  BACKUP_KEK_DOMAIN,
  MIN_PBKDF2_ITERATIONS,
  WORKSPACE_KEK_DOMAIN,
  base64UrlEncode,
  decryptAesGcm,
  deriveBackupKek,
  deriveKekBytes,
  deriveWorkspaceKek,
  encryptAesGcm,
} from "../index";

const SALT = new Uint8Array(16).fill(9);
const IV = new Uint8Array(12).fill(3);
const AAD = new TextEncoder().encode("domain-test");

function params(domain: string) {
  return {
    name: "PBKDF2-SHA-256" as const,
    hash: "SHA-256" as const,
    iterations: MIN_PBKDF2_ITERATIONS,
    salt: base64UrlEncode(SALT),
    domain,
  };
}

function hex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("key domains", () => {
  it("derives different bytes for workspace and backup with the same passphrase and salt", async () => {
    const workspace = await deriveKekBytes(
      "passphrase",
      SALT,
      MIN_PBKDF2_ITERATIONS,
      WORKSPACE_KEK_DOMAIN
    );
    const backup = await deriveKekBytes(
      "passphrase",
      SALT,
      MIN_PBKDF2_ITERATIONS,
      BACKUP_KEK_DOMAIN
    );

    expect(hex(workspace)).not.toBe(hex(backup));
  });

  it("does not allow workspace and backup keys to decrypt each other's data", async () => {
    const workspace = await deriveWorkspaceKek(
      "passphrase",
      params(WORKSPACE_KEK_DOMAIN)
    );
    const backup = await deriveBackupKek("passphrase", params(BACKUP_KEK_DOMAIN));
    const plaintext = new TextEncoder().encode("private");
    const sealed = await encryptAesGcm(workspace, IV, AAD, plaintext);

    await expect(decryptAesGcm(backup, IV, AAD, sealed)).rejects.toMatchObject({
      code: "authentication_failed",
    });
    await expect(decryptAesGcm(workspace, IV, AAD, sealed)).resolves.toEqual(plaintext);
  });

  it("rejects a workspace derivation carrying the backup domain and vice versa", async () => {
    await expect(
      deriveWorkspaceKek("passphrase", params(BACKUP_KEK_DOMAIN))
    ).rejects.toMatchObject({ code: "invalid_kdf_parameters" });
    await expect(
      deriveBackupKek("passphrase", params(WORKSPACE_KEK_DOMAIN))
    ).rejects.toMatchObject({ code: "invalid_kdf_parameters" });
  });
});
