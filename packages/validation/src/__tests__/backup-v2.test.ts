import { describe, expect, it } from "vitest";

import { backupFileSchema, BACKUP_FORMAT } from "../backup";
import {
  BACKUP_CHUNK_SIZE,
  BACKUP_KDF_MIN_ITERATIONS,
  backupEnvelopeSchema,
  backupFileV2Schema,
} from "../backup-v2";

const AT = "2026-11-16T00:00:00.000Z";
const WRAPPED = {
  iv: "AAAAAAAAAAAAAAAA",
  ciphertext: "q83v",
  tag: "AAAAAAAAAAAAAAAAAAAAAA",
};

function backupV2(overrides: Record<string, unknown> = {}) {
  return {
    format: BACKUP_FORMAT,
    formatVersion: 2,
    exportedAt: AT,
    encryption: {
      version: 1,
      alg: "AES-256-GCM",
      kdf: {
        name: "PBKDF2-SHA-256",
        hash: "SHA-256",
        iterations: BACKUP_KDF_MIN_ITERATIONS,
        salt: "AAAAAAAAAAAAAAAAAAAAAA",
        domain: "opennest:backup-kek:v1",
      },
      kid: "backup-key-id",
      wrappedDek: WRAPPED,
    },
    chunkSize: BACKUP_CHUNK_SIZE,
    chunkCount: 1,
    summary: {
      counts: { workspaces: 1, folders: 1, tags: 2, files: 3, notes: 4 },
      totalPlaintextBytes: 12,
    },
    chunks: [
      {
        index: 0,
        iv: "AAAAAAAAAAAAAAAA",
        wrappedCek: WRAPPED,
        ciphertext: "q83v",
        tag: "AAAAAAAAAAAAAAAAAAAAAA",
      },
    ],
    ...overrides,
  };
}

function withEncryption(patch: Record<string, unknown>) {
  const value = backupV2();
  value.encryption = { ...value.encryption, ...patch };

  return value;
}

function withKdf(patch: Record<string, unknown>) {
  const value = backupV2();
  value.encryption.kdf = { ...value.encryption.kdf, ...patch };

  return value;
}

describe("backupFileV2Schema", () => {
  it("accepts a complete encrypted backup header", () => {
    expect(backupFileV2Schema.parse(backupV2())).toBeTruthy();
  });

  it("rejects unknown top-level and encryption fields", () => {
    expect(backupFileV2Schema.safeParse({ ...backupV2(), extra: true }).success).toBe(
      false
    );
    expect(backupFileV2Schema.safeParse(withEncryption({ extra: true })).success).toBe(
      false
    );
  });

  it("rejects unknown algorithms, versions, and domains", () => {
    expect(
      backupFileV2Schema.safeParse(withEncryption({ alg: "AES-128-GCM" })).success
    ).toBe(false);
    expect(backupFileV2Schema.safeParse(withEncryption({ version: 2 })).success).toBe(
      false
    );
    expect(
      backupFileV2Schema.safeParse(withKdf({ domain: "opennest:workspace-kek:v1" }))
        .success
    ).toBe(false);
  });

  it("rejects KDF parameters below the production floor", () => {
    expect(
      backupFileV2Schema.safeParse(withKdf({ iterations: BACKUP_KDF_MIN_ITERATIONS - 1 }))
        .success
    ).toBe(false);
  });

  it("rejects malformed base64url fields", () => {
    expect(
      backupFileV2Schema.safeParse(withKdf({ salt: "not base64url!" })).success
    ).toBe(false);
    expect(
      backupFileV2Schema.safeParse(
        withEncryption({ wrappedDek: { ...WRAPPED, iv: "=" } })
      ).success
    ).toBe(false);
  });

  it("requires complete, ordered, unique chunk indexes", () => {
    const duplicate = backupV2({
      chunkCount: 2,
      chunks: [
        { ...backupV2Chunk(), index: 0 },
        { ...backupV2Chunk(), index: 0 },
      ],
    });
    const missing = backupV2({
      chunkCount: 2,
      chunks: [{ ...backupV2Chunk(), index: 0 }],
    });
    const reordered = backupV2({
      chunkCount: 2,
      chunks: [
        { ...backupV2Chunk(), index: 1 },
        { ...backupV2Chunk(), index: 0 },
      ],
    });

    expect(backupFileV2Schema.safeParse(duplicate).success).toBe(false);
    expect(backupFileV2Schema.safeParse(missing).success).toBe(false);
    expect(backupFileV2Schema.safeParse(reordered).success).toBe(false);
  });

  it("rejects a mismatched chunk count and invalid summary counts", () => {
    expect(backupFileV2Schema.safeParse({ ...backupV2(), chunkCount: 2 }).success).toBe(
      false
    );
    expect(
      backupFileV2Schema.safeParse({
        ...backupV2(),
        summary: {
          ...backupV2().summary,
          counts: { ...backupV2().summary.counts, workspaces: 2 },
        },
      }).success
    ).toBe(false);
  });
});

function backupV2Chunk() {
  return (backupV2().chunks as Array<Record<string, unknown>>)[0]!;
}

describe("backupEnvelopeSchema", () => {
  it("discriminates plaintext v1 and encrypted v2", () => {
    const v1 = {
      format: BACKUP_FORMAT,
      formatVersion: 1,
      exportedAt: AT,
      snapshot: {
        snapshotVersion: 1,
        schemaVersion: 1,
        kind: "dexie",
        createdAt: AT,
        workspace: {},
        folders: [],
        files: [],
        notes: [],
        tags: [],
        fileTags: [],
        noteTags: [],
        noteLinks: [],
        blobs: [],
      },
    };

    expect(backupEnvelopeSchema.parse(v1).formatVersion).toBe(1);
    expect(backupEnvelopeSchema.parse(backupV2()).formatVersion).toBe(2);
  });

  it("keeps the v1 schema strict about version 2", () => {
    expect(backupFileSchema.safeParse(backupV2()).success).toBe(false);
    expect(
      backupEnvelopeSchema.safeParse({ ...backupV2(), formatVersion: 3 }).success
    ).toBe(false);
  });
});
