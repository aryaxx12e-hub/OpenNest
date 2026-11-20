import type { SearchHit, WorkspaceId } from "@opennest/core";
import { describe, expect, it, vi } from "vitest";

import { retrievePassages } from "../retrieve";
import type { PassageSource } from "../types";

const hits: SearchHit[] = [
  {
    kind: "note",
    id: "note-1",
    title: "Belanja bulanan",
    snippet: "belanja",
    score: 3,
  },
  {
    kind: "file",
    id: "file-1",
    title: "Catatan.txt",
    snippet: "belanja",
    score: 2,
  },
  {
    kind: "file",
    id: "file-pdf",
    title: "Laporan.pdf",
    snippet: "belanja",
    score: 1,
  },
];

function sourceFor(hit: SearchHit): PassageSource | null {
  if (hit.id === "note-1") {
    return {
      kind: "note",
      id: hit.id,
      title: hit.title,
      text: "Belanja sayur dan buah.",
      mimeType: "text/markdown",
    };
  }

  if (hit.id === "file-1") {
    return {
      kind: "file",
      id: hit.id,
      title: hit.title,
      text: "Belanja mingguan: beras, telur.",
      mimeType: "text/plain",
    };
  }

  if (hit.id === "file-pdf") {
    return {
      kind: "file",
      id: hit.id,
      title: hit.title,
      text: "Anggaran belanja.",
      mimeType: "application/pdf",
    };
  }

  return null;
}

describe("retrieval", () => {
  it("uses existing search candidates and never reindexes", async () => {
    const search = vi.fn(async () => hits);
    const reindexAll = vi.fn(async () => undefined);
    const repository = { search, reindexAll };
    const loadSource = vi.fn(async (hit: SearchHit) => sourceFor(hit));
    const result = await retrievePassages({
      workspaceId: "workspace-1" as WorkspaceId,
      query: "belanja",
      search: repository,
      loadSource,
    });

    expect(search).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      text: "belanja",
      limit: 8,
    });
    expect(reindexAll).not.toHaveBeenCalled();
    expect(loadSource).toHaveBeenCalledTimes(3);
    expect(result.passages.map((passage) => passage.sourceId)).toEqual([
      "note-1",
      "file-1",
    ]);
    expect(result.passages.every((passage) => passage.text.length > 0)).toBe(true);
  });

  it("returns nothing for an empty query without searching", async () => {
    const search = vi.fn(async () => hits);
    const result = await retrievePassages({
      workspaceId: "workspace-1" as WorkspaceId,
      query: "   ",
      search: { search },
      loadSource: async (hit) => sourceFor(hit),
    });

    expect(search).not.toHaveBeenCalled();
    expect(result.passages).toEqual([]);
  });

  it("skips missing or unreadable sources and continues", async () => {
    const search = vi.fn(async () => hits);
    const loadSource = vi.fn(async (hit: SearchHit) => {
      if (hit.id === "note-1") {
        throw new Error("unreadable");
      }

      return sourceFor(hit);
    });
    const result = await retrievePassages({
      workspaceId: "workspace-1" as WorkspaceId,
      query: "belanja",
      search: { search },
      loadSource,
    });

    expect(result.passages.map((passage) => passage.sourceId)).toEqual(["file-1"]);
    expect(result.skipped).toBe(2);
  });

  it("bounds candidates, passages, and bytes", async () => {
    const search = vi.fn(async () => hits);
    const result = await retrievePassages({
      workspaceId: "workspace-1" as WorkspaceId,
      query: "belanja",
      search: { search },
      loadSource: async (hit) => sourceFor(hit),
      maxCandidates: 2,
      maxPassages: 1,
      maxBytes: 64,
    });

    expect(search).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      text: "belanja",
      limit: 2,
    });
    expect(result.passages).toHaveLength(1);
    expect(
      result.passages.reduce(
        (total, passage) => total + new TextEncoder().encode(passage.text).byteLength,
        0
      )
    ).toBeLessThanOrEqual(64);
  });

  it("keeps only the first passage for duplicate sources", async () => {
    const search = vi.fn(async () => [hits[0]!, hits[0]!]);
    const loadSource = vi.fn(async (hit: SearchHit) => sourceFor(hit));
    const result = await retrievePassages({
      workspaceId: "workspace-1" as WorkspaceId,
      query: "belanja",
      search: { search },
      loadSource,
    });

    expect(loadSource).toHaveBeenCalledTimes(1);
    expect(result.passages).toHaveLength(1);
  });
});
