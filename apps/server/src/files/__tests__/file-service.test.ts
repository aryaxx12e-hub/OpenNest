// @vitest-environment node

import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { IsoDate } from "@opennest/core";
import { createSqliteStorage } from "@opennest/storage-sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { createFileService, FileServiceError, type FileService } from "../file-service";
import { openFileStore, type FileStore } from "../file-store";

const NOW = new Date("2026-11-19T12:00:00.000Z");
const OWNER_ID = randomUUID();
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MIB = 1024 * 1024;

type UploadInput = Parameters<FileService["upload"]>[0];

interface Fixture {
  root: string;
  blobRoot: string;
  store: FileStore;
  service: FileService;
  workspaceId: string;
  otherWorkspaceId: string;
}

const roots: string[] = [];
const stores: FileStore[] = [];

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "opennest-file-service-"));
  roots.push(root);
  const databaseFile = path.join(root, "workspace.sqlite");
  const blobRoot = path.join(root, "blobs");
  const storage = createSqliteStorage({ databaseFile, blobRoot });

  await storage.init();

  let workspaceId: string;
  let otherWorkspaceId: string;

  try {
    const workspace = await storage.workspaces.create({
      name: "Shared workspace",
      at: NOW.toISOString() as IsoDate,
    });
    const other = await storage.workspaces.create({
      name: "Other workspace",
      at: NOW.toISOString() as IsoDate,
    });
    workspaceId = workspace.id;
    otherWorkspaceId = other.id;
  } finally {
    await storage.close();
  }

  const store = openFileStore({ databaseFile });
  stores.push(store);
  const service = await createFileService({
    store,
    blobRoot,
    now: () => NOW,
  });

  return {
    root,
    blobRoot,
    store,
    service,
    workspaceId,
    otherWorkspaceId,
  };
}

function uploadInput(
  fixture: Fixture,
  overrides: Partial<UploadInput> = {}
): UploadInput {
  return {
    workspaceId: fixture.workspaceId,
    actorId: OWNER_ID,
    role: "owner",
    folderId: null,
    name: "notes.md",
    mimeType: "text/markdown",
    data: bytes("first version"),
    ...overrides,
  };
}

async function expectFileServiceError(
  action: Promise<unknown>,
  code: string
): Promise<void> {
  await expect(action).rejects.toMatchObject({ name: "FileServiceError", code });
}

afterEach(async () => {
  for (const store of stores.splice(0)) {
    store.close();
  }

  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("server file service", () => {
  it("creates immutable versions and serves the requested version", async () => {
    const fixture = await createFixture();
    const first = await fixture.service.upload(uploadInput(fixture));

    expect(first.conflict).toBe(false);
    expect(first.version.versionNumber).toBe(1);
    expect(first.file.id).toBe(first.version.fileId);

    const second = await fixture.service.upload(
      uploadInput(fixture, {
        fileId: first.file.id,
        baseVersionId: first.version.id,
        data: bytes("second version"),
      })
    );

    expect(second.conflict).toBe(false);
    expect(second.version.versionNumber).toBe(2);
    expect(second.version.blobKey).not.toBe(first.version.blobKey);

    const versions = await fixture.service.listVersions({
      workspaceId: fixture.workspaceId,
      fileId: first.file.id,
    });

    expect(versions.map((version) => version.versionNumber)).toEqual([1, 2]);

    const original = await fixture.service.download({
      workspaceId: fixture.workspaceId,
      fileId: first.file.id,
      versionId: first.version.id,
    });
    const latest = await fixture.service.download({
      workspaceId: fixture.workspaceId,
      fileId: first.file.id,
    });

    expect(new TextDecoder().decode(original.data)).toBe("first version");
    expect(new TextDecoder().decode(latest.data)).toBe("second version");
    expect(latest.version.versionNumber).toBe(2);
  });

  it("creates a conflict copy for concurrent uploads from the same base", async () => {
    const fixture = await createFixture();
    const first = await fixture.service.upload(uploadInput(fixture));

    const results = await Promise.all([
      fixture.service.upload(
        uploadInput(fixture, {
          fileId: first.file.id,
          baseVersionId: first.version.id,
          data: bytes("first writer"),
        })
      ),
      fixture.service.upload(
        uploadInput(fixture, {
          fileId: first.file.id,
          baseVersionId: first.version.id,
          name: "notes.md",
          data: bytes("second writer"),
        })
      ),
    ]);

    const normal = results.filter((result) => !result.conflict);
    const conflicts = results.filter((result) => result.conflict);

    expect(normal).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    expect(normal[0]?.file.id).toBe(first.file.id);
    expect(normal[0]?.version.versionNumber).toBe(2);
    expect(conflicts[0]?.file.id).not.toBe(first.file.id);
    expect(conflicts[0]?.conflictOf).toBe(first.file.id);
    expect(conflicts[0]?.version.versionNumber).toBe(1);
    expect(conflicts[0]?.file.name).toContain("(conflict copy)");

    const versions = await fixture.service.listVersions({
      workspaceId: fixture.workspaceId,
      fileId: first.file.id,
    });
    expect(versions).toHaveLength(2);

    const normalDownload = await fixture.service.download({
      workspaceId: fixture.workspaceId,
      fileId: normal[0]!.file.id,
      versionId: normal[0]!.version.id,
    });
    const conflictDownload = await fixture.service.download({
      workspaceId: fixture.workspaceId,
      fileId: conflicts[0]!.file.id,
      versionId: conflicts[0]!.version.id,
    });

    expect(
      new Set([
        new TextDecoder().decode(normalDownload.data),
        new TextDecoder().decode(conflictDownload.data),
      ])
    ).toEqual(new Set(["first writer", "second writer"]));
  });

  it("requires a current base version before updating a file", async () => {
    const fixture = await createFixture();
    const first = await fixture.service.upload(uploadInput(fixture));

    await expectFileServiceError(
      fixture.service.upload(
        uploadInput(fixture, {
          fileId: first.file.id,
          data: bytes("blind overwrite"),
        })
      ),
      "base_version_required"
    );

    await expectFileServiceError(
      fixture.service.upload(
        uploadInput(fixture, {
          fileId: first.file.id,
          baseVersionId: randomUUID(),
          data: bytes("unknown base"),
        })
      ),
      "invalid_base_version"
    );
  });

  it("enforces the 25 MiB limit", async () => {
    const fixture = await createFixture();

    await expectFileServiceError(
      fixture.service.upload(
        uploadInput(fixture, {
          name: "large.txt",
          mimeType: "text/plain",
          data: new Uint8Array(25 * MIB + 1),
        })
      ),
      "file_too_large"
    );
  });

  it("validates and preserves the MIME type", async () => {
    const fixture = await createFixture();
    const uploaded = await fixture.service.upload(
      uploadInput(fixture, {
        name: "photo.png",
        mimeType: "image/png",
        data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      })
    );

    expect(uploaded.file.mimeType).toBe("image/png");
    expect(uploaded.version.mimeType).toBe("image/png");

    const downloaded = await fixture.service.download({
      workspaceId: fixture.workspaceId,
      fileId: uploaded.file.id,
    });
    expect(downloaded.mimeType).toBe("image/png");

    await expectFileServiceError(
      fixture.service.upload(
        uploadInput(fixture, { name: "archive.zip", mimeType: "application/zip" })
      ),
      "unsupported_mime_type"
    );
    await expectFileServiceError(
      fixture.service.upload(uploadInput(fixture, { name: "unknown.bin", mimeType: "" })),
      "unsupported_mime_type"
    );
  });

  it("keeps the original filename as metadata and rejects path names", async () => {
    const fixture = await createFixture();
    const uploaded = await fixture.service.upload(
      uploadInput(fixture, { name: "Quarterly report.md" })
    );

    expect(uploaded.file.name).toBe("Quarterly report.md");
    expect(uploaded.version.name).toBe("Quarterly report.md");
    expect(uploaded.version.blobKey).toMatch(UUID_V4);
    expect(uploaded.version.blobKey).not.toContain("Quarterly");

    await expectFileServiceError(
      fixture.service.upload(uploadInput(fixture, { name: "../escape.md" })),
      "invalid_file_name"
    );
    await expectFileServiceError(
      fixture.service.upload(uploadInput(fixture, { name: "..\\escape.md" })),
      "invalid_file_name"
    );
  });

  it("rejects viewer uploads and path-like identifiers", async () => {
    const fixture = await createFixture();

    await expectFileServiceError(
      fixture.service.upload(uploadInput(fixture, { role: "viewer" })),
      "forbidden"
    );
    await expectFileServiceError(
      fixture.service.download({
        workspaceId: fixture.workspaceId,
        fileId: "../etc/passwd",
      }),
      "invalid_file_id"
    );
    await expectFileServiceError(
      fixture.service.listVersions({
        workspaceId: fixture.workspaceId,
        fileId: "../../etc/passwd",
      }),
      "invalid_file_id"
    );
  });

  it("rejects cross-workspace file access", async () => {
    const fixture = await createFixture();
    const other = await fixture.service.upload(
      uploadInput(fixture, { workspaceId: fixture.otherWorkspaceId })
    );

    await expectFileServiceError(
      fixture.service.download({
        workspaceId: fixture.workspaceId,
        fileId: other.file.id,
      }),
      "not_found"
    );
    await expectFileServiceError(
      fixture.service.listVersions({
        workspaceId: fixture.workspaceId,
        fileId: other.file.id,
      }),
      "not_found"
    );
  });

  it("removes abandoned temporary files when the service starts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opennest-file-cleanup-"));
    roots.push(root);
    const databaseFile = path.join(root, "workspace.sqlite");
    const blobRoot = path.join(root, "blobs");
    const storage = createSqliteStorage({ databaseFile, blobRoot });

    await storage.init();

    let workspaceId: string;

    try {
      const workspace = await storage.workspaces.create({
        name: "Cleanup workspace",
        at: NOW.toISOString() as IsoDate,
      });
      workspaceId = workspace.id;
    } finally {
      await storage.close();
    }

    const abandoned = path.join(
      blobRoot,
      "workspaces",
      workspaceId,
      "blobs",
      "ab",
      ".abandoned.tmp"
    );
    await mkdir(path.dirname(abandoned), { recursive: true });
    await writeFile(abandoned, "partial");

    const store = openFileStore({ databaseFile });
    stores.push(store);
    const service = await createFileService({
      store,
      blobRoot,
      now: () => NOW,
    });

    await expect(access(abandoned)).rejects.toMatchObject({ code: "ENOENT" });
    expect(service.primaryWorkspace()?.id).toBe(workspaceId);
  });

  it("exposes a file service error type", () => {
    expect(new FileServiceError("not_found", "missing").code).toBe("not_found");
  });
});
