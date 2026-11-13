import { describe, expect, it } from "vitest";

import { fileInputSchema, filePatchSchema } from "../file";
import { folderInputSchema, folderPatchSchema } from "../folder";
import { noteInputSchema, notePatchSchema } from "../note";
import { tagInputSchema, tagPatchSchema } from "../tag";

const WS = "11111111-1111-4111-8111-111111111111";
const FOLDER = "22222222-2222-4222-8222-222222222222";
const BLOB_LOWER = "44444444-4444-4444-8444-444444444444";
const HEX = "a".repeat(64);

function messages(result: { success: boolean; error?: { issues: unknown[] } }) {
  return result.success ? [] : (result.error?.issues ?? []);
}

describe("folderInputSchema", () => {
  it("accepts a root folder", () => {
    const parsed = folderInputSchema.parse({
      workspaceId: WS,
      parentId: null,
      name: "  Kerja  ",
    });

    expect(parsed).toEqual({ workspaceId: WS, parentId: null, name: "Kerja" });
  });

  it("accepts a nested folder", () => {
    expect(
      folderInputSchema.parse({ workspaceId: WS, parentId: FOLDER, name: "Arsip" })
    ).toMatchObject({ parentId: FOLDER });
  });

  it("normalizes an uppercase workspace id", () => {
    const parsed = folderInputSchema.parse({
      workspaceId: WS.toUpperCase(),
      parentId: null,
      name: "Kerja",
    });

    expect(parsed.workspaceId).toBe(WS);
  });

  it("requires parentId, so root is explicit", () => {
    expect(folderInputSchema.safeParse({ workspaceId: WS, name: "Kerja" }).success).toBe(
      false
    );
  });

  it("rejects an unknown key", () => {
    expect(
      folderInputSchema.safeParse({
        workspaceId: WS,
        parentId: null,
        name: "Kerja",
        extra: 1,
      }).success
    ).toBe(false);
  });

  it("rejects an invalid name", () => {
    expect(
      folderInputSchema.safeParse({ workspaceId: WS, parentId: null, name: "a/b" })
        .success
    ).toBe(false);
  });
});

describe("folderPatchSchema", () => {
  it("accepts a rename", () => {
    expect(folderPatchSchema.parse({ name: "Baru" })).toEqual({ name: "Baru" });
  });

  it("accepts moving to the root with an explicit null", () => {
    expect(folderPatchSchema.parse({ parentId: null })).toEqual({ parentId: null });
  });

  it("accepts moving under a folder", () => {
    expect(folderPatchSchema.parse({ parentId: FOLDER })).toEqual({ parentId: FOLDER });
  });

  it("rejects an empty patch", () => {
    expect(folderPatchSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an unknown key", () => {
    expect(folderPatchSchema.safeParse({ name: "Baru", id: "x" }).success).toBe(false);
  });
});

describe("fileInputSchema", () => {
  const good = {
    workspaceId: WS,
    folderId: null,
    name: "laporan.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    blobKey: BLOB_LOWER,
    checksum: null,
  };

  it("accepts a complete record", () => {
    expect(fileInputSchema.parse(good)).toEqual(good);
  });

  it("accepts a null MIME type and a checksum", () => {
    expect(
      fileInputSchema.parse({ ...good, mimeType: null, checksum: HEX })
    ).toMatchObject({ mimeType: null, checksum: HEX });
  });

  it("accepts a zero-byte file", () => {
    expect(fileInputSchema.parse({ ...good, sizeBytes: 0 })).toMatchObject({
      sizeBytes: 0,
    });
  });

  it("rejects an uppercase blob key", () => {
    expect(
      fileInputSchema.safeParse({
        ...good,
        blobKey: "3F2B8C1E-9D4A-4F6B-8C2D-1A2B3C4D5E6F",
      }).success
    ).toBe(false);
  });

  it("rejects an unknown MIME type", () => {
    expect(
      fileInputSchema.safeParse({ ...good, mimeType: "application/zip" }).success
    ).toBe(false);
  });

  it("rejects a size over 25 MiB", () => {
    expect(fileInputSchema.safeParse({ ...good, sizeBytes: 26_214_401 }).success).toBe(
      false
    );
  });

  it("requires checksum so callers cannot silently omit integrity", () => {
    const withoutChecksum = {
      workspaceId: good.workspaceId,
      folderId: good.folderId,
      name: good.name,
      mimeType: good.mimeType,
      sizeBytes: good.sizeBytes,
      blobKey: good.blobKey,
    };

    expect(fileInputSchema.safeParse(withoutChecksum).success).toBe(false);
  });

  it("rejects an unknown key", () => {
    expect(fileInputSchema.safeParse({ ...good, extra: true }).success).toBe(false);
  });
});

describe("filePatchSchema", () => {
  it("accepts a rename", () => {
    expect(filePatchSchema.parse({ name: "baru.pdf" })).toEqual({ name: "baru.pdf" });
  });

  it("accepts moving to the root", () => {
    expect(filePatchSchema.parse({ folderId: null })).toEqual({ folderId: null });
  });

  it("rejects an empty patch", () => {
    expect(filePatchSchema.safeParse({}).success).toBe(false);
  });

  it("rejects fields the port does not allow, like sizeBytes", () => {
    expect(filePatchSchema.safeParse({ sizeBytes: 1 }).success).toBe(false);
  });
});

describe("noteInputSchema", () => {
  it("defaults content to an empty string and pinned to false", () => {
    expect(
      noteInputSchema.parse({ workspaceId: WS, folderId: null, title: "  Ide  " })
    ).toEqual({
      workspaceId: WS,
      folderId: null,
      title: "Ide",
      content: "",
      pinned: false,
    });
  });

  it("keeps provided content and pinned", () => {
    expect(
      noteInputSchema.parse({
        workspaceId: WS,
        folderId: FOLDER,
        title: "Ide",
        content: "isi",
        pinned: true,
      })
    ).toMatchObject({ content: "isi", pinned: true, folderId: FOLDER });
  });

  it("requires folderId, so root is explicit", () => {
    expect(noteInputSchema.safeParse({ workspaceId: WS, title: "Ide" }).success).toBe(
      false
    );
  });

  it("rejects an unknown key", () => {
    expect(
      noteInputSchema.safeParse({ workspaceId: WS, folderId: null, title: "Ide", x: 1 })
        .success
    ).toBe(false);
  });
});

describe("notePatchSchema", () => {
  it("accepts a title change", () => {
    expect(notePatchSchema.parse({ title: "Baru" })).toEqual({ title: "Baru" });
  });

  it("accepts clearing content", () => {
    expect(notePatchSchema.parse({ content: "" })).toEqual({ content: "" });
  });

  it("accepts unpinning and moving to root", () => {
    expect(notePatchSchema.parse({ pinned: false, folderId: null })).toEqual({
      pinned: false,
      folderId: null,
    });
  });

  it("rejects an empty patch", () => {
    expect(notePatchSchema.safeParse({}).success).toBe(false);
  });
});

describe("tagInputSchema", () => {
  it("accepts a tag without a colour", () => {
    expect(tagInputSchema.parse({ workspaceId: WS, name: "  Penting  " })).toEqual({
      workspaceId: WS,
      name: "Penting",
    });
  });

  it("accepts a colour and normalizes its case", () => {
    expect(
      tagInputSchema.parse({ workspaceId: WS, name: "Penting", color: "#AABBCC" })
    ).toMatchObject({ color: "#aabbcc" });
  });

  it("accepts an explicit null colour", () => {
    expect(
      tagInputSchema.parse({ workspaceId: WS, name: "Penting", color: null })
    ).toMatchObject({ color: null });
  });

  it("rejects an unknown key", () => {
    expect(
      tagInputSchema.safeParse({ workspaceId: WS, name: "Penting", key: "penting" })
        .success
    ).toBe(false);
  });
});

describe("tagPatchSchema", () => {
  it("accepts a rename", () => {
    expect(tagPatchSchema.parse({ name: "Penting" })).toEqual({ name: "Penting" });
  });

  it("accepts clearing the colour", () => {
    expect(tagPatchSchema.parse({ color: null })).toEqual({ color: null });
  });

  it("rejects an empty patch", () => {
    expect(tagPatchSchema.safeParse({}).success).toBe(false);
  });
});

describe("issue shape", () => {
  it("reports the validation domain code and the failing path", () => {
    const result = folderInputSchema.safeParse({
      workspaceId: "no",
      parentId: null,
      name: "ok",
    });
    const issues = messages(result);

    expect(issues[0]).toMatchObject({
      path: ["workspaceId"],
      params: { domainCode: "validation" },
    });
  });

  it("puts a name problem on the name path", () => {
    const result = folderInputSchema.safeParse({
      workspaceId: WS,
      parentId: null,
      name: "a/b",
    });
    const issues = messages(result);

    expect(issues[0]).toMatchObject({
      path: ["name"],
      params: { domainCode: "validation" },
    });
  });
});
