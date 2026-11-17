import { describe, expect, it } from "vitest";

import { CryptoError } from "../errors";
import {
  BACKUP_CHUNK_SIZE,
  canonicalJsonBytes,
  createBackupKey,
  openBackup,
  sealBackup,
  type BackupEnvelopeV2,
  type BackupKeySource,
} from "../backup";
import { encodeRecoveryKey } from "../recovery-key";
import { randomBytes } from "../random";

const AT = "2026-11-16T00:00:00.000Z";
const COUNTS = { folders: 1, tags: 2, files: 3, notes: 4 };

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function text(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

function passphrase(value = "correct horse battery staple"): BackupKeySource {
  return { kind: "passphrase", passphrase: value };
}

function backupKey(): string {
  return createBackupKey();
}

function clone(envelope: BackupEnvelopeV2): BackupEnvelopeV2 {
  return JSON.parse(JSON.stringify(envelope)) as BackupEnvelopeV2;
}

async function sealed(
  payload = bytes("hello backup"),
  source: BackupKeySource = passphrase(),
  chunkSize = BACKUP_CHUNK_SIZE
) {
  return sealBackup({
    payload,
    exportedAt: AT,
    counts: COUNTS,
    keySource: source,
    chunkSize,
    kid: "backup-key-id",
  });
}

describe("sealBackup and openBackup", () => {
  it("round-trips a passphrase backup and writes only the expected header", async () => {
    const result = await sealed();
    const envelope = result.envelope;

    expect(envelope.format).toBe("opennest-backup");
    expect(envelope.formatVersion).toBe(2);
    expect(envelope.encryption.alg).toBe("AES-256-GCM");
    expect(envelope.encryption.kdf.iterations).toBeGreaterThanOrEqual(600_000);
    expect(envelope.encryption.kdf.domain).toBe("opennest:backup-kek:v1");
    expect(envelope.encryption.kid).toBe("backup-key-id");
    expect(envelope.chunkSize).toBe(BACKUP_CHUNK_SIZE);
    expect(envelope.chunkCount).toBe(1);
    expect(envelope.summary).toEqual({
      counts: { workspaces: 1, ...COUNTS },
      totalPlaintextBytes: 12,
    });

    const opened = await openBackup({ envelope, keySource: passphrase() });

    expect(text(opened.payload)).toBe("hello backup");
  });

  it("round-trips a generated backup key", async () => {
    const key = backupKey();
    const result = await sealed(bytes("backup key payload"), {
      kind: "backupKey",
      backupKey: key,
    });
    const opened = await openBackup({
      envelope: result.envelope,
      keySource: { kind: "backupKey", backupKey: key },
    });

    expect(text(opened.payload)).toBe("backup key payload");
    expect(key.startsWith("ONBK1-")).toBe(true);
  });

  it("round-trips empty and multi-chunk payloads", async () => {
    const empty = await sealed(new Uint8Array(), passphrase(), 4);

    expect(empty.envelope.chunkCount).toBe(1);
    expect(empty.envelope.chunks[0]?.ciphertext).toBe("");
    expect(
      (await openBackup({ envelope: empty.envelope, keySource: passphrase() })).payload
    ).toHaveLength(0);

    const payload = bytes("0123456789abcdefghijklmnopqrstuvwxyz");
    const multi = await sealed(payload, passphrase(), 16);

    expect(multi.envelope.chunkCount).toBe(3);
    expect(
      (await openBackup({ envelope: multi.envelope, keySource: passphrase() })).payload
    ).toEqual(payload);
  });

  it("rejects a wrong passphrase and a wrong backup key", async () => {
    const result = await sealed();
    const wrongPassphrase = passphrase("incorrect");
    const wrongKey = { kind: "backupKey" as const, backupKey: backupKey() };

    await expect(
      openBackup({ envelope: result.envelope, keySource: wrongPassphrase })
    ).rejects.toMatchObject({ code: "authentication_failed" });
    await expect(
      openBackup({ envelope: result.envelope, keySource: wrongKey })
    ).rejects.toMatchObject({ code: "authentication_failed" });
  });

  it("rejects a workspace recovery key as a backup key", async () => {
    const result = await sealed();
    const workspaceKey = encodeRecoveryKey(randomBytes(32));

    await expect(
      openBackup({
        envelope: result.envelope,
        keySource: { kind: "backupKey", backupKey: workspaceKey },
      })
    ).rejects.toBeInstanceOf(CryptoError);
  });

  it("fails when the payload, wrapped CEK, header, or chunk order is tampered with", async () => {
    const result = await sealed(bytes("0123456789abcdefghij"), passphrase(), 8);
    const envelope = result.envelope;

    const payloadTamper = clone(envelope);
    payloadTamper.chunks[0]!.ciphertext = `${payloadTamper.chunks[0]!.ciphertext.slice(0, -2)}AA`;
    await expect(
      openBackup({ envelope: payloadTamper, keySource: passphrase() })
    ).rejects.toMatchObject({ code: "authentication_failed" });

    const cekTamper = clone(envelope);
    cekTamper.chunks[1]!.wrappedCek.tag = `${cekTamper.chunks[1]!.wrappedCek.tag.slice(0, -2)}AA`;
    await expect(
      openBackup({ envelope: cekTamper, keySource: passphrase() })
    ).rejects.toMatchObject({ code: "authentication_failed" });

    const headerTamper = clone(envelope);
    headerTamper.encryption.kid = "another-key";
    await expect(
      openBackup({ envelope: headerTamper, keySource: passphrase() })
    ).rejects.toMatchObject({ code: "authentication_failed" });

    const reordered = clone(envelope);
    reordered.chunks = [reordered.chunks[1]!, reordered.chunks[0]!, reordered.chunks[2]!];
    await expect(
      openBackup({ envelope: reordered, keySource: passphrase() })
    ).rejects.toMatchObject({ code: "invalid_envelope" });
  });

  it("rejects a truncated tag, chunk count mismatch, and KDF downgrade", async () => {
    const result = await sealed(bytes("0123456789abcdefghij"), passphrase(), 8);

    const truncated = clone(result.envelope);
    truncated.chunks[0]!.tag = truncated.chunks[0]!.tag.slice(0, 8);
    await expect(
      openBackup({ envelope: truncated, keySource: passphrase() })
    ).rejects.toMatchObject({ code: "invalid_envelope" });

    const count = clone(result.envelope);
    count.chunkCount += 1;
    await expect(
      openBackup({ envelope: count, keySource: passphrase() })
    ).rejects.toMatchObject({ code: "invalid_envelope" });

    const downgrade = clone(result.envelope);
    downgrade.encryption.kdf.iterations = 599_999;
    await expect(
      openBackup({ envelope: downgrade, keySource: passphrase() })
    ).rejects.toMatchObject({ code: "invalid_kdf_parameters" });
  });

  it("uses fresh salts, keys, and nonces for every export", async () => {
    const input = {
      payload: bytes("same payload"),
      exportedAt: AT,
      counts: COUNTS,
      keySource: passphrase(),
    };
    const first = await sealBackup(input);
    const second = await sealBackup(input);

    expect(first.envelope.encryption.kdf.salt).not.toBe(
      second.envelope.encryption.kdf.salt
    );
    expect(first.envelope.encryption.kid).not.toBe(second.envelope.encryption.kid);
    expect(first.envelope.encryption.wrappedDek).not.toEqual(
      second.envelope.encryption.wrappedDek
    );
    expect(first.envelope.chunks[0]?.iv).not.toBe(second.envelope.chunks[0]?.iv);
    expect(first.envelope.chunks[0]?.ciphertext).not.toBe(
      second.envelope.chunks[0]?.ciphertext
    );
  });
});

describe("canonicalJsonBytes", () => {
  it("sorts nested object keys and preserves array order", () => {
    const encoded = canonicalJsonBytes({
      z: 1,
      a: { y: true, b: ["second", { d: 4, c: 3 }] },
    });

    expect(text(encoded)).toBe('{"a":{"b":["second",{"c":3,"d":4}],"y":true},"z":1}');
  });

  it("rejects values that JSON cannot represent", () => {
    expect(() => canonicalJsonBytes({ value: undefined })).toThrow(CryptoError);
    expect(() => canonicalJsonBytes({ value: Number.NaN })).toThrow(CryptoError);
    expect(() => canonicalJsonBytes({ value: new Uint8Array([1]) })).toThrow(CryptoError);
  });
});
