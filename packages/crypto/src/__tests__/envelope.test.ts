import { describe, expect, it } from "vitest";

import {
  base64UrlDecode,
  base64UrlEncode,
  decryptAesGcm,
  encryptAesGcm,
  importAesGcmKey,
  openBytes,
  openText,
  sealBytes,
  sealText,
} from "../index";
import type { WorkspaceCryptoContext } from "../index";

function hex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function context(overrides: Partial<Parameters<typeof sealText>[0]["context"]> = {}) {
  return {
    workspaceId: "workspace-1",
    purpose: "note-content",
    entityType: "note",
    entityId: "note-1",
    entityVersion: 1,
    ...overrides,
  };
}

async function cryptoContext(
  bytes = new Uint8Array(32).fill(0x42)
): Promise<WorkspaceCryptoContext> {
  return {
    workspaceId: "workspace-1",
    keyId: "workspace-key-1",
    dek: await importAesGcmKey(bytes),
  };
}

function tamperBase64Url(value: string): string {
  const first = value[0];
  return `${first === "A" ? "B" : "A"}${value.slice(1)}`;
}

function decodeBody(envelope: string): Record<string, unknown> {
  return JSON.parse(
    new TextDecoder().decode(base64UrlDecode(envelope.slice("enc1:".length)))
  ) as Record<string, unknown>;
}

function encodeBody(body: Record<string, unknown>): string {
  return `enc1:${base64UrlEncode(utf8(JSON.stringify(body)))}`;
}

describe("AES-256-GCM", () => {
  it("matches the NIST zero-key, zero-IV, empty-plaintext vector", async () => {
    const key = await importAesGcmKey(new Uint8Array(32));
    const sealed = await encryptAesGcm(
      key,
      new Uint8Array(12),
      new Uint8Array(),
      new Uint8Array()
    );

    expect(sealed.ciphertext).toEqual(new Uint8Array());
    expect(hex(sealed.tag)).toBe("530f8afbc74536b9a963b4f1c4cb738b");
    await expect(
      decryptAesGcm(key, new Uint8Array(12), new Uint8Array(), sealed)
    ).resolves.toEqual(new Uint8Array());
  });
});

describe("text envelopes", () => {
  it("round-trips UTF-8 with the enc1 prefix", async () => {
    const crypto = await cryptoContext();

    const envelope = await sealText({
      context: context(),
      dek: crypto.dek,
      keyId: crypto.keyId,
      plaintext: "Halo, Rya 🌱",
    });

    expect(envelope).toMatch(/^enc1:/);
    await expect(
      openText({
        context: context(),
        dek: crypto.dek,
        keyId: crypto.keyId,
        envelope,
      })
    ).resolves.toBe("Halo, Rya 🌱");
  });

  it("fails with a different key", async () => {
    const crypto = await cryptoContext();
    const other = await cryptoContext(new Uint8Array(32).fill(0x24));
    const envelope = await sealText({
      context: context(),
      dek: crypto.dek,
      keyId: crypto.keyId,
      plaintext: "rahasia",
    });

    await expect(
      openText({
        context: context(),
        dek: other.dek,
        keyId: crypto.keyId,
        envelope,
      })
    ).rejects.toMatchObject({ code: "authentication_failed" });
  });

  it("fails when the AAD workspace, entity, purpose, or version changes", async () => {
    const crypto = await cryptoContext();
    const envelope = await sealText({
      context: context(),
      dek: crypto.dek,
      keyId: crypto.keyId,
      plaintext: "rahasia",
    });

    for (const swapped of [
      context({ workspaceId: "workspace-2" }),
      context({ entityId: "note-2" }),
      context({ purpose: "draft" }),
      context({ entityVersion: 2 }),
    ]) {
      await expect(
        openText({
          context: swapped,
          dek: crypto.dek,
          keyId: crypto.keyId,
          envelope,
        })
      ).rejects.toMatchObject({ code: "authentication_failed" });
    }
  });

  it("rejects a different key ID before attempting decryption", async () => {
    const crypto = await cryptoContext();
    const envelope = await sealText({
      context: context(),
      dek: crypto.dek,
      keyId: crypto.keyId,
      plaintext: "rahasia",
    });

    await expect(
      openText({
        context: context(),
        dek: crypto.dek,
        keyId: "workspace-key-2",
        envelope,
      })
    ).rejects.toMatchObject({ code: "unknown_key_id" });
  });

  it("rejects malformed, truncated, and unsupported envelopes", async () => {
    const crypto = await cryptoContext();
    const envelope = await sealText({
      context: context(),
      dek: crypto.dek,
      keyId: crypto.keyId,
      plaintext: "rahasia",
    });
    const parsed = decodeBody(envelope);

    for (const malformed of [
      "not-an-envelope",
      "enc1:%%%%",
      envelope.slice(0, -8),
      encodeBody({ ...parsed, version: 2 }),
      encodeBody({ ...parsed, alg: "AES-128-GCM" }),
      encodeBody({ ...parsed, tag: "AAAA" }),
      encodeBody({ ...parsed, iv: "AAAA" }),
    ]) {
      await expect(
        openText({
          context: context(),
          dek: crypto.dek,
          keyId: crypto.keyId,
          envelope: malformed,
        })
      ).rejects.toMatchObject({ code: "invalid_envelope" });
    }
  });

  it("rejects duplicate JSON fields at any depth", async () => {
    const crypto = await cryptoContext();
    const envelope = await sealText({
      context: context(),
      dek: crypto.dek,
      keyId: crypto.keyId,
      plaintext: "rahasia",
    });
    const raw = new TextDecoder().decode(base64UrlDecode(envelope.slice("enc1:".length)));
    const parsed = JSON.parse(raw) as { wrappedKey: { tag: string } };
    const duplicateTop = raw.replace('{"', '{"alg":"AES-256-GCM","');
    const duplicateNested = raw.replace(
      '"wrappedKey":{',
      `"wrappedKey":{"tag":${JSON.stringify(parsed.wrappedKey.tag)},`
    );
    const duplicateEscaped = raw.replace('"kid":', '"kid":"other-key","\\u006bid":');

    for (const malformed of [duplicateTop, duplicateNested, duplicateEscaped]) {
      await expect(
        openText({
          context: context(),
          dek: crypto.dek,
          keyId: crypto.keyId,
          envelope: `enc1:${base64UrlEncode(utf8(malformed))}`,
        })
      ).rejects.toMatchObject({ code: "invalid_envelope" });
    }
  });

  it("authenticates empty plaintext as empty ciphertext", async () => {
    const crypto = await cryptoContext();
    const envelope = await sealText({
      context: context(),
      dek: crypto.dek,
      keyId: crypto.keyId,
      plaintext: "",
    });
    const parsed = decodeBody(envelope);

    expect(parsed.ciphertext).toBe("");
    await expect(
      openText({
        context: context(),
        dek: crypto.dek,
        keyId: crypto.keyId,
        envelope,
      })
    ).resolves.toBe("");
    await expect(
      openText({
        context: context(),
        dek: crypto.dek,
        keyId: crypto.keyId,
        envelope: encodeBody({
          ...parsed,
          tag: tamperBase64Url(String(parsed.tag)),
        }),
      })
    ).rejects.toMatchObject({ code: "authentication_failed" });
  });

  it("authenticates the ciphertext tag", async () => {
    const crypto = await cryptoContext();
    const envelope = await sealText({
      context: context(),
      dek: crypto.dek,
      keyId: crypto.keyId,
      plaintext: "rahasia",
    });
    const parsed = decodeBody(envelope);
    const tampered = encodeBody({
      ...parsed,
      ciphertext: tamperBase64Url(String(parsed.ciphertext)),
    });

    await expect(
      openText({
        context: context(),
        dek: crypto.dek,
        keyId: crypto.keyId,
        envelope: tampered,
      })
    ).rejects.toMatchObject({ code: "authentication_failed" });
  });

  it("uses a fresh payload nonce, wrapped-key nonce, and CEK per seal", async () => {
    const crypto = await cryptoContext();
    const first = await sealText({
      context: context(),
      dek: crypto.dek,
      keyId: crypto.keyId,
      plaintext: "sama",
    });
    const second = await sealText({
      context: context(),
      dek: crypto.dek,
      keyId: crypto.keyId,
      plaintext: "sama",
    });
    const firstBody = decodeBody(first) as {
      iv: string;
      wrappedKey: { iv: string; ciphertext: string };
    };
    const secondBody = decodeBody(second) as {
      iv: string;
      wrappedKey: { iv: string; ciphertext: string };
    };

    expect(firstBody.iv).not.toBe(secondBody.iv);
    expect(firstBody.wrappedKey.iv).not.toBe(secondBody.wrappedKey.iv);
    expect(firstBody.wrappedKey.ciphertext).not.toBe(secondBody.wrappedKey.ciphertext);
  });
});

describe("binary envelopes", () => {
  it("round-trips bytes with the ONB1 magic", async () => {
    const crypto = await cryptoContext();
    const plaintext = new Uint8Array([0, 1, 2, 3, 255]);

    const envelope = await sealBytes({
      context: context({ purpose: "file-bytes", entityType: "file", entityId: "file-1" }),
      dek: crypto.dek,
      keyId: crypto.keyId,
      plaintext,
    });

    expect(Array.from(envelope.slice(0, 4))).toEqual([0x4f, 0x4e, 0x42, 0x31]);
    await expect(
      openBytes({
        context: context({
          purpose: "file-bytes",
          entityType: "file",
          entityId: "file-1",
        }),
        dek: crypto.dek,
        keyId: crypto.keyId,
        envelope,
      })
    ).resolves.toEqual(plaintext);
  });

  it("rejects a wrong key, swapped AAD, and truncated bytes", async () => {
    const crypto = await cryptoContext();
    const other = await cryptoContext(new Uint8Array(32).fill(0x24));
    const fileContext = context({
      purpose: "file-bytes",
      entityType: "file",
      entityId: "file-1",
    });
    const envelope = await sealBytes({
      context: fileContext,
      dek: crypto.dek,
      keyId: crypto.keyId,
      plaintext: utf8("file body"),
    });

    await expect(
      openBytes({
        context: fileContext,
        dek: other.dek,
        keyId: crypto.keyId,
        envelope,
      })
    ).rejects.toMatchObject({ code: "authentication_failed" });
    await expect(
      openBytes({
        context: { ...fileContext, entityId: "file-2" },
        dek: crypto.dek,
        keyId: crypto.keyId,
        envelope,
      })
    ).rejects.toMatchObject({ code: "authentication_failed" });
    await expect(
      openBytes({
        context: fileContext,
        dek: crypto.dek,
        keyId: crypto.keyId,
        envelope: envelope.slice(0, 20),
      })
    ).rejects.toMatchObject({ code: "invalid_envelope" });
    await expect(
      openBytes({
        context: fileContext,
        dek: crypto.dek,
        keyId: crypto.keyId,
        envelope: envelope.slice(0, -1),
      })
    ).rejects.toMatchObject({ code: "authentication_failed" });
  });
});
