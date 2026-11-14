import { describe, expect, it } from "vitest";

import { backupFileSchema } from "../backup";

const AT = "2026-11-13T00:00:00.000Z";
const BLOB = "66666666-6666-4666-8666-666666666666";

function backup(overrides: Record<string, unknown> = {}) {
  return {
    format: "opennest-backup",
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
      blobs: [
        {
          key: BLOB,
          mimeType: "text/plain",
          data: "aGVsbG8=",
        },
      ],
    },
    ...overrides,
  };
}

describe("backupFileSchema", () => {
  it("accepts a versioned backup envelope", () => {
    expect(backupFileSchema.parse(backup())).toBeTruthy();
  });

  it("rejects an unknown top-level key", () => {
    expect(backupFileSchema.safeParse({ ...backup(), extra: true }).success).toBe(false);
  });

  it("rejects a different format marker", () => {
    expect(
      backupFileSchema.safeParse(backup({ format: "opennest-archive" })).success
    ).toBe(false);
  });

  it("rejects an unsupported format version", () => {
    expect(backupFileSchema.safeParse(backup({ formatVersion: 2 })).success).toBe(false);
  });

  it("requires blob data to be a base64 string", () => {
    const value = backup();

    value.snapshot.blobs[0] = {
      key: BLOB,
      mimeType: "text/plain",
      data: 123 as never,
    };

    expect(backupFileSchema.safeParse(value).success).toBe(false);
  });

  it("rejects a blob MIME type outside the allowlist", () => {
    const value = backup();

    value.snapshot.blobs[0] = {
      key: BLOB,
      mimeType: "application/zip",
      data: "aGVsbG8=",
    };

    expect(backupFileSchema.safeParse(value).success).toBe(false);
  });
});
