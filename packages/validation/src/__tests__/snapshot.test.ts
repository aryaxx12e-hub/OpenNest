import { describe, expect, it } from "vitest";

import { manifestEntrySchema, restoreManifestSchema } from "../manifest";
import { backupSnapshotSchema, snapshotBlobSchema } from "../snapshot";

const WS = "11111111-1111-4111-8111-111111111111";
const FOLDER = "22222222-2222-4222-8222-222222222222";
const FILE = "33333333-3333-4333-8333-333333333333";
const NOTE = "44444444-4444-4444-8444-444444444444";
const TAG = "55555555-5555-4555-8555-555555555555";
const BLOB = "66666666-6666-4666-8666-666666666666";
const SHA = "a".repeat(64);
const AT = "2026-11-12T00:00:00.000Z";
const PDF = "application/pdf";

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    snapshotVersion: 1,
    schemaVersion: 1,
    kind: "dexie",
    createdAt: AT,
    workspace: { id: WS, name: "Workspace", createdAt: AT, updatedAt: AT },
    folders: [
      {
        id: FOLDER,
        workspaceId: WS,
        parentId: null,
        name: "Kerja",
        createdAt: AT,
        updatedAt: AT,
      },
    ],
    files: [
      {
        id: FILE,
        workspaceId: WS,
        folderId: FOLDER,
        name: "laporan.pdf",
        mimeType: PDF,
        sizeBytes: 3,
        blobKey: BLOB,
        checksum: SHA,
        createdAt: AT,
        updatedAt: AT,
      },
    ],
    notes: [
      {
        id: NOTE,
        workspaceId: WS,
        folderId: FOLDER,
        title: "Ide",
        content: "isi",
        pinned: false,
        createdAt: AT,
        updatedAt: AT,
      },
    ],
    tags: [
      { id: TAG, workspaceId: WS, name: "Penting", color: "#AABBCC", createdAt: AT },
    ],
    fileTags: [{ fileId: FILE, tagId: TAG }],
    noteTags: [{ noteId: NOTE, tagId: TAG }],
    noteLinks: [],
    blobs: [{ key: BLOB, mimeType: PDF, data: new Uint8Array([1, 2, 3]) }],
    ...overrides,
  };
}

function paths(result: { success: boolean; error?: unknown }) {
  if (result.success) return [];
  const issues = (result as { error: { issues: { path: PropertyKey[] }[] } }).error
    .issues;
  return issues.map((issue) => issue.path.map(String).join("."));
}

describe("backupSnapshotSchema", () => {
  it("accepts a complete snapshot", () => {
    expect(backupSnapshotSchema.parse(snapshot())).toBeTruthy();
  });

  it("allows ciphertext blob lengths only for encrypted internal restores", () => {
    const mismatch = snapshot({
      blobs: [{ key: BLOB, mimeType: PDF, data: new Uint8Array([1, 2, 3, 4]) }],
    });

    expect(backupSnapshotSchema.safeParse(mismatch).success).toBe(false);
    expect(
      backupSnapshotSchema.safeParse({ ...mismatch, blobEncoding: "encrypted" }).success
    ).toBe(true);
  });

  it("accepts a snapshot with an empty library", () => {
    const parsed = backupSnapshotSchema.parse(
      snapshot({
        folders: [],
        files: [],
        notes: [],
        tags: [],
        fileTags: [],
        noteTags: [],
        noteLinks: [],
        blobs: [],
      })
    );

    expect(parsed.files).toEqual([]);
  });

  it("rejects an unsupported snapshotVersion", () => {
    expect(backupSnapshotSchema.safeParse(snapshot({ snapshotVersion: 2 })).success).toBe(
      false
    );
  });

  it("rejects an unknown kind", () => {
    expect(backupSnapshotSchema.safeParse(snapshot({ kind: "postgres" })).success).toBe(
      false
    );
  });

  it("rejects a non-integer schemaVersion", () => {
    expect(backupSnapshotSchema.safeParse(snapshot({ schemaVersion: 1.5 })).success).toBe(
      false
    );
  });

  it("rejects a duplicate id", () => {
    const parsed = backupSnapshotSchema.safeParse(
      snapshot({
        folders: [
          {
            id: FOLDER,
            workspaceId: WS,
            parentId: null,
            name: "a",
            createdAt: AT,
            updatedAt: AT,
          },
          {
            id: FOLDER,
            workspaceId: WS,
            parentId: null,
            name: "b",
            createdAt: AT,
            updatedAt: AT,
          },
        ],
      })
    );

    expect(parsed.success).toBe(false);
    expect(paths(parsed)).toContain("folders");
  });

  it("rejects a folder whose parent is missing", () => {
    const parsed = backupSnapshotSchema.safeParse(
      snapshot({
        folders: [
          {
            id: FOLDER,
            workspaceId: WS,
            parentId: "77777777-7777-4777-8777-777777777777",
            name: "a",
            createdAt: AT,
            updatedAt: AT,
          },
        ],
      })
    );

    expect(parsed.success).toBe(false);
    expect(paths(parsed)).toContain("folders");
  });

  it("rejects a folder cycle", () => {
    const parsed = backupSnapshotSchema.safeParse(
      snapshot({
        folders: [
          {
            id: FOLDER,
            workspaceId: WS,
            parentId: TAG,
            name: "a",
            createdAt: AT,
            updatedAt: AT,
          },
          {
            id: TAG,
            workspaceId: WS,
            parentId: FOLDER,
            name: "b",
            createdAt: AT,
            updatedAt: AT,
          },
        ],
        tags: [],
        fileTags: [],
        noteTags: [],
      })
    );

    expect(parsed.success).toBe(false);
  });

  it("rejects a file that points at a missing folder", () => {
    const parsed = backupSnapshotSchema.safeParse(
      snapshot({
        files: [
          {
            id: FILE,
            workspaceId: WS,
            folderId: "88888888-8888-4888-8888-888888888888",
            name: "a.pdf",
            mimeType: PDF,
            sizeBytes: 3,
            blobKey: BLOB,
            checksum: SHA,
            createdAt: AT,
            updatedAt: AT,
          },
        ],
      })
    );

    expect(parsed.success).toBe(false);
    expect(paths(parsed)).toContain("files");
  });

  it("rejects a file whose blob is missing", () => {
    const parsed = backupSnapshotSchema.safeParse(snapshot({ blobs: [] }));

    expect(parsed.success).toBe(false);
    expect(paths(parsed)).toContain("files");
  });

  it("rejects a note link that points at a missing note", () => {
    const parsed = backupSnapshotSchema.safeParse(
      snapshot({
        noteLinks: [
          { sourceNoteId: NOTE, targetNoteId: "99999999-9999-4999-8999-999999999999" },
        ],
      })
    );

    expect(parsed.success).toBe(false);
    expect(paths(parsed)).toContain("noteLinks");
  });

  it("rejects a note that links to itself", () => {
    const parsed = backupSnapshotSchema.safeParse(
      snapshot({ noteLinks: [{ sourceNoteId: NOTE, targetNoteId: NOTE }] })
    );

    expect(parsed.success).toBe(false);
    expect(paths(parsed)).toContain("noteLinks");
  });
  it("rejects a fileTag whose file is missing", () => {
    const parsed = backupSnapshotSchema.safeParse(snapshot({ files: [], blobs: [] }));

    expect(parsed.success).toBe(false);
  });

  it("rejects a duplicate fileTag pair", () => {
    const parsed = backupSnapshotSchema.safeParse(
      snapshot({
        fileTags: [
          { fileId: FILE, tagId: TAG },
          { fileId: FILE, tagId: TAG },
        ],
      })
    );

    expect(parsed.success).toBe(false);
  });

  it("rejects a duplicate blob key", () => {
    const parsed = backupSnapshotSchema.safeParse(
      snapshot({
        blobs: [
          { key: BLOB, mimeType: PDF, data: new Uint8Array([1]) },
          { key: BLOB, mimeType: PDF, data: new Uint8Array([2]) },
        ],
      })
    );

    expect(parsed.success).toBe(false);
  });

  it("rejects a byte length that disagrees with sizeBytes", () => {
    const parsed = backupSnapshotSchema.safeParse(
      snapshot({ blobs: [{ key: BLOB, mimeType: PDF, data: new Uint8Array([1, 2]) }] })
    );

    expect(parsed.success).toBe(false);
    expect(paths(parsed)).toContain("blobs");
  });

  it("rejects an orphan blob, because restore would keep an unreachable file", () => {
    const parsed = backupSnapshotSchema.safeParse(
      snapshot({
        blobs: [
          { key: BLOB, mimeType: PDF, data: new Uint8Array([1, 2, 3]) },
          {
            key: "77777777-7777-4777-8777-777777777777",
            mimeType: PDF,
            data: new Uint8Array([9]),
          },
        ],
      })
    );

    expect(parsed.success).toBe(false);
    expect(paths(parsed)).toContain("blobs");
  });

  it("rejects a blob MIME type outside the allowlist", () => {
    const parsed = backupSnapshotSchema.safeParse(
      snapshot({
        blobs: [
          { key: BLOB, mimeType: "application/zip", data: new Uint8Array([1, 2, 3]) },
        ],
      })
    );

    expect(parsed.success).toBe(false);
  });

  it("rejects a record in the wrong workspace", () => {
    const parsed = backupSnapshotSchema.safeParse(
      snapshot({
        tags: [
          {
            id: TAG,
            workspaceId: "77777777-7777-4777-8777-777777777777",
            name: "Penting",
            color: null,
            createdAt: AT,
          },
        ],
      })
    );

    expect(parsed.success).toBe(false);
    expect(paths(parsed)).toContain("tags");
  });

  it("rejects a deeply nested folder chain above the depth limit", () => {
    const folders: Record<string, unknown>[] = [];
    let parentId: string | null = null;

    for (let index = 0; index <= 1001; index += 1) {
      const id = `${index.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;

      folders.push({
        id,
        workspaceId: WS,
        parentId,
        name: `f${index}`,
        createdAt: AT,
        updatedAt: AT,
      });
      parentId = id;
    }

    const parsed = backupSnapshotSchema.safeParse(
      snapshot({
        folders,
        files: [],
        notes: [],
        tags: [],
        fileTags: [],
        noteTags: [],
        blobs: [],
      })
    );

    expect(parsed.success).toBe(false);
    expect(paths(parsed)).toContain("folders");
  });

  it("rejects an unknown key at the top level", () => {
    expect(backupSnapshotSchema.safeParse(snapshot({ extra: 1 })).success).toBe(false);
  });

  it("strips unknown keys inside entity objects, for forward compatibility", () => {
    const parsed = backupSnapshotSchema.parse(
      snapshot({
        tags: [
          {
            id: TAG,
            workspaceId: WS,
            name: "Penting",
            color: null,
            createdAt: AT,
            futureField: "ignored",
          },
        ],
      })
    );

    expect(parsed.tags[0]).not.toHaveProperty("futureField");
  });

  it("reports a validation domain code on failures", () => {
    const parsed = backupSnapshotSchema.safeParse(snapshot({ snapshotVersion: 9 }));

    expect(parsed.success).toBe(false);

    const issue = (parsed as { error: { issues: { params?: unknown }[] } }).error
      .issues[0];

    expect(issue?.params).toMatchObject({ domainCode: "validation" });
  });
});

describe("snapshotBlobSchema", () => {
  it("accepts a Uint8Array payload", () => {
    expect(
      snapshotBlobSchema.parse({ key: BLOB, mimeType: PDF, data: new Uint8Array([1]) })
    ).toBeTruthy();
  });

  it("rejects a plain array where bytes are required", () => {
    expect(
      snapshotBlobSchema.safeParse({ key: BLOB, mimeType: PDF, data: [1, 2] }).success
    ).toBe(false);
  });

  it("rejects a null MIME type, because a blob without a type is unknowable", () => {
    expect(
      snapshotBlobSchema.safeParse({
        key: BLOB,
        mimeType: null,
        data: new Uint8Array([1]),
      }).success
    ).toBe(false);
  });
});

describe("restoreManifestSchema", () => {
  function manifest(overrides: Record<string, unknown> = {}) {
    return {
      manifestVersion: 1,
      snapshotVersion: 1,
      schemaVersion: 1,
      kind: "sqlite",
      createdAt: AT,
      entries: [{ path: "snapshot.json", bytes: 10, sha256: SHA }],
      ...overrides,
    };
  }

  it("accepts a well-formed manifest", () => {
    expect(restoreManifestSchema.parse(manifest())).toBeTruthy();
  });

  it("requires manifestVersion 1", () => {
    expect(
      restoreManifestSchema.safeParse(manifest({ manifestVersion: 2 })).success
    ).toBe(false);
  });

  it("requires snapshotVersion 1", () => {
    expect(
      restoreManifestSchema.safeParse(manifest({ snapshotVersion: 2 })).success
    ).toBe(false);
  });

  it("accepts an empty entry list", () => {
    expect(restoreManifestSchema.safeParse(manifest({ entries: [] })).success).toBe(true);
  });

  it.each(["/absolute/x", "../escape", "a/../b", "a\\b", ""])(
    "rejects the unsafe path %j",
    (path) => {
      expect(
        restoreManifestSchema.safeParse(
          manifest({ entries: [{ path, bytes: 1, sha256: SHA }] })
        ).success
      ).toBe(false);
    }
  );

  it("accepts a dotted file name", () => {
    expect(
      restoreManifestSchema.safeParse(
        manifest({ entries: [{ path: "blobs/a.bin", bytes: 1, sha256: SHA }] })
      ).success
    ).toBe(true);
  });

  it("rejects a negative or fractional byte count", () => {
    expect(
      restoreManifestSchema.safeParse(
        manifest({ entries: [{ path: "a", bytes: -1, sha256: SHA }] })
      ).success
    ).toBe(false);
    expect(
      restoreManifestSchema.safeParse(
        manifest({ entries: [{ path: "a", bytes: 1.5, sha256: SHA }] })
      ).success
    ).toBe(false);
  });

  it("normalizes an uppercase digest and rejects a malformed one", () => {
    expect(
      restoreManifestSchema.safeParse(
        manifest({ entries: [{ path: "a", bytes: 1, sha256: SHA.toUpperCase() }] })
      ).success
    ).toBe(true);
    expect(
      restoreManifestSchema.safeParse(
        manifest({ entries: [{ path: "a", bytes: 1, sha256: "xyz" }] })
      ).success
    ).toBe(false);
  });

  it("rejects duplicate entry paths", () => {
    expect(
      restoreManifestSchema.safeParse(
        manifest({
          entries: [
            { path: "a", bytes: 1, sha256: SHA },
            { path: "a", bytes: 2, sha256: SHA },
          ],
        })
      ).success
    ).toBe(false);
  });

  it("rejects an unknown key", () => {
    expect(restoreManifestSchema.safeParse({ ...manifest(), extra: 1 }).success).toBe(
      false
    );
  });
});

describe("manifestEntrySchema", () => {
  it("normalizes an uppercase digest to lowercase", () => {
    expect(
      manifestEntrySchema.parse({ path: "a", bytes: 1, sha256: SHA.toUpperCase() }).sha256
    ).toBe(SHA);
  });
});
