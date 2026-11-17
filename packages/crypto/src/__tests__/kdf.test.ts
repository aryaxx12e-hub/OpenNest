import { describe, expect, it } from "vitest";

import {
  BACKUP_KEK_DOMAIN,
  MAX_PBKDF2_ITERATIONS,
  MIN_PBKDF2_ITERATIONS,
  WORKSPACE_KEK_DOMAIN,
  createKdfParameters,
  deriveKekBytes,
  hkdfBits,
  parseKdfParameters,
  pbkdf2Bits,
} from "../index";

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function hex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("KDF", () => {
  it("matches the PBKDF2-HMAC-SHA-256 known answer at the production floor", async () => {
    const result = await pbkdf2Bits("password", utf8("salt"), MIN_PBKDF2_ITERATIONS, 32);

    expect(hex(result)).toBe(
      "669cfe52482116fda1aa2cbe409b2f56c8e4563752b7a28f6eaab614ee005178"
    );
  });

  it("matches RFC 5869 HKDF-SHA-256 test case 1", async () => {
    const ikm = new Uint8Array(22).fill(0x0b);
    const salt = new Uint8Array([
      0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
    ]);
    const info = new Uint8Array([
      0xf0, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9,
    ]);

    const result = await hkdfBits(ikm, salt, info, 42);

    expect(hex(result)).toBe(
      "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf" +
        "34007208d5b887185865"
    );
  });

  it("refuses workspace and backup derivations below the iteration floor", async () => {
    const salt = new Uint8Array(16).fill(7);

    await expect(
      deriveKekBytes("password", salt, MIN_PBKDF2_ITERATIONS - 1, WORKSPACE_KEK_DOMAIN)
    ).rejects.toMatchObject({ code: "invalid_kdf_parameters" });
    await expect(
      deriveKekBytes("password", salt, MIN_PBKDF2_ITERATIONS - 1, BACKUP_KEK_DOMAIN)
    ).rejects.toMatchObject({ code: "invalid_kdf_parameters" });
  });

  it("refuses KDF parameters above the supported ceiling", async () => {
    const salt = new Uint8Array(16).fill(7);
    const parameters = {
      ...createKdfParameters(WORKSPACE_KEK_DOMAIN),
      iterations: MAX_PBKDF2_ITERATIONS + 1,
    };

    expect(() => parseKdfParameters(parameters)).toThrowError(/iterations/);
    await expect(
      deriveKekBytes("password", salt, MAX_PBKDF2_ITERATIONS + 1, WORKSPACE_KEK_DOMAIN)
    ).rejects.toMatchObject({ code: "invalid_kdf_parameters" });
    await expect(
      pbkdf2Bits("password", salt, MAX_PBKDF2_ITERATIONS + 1, 32)
    ).rejects.toMatchObject({ code: "invalid_kdf_parameters" });
  });

  it("rejects unknown KDF domains", async () => {
    const salt = new Uint8Array(16).fill(7);

    await expect(
      deriveKekBytes("password", salt, MIN_PBKDF2_ITERATIONS, "opennest:unknown:v1")
    ).rejects.toMatchObject({ code: "invalid_kdf_parameters" });
  });
});
