// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  PASSWORD_HASH_BYTES,
  PASSWORD_SALT_BYTES,
  hashPassword,
  verifyPassword,
} from "../password";

describe("password hashing", () => {
  it("uses a 16-byte salt and a 32-byte hash", async () => {
    const digest = await hashPassword("correct horse battery staple");

    expect(Buffer.from(digest.salt, "hex")).toHaveLength(PASSWORD_SALT_BYTES);
    expect(Buffer.from(digest.hash, "hex")).toHaveLength(PASSWORD_HASH_BYTES);
    expect(digest.salt).toMatch(/^[0-9a-f]+$/);
    expect(digest.hash).toMatch(/^[0-9a-f]+$/);
  });

  it("generates a different salt for every hash", async () => {
    const first = await hashPassword("correct horse battery staple");
    const second = await hashPassword("correct horse battery staple");

    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
  });

  it("accepts the correct password and rejects a wrong one", async () => {
    const digest = await hashPassword("correct horse battery staple");

    await expect(verifyPassword("correct horse battery staple", digest)).resolves.toBe(
      true
    );
    await expect(verifyPassword("wrong horse battery staple", digest)).resolves.toBe(
      false
    );
  });

  it("rejects malformed digests without throwing", async () => {
    await expect(
      verifyPassword("correct horse battery staple", { salt: "zz", hash: "zz" })
    ).resolves.toBe(false);
    await expect(verifyPassword("", await hashPassword("secret"))).resolves.toBe(false);
  });

  it("never includes the password in an error string", async () => {
    const password = "do-not-log-this-password";
    let message = "";

    try {
      await hashPassword(`${password}${"x".repeat(5000)}`);
    } catch (error) {
      message = String(error);
    }

    expect(message).not.toBe("");
    expect(message).not.toContain(password);
    expect(message).not.toContain("x".repeat(20));
  });
});
