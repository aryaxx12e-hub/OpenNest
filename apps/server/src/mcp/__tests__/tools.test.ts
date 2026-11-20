// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createMemoryStorage, type IsoDate, type StorageAdapter } from "@opennest/core";

import { createMcpTools, type McpToolError } from "../tools";

const NOW = "2026-11-19T08:00:00.000Z" as IsoDate;
const MAX_CONTENT_BYTES = 64 * 1024;

async function setup(): Promise<{
  storage: StorageAdapter;
  workspaceId: string;
  otherWorkspaceId: string;
  noteId: string;
  otherNoteId: string;
  fileId: string;
  otherFileId: string;
  tools: ReturnType<typeof createMcpTools>;
}> {
  const storage = createMemoryStorage();
  await storage.init();
  const workspace = await storage.workspaces.ensureWorkspace({
    name: "Main",
    at: NOW,
  });
  const otherWorkspace = await storage.workspaces.create({
    name: "Other",
    at: NOW,
  });
  const note = await storage.notes.create({
    workspaceId: workspace.id,
    folderId: null,
    title: "Meeting notes",
    content: "Alpha decision belongs to the main workspace.",
    at: NOW,
  });
  const otherNote = await storage.notes.create({
    workspaceId: otherWorkspace.id,
    folderId: null,
    title: "Other notes",
    content: "Alpha decision belongs to another workspace.",
    at: NOW,
  });
  const file = await storage.files.create({
    workspaceId: workspace.id,
    folderId: null,
    name: "readme.txt",
    mimeType: "text/plain",
    sizeBytes: 18,
    blobKey: "blob-main" as never,
    checksum: null,
    at: NOW,
  });
  const otherFile = await storage.files.create({
    workspaceId: otherWorkspace.id,
    folderId: null,
    name: "other.txt",
    mimeType: "text/plain",
    sizeBytes: 18,
    blobKey: "blob-other" as never,
    checksum: null,
    at: NOW,
  });
  await storage.blobs.put(
    "blob-main" as never,
    new Blob(["main file contents"], { type: "text/plain" })
  );
  await storage.blobs.put(
    "blob-other" as never,
    new Blob(["other file contents"], { type: "text/plain" })
  );

  return {
    storage,
    workspaceId: workspace.id,
    otherWorkspaceId: otherWorkspace.id,
    noteId: note.id,
    otherNoteId: otherNote.id,
    fileId: file.id,
    otherFileId: otherFile.id,
    tools: createMcpTools({ storage }),
  };
}

async function expectToolError(
  work: Promise<unknown>,
  code: McpToolError["code"]
): Promise<void> {
  await expect(work).rejects.toMatchObject({ code });
}

describe("MCP tools", () => {
  it("exposes only the fixed read-only tool set", async () => {
    const { tools } = await setup();
    const names = tools.list().map((tool) => tool.name);

    expect(names).toEqual([
      "list_notes",
      "read_note",
      "search",
      "list_files",
      "read_text_file",
    ]);
    expect(names).not.toEqual(
      expect.arrayContaining(["write_note", "delete_note", "create_file", "sync"])
    );
    for (const tool of tools.list()) {
      expect(tool.inputSchema).toMatchObject({ type: "object" });
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it("lists notes and files only from the token workspace", async () => {
    const { tools, workspaceId, noteId, fileId, otherNoteId, otherFileId } =
      await setup();

    const notes = await tools.call("list_notes", { limit: 10 }, { workspaceId });
    const files = await tools.call("list_files", { limit: 10 }, { workspaceId });

    expect(JSON.stringify(notes)).toContain(noteId);
    expect(JSON.stringify(notes)).not.toContain(otherNoteId);
    expect(JSON.stringify(files)).toContain(fileId);
    expect(JSON.stringify(files)).not.toContain(otherFileId);
    expect(JSON.stringify(files)).not.toContain("blob-main");
    expect(JSON.stringify(files)).not.toContain("main file contents");
  });

  it("reads a note and a text file safely without following cross-workspace ids", async () => {
    const { tools, workspaceId, noteId, otherWorkspaceId, fileId } = await setup();

    const note = await tools.call("read_note", { noteId }, { workspaceId });
    const file = await tools.call("read_text_file", { fileId }, { workspaceId });

    expect(note).toMatchObject({
      id: noteId,
      content: "Alpha decision belongs to the main workspace.",
    });
    expect(file).toMatchObject({
      id: fileId,
      name: "readme.txt",
      mimeType: "text/plain",
      content: "main file contents",
    });

    await expectToolError(
      tools.call("read_note", { noteId }, { workspaceId: otherWorkspaceId }),
      "not_found"
    );
    await expectToolError(
      tools.call("read_note", { noteId: "missing" }, { workspaceId }),
      "not_found"
    );
    await expectToolError(
      tools.call("read_text_file", { fileId }, { workspaceId: otherWorkspaceId }),
      "not_found"
    );
  });

  it("searches only the token workspace", async () => {
    const { tools, workspaceId, noteId, otherNoteId } = await setup();
    const result = await tools.call(
      "search",
      { query: "Alpha", limit: 10 },
      { workspaceId }
    );

    expect(JSON.stringify(result)).toContain(noteId);
    expect(JSON.stringify(result)).not.toContain(otherNoteId);
  });

  it("refuses oversized note and file content", async () => {
    const { storage, tools, workspaceId } = await setup();
    const note = await storage.notes.create({
      workspaceId: workspaceId as never,
      folderId: null,
      title: "Huge note",
      content: "x".repeat(MAX_CONTENT_BYTES + 1),
      at: NOW,
    });
    const file = await storage.files.create({
      workspaceId: workspaceId as never,
      folderId: null,
      name: "huge.txt",
      mimeType: "text/plain",
      sizeBytes: MAX_CONTENT_BYTES + 1,
      blobKey: "blob-huge" as never,
      checksum: null,
      at: NOW,
    });
    await storage.blobs.put(
      "blob-huge" as never,
      new Blob(["y".repeat(MAX_CONTENT_BYTES + 1)], { type: "text/plain" })
    );

    await expectToolError(
      tools.call("read_note", { noteId: note.id }, { workspaceId }),
      "content_too_large"
    );
    await expectToolError(
      tools.call("read_text_file", { fileId: file.id }, { workspaceId }),
      "content_too_large"
    );
  });

  it("refuses unsupported file types and invalid arguments", async () => {
    const { storage, tools, workspaceId } = await setup();
    const file = await storage.files.create({
      workspaceId: workspaceId as never,
      folderId: null,
      name: "image.png",
      mimeType: "image/png",
      sizeBytes: 3,
      blobKey: "blob-image" as never,
      checksum: null,
      at: NOW,
    });
    await storage.blobs.put(
      "blob-image" as never,
      new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })
    );

    await expectToolError(
      tools.call("read_text_file", { fileId: file.id }, { workspaceId }),
      "unsupported_file_type"
    );
    await expectToolError(
      tools.call("read_note", {}, { workspaceId }),
      "invalid_arguments"
    );
    await expectToolError(
      tools.call("search", { query: "" }, { workspaceId }),
      "invalid_arguments"
    );
    await expectToolError(
      tools.call("list_notes", { limit: 500 }, { workspaceId }),
      "invalid_arguments"
    );
    await expectToolError(
      tools.call("write_note" as never, {}, { workspaceId }),
      "unknown_tool"
    );
  });
});
