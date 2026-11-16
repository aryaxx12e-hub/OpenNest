import { describe, expect, it } from "vitest";

import { assertScopeSubset, normalizeScope, scopeDigest } from "../scope";

describe("scope validation", () => {
  it("rejects wildcard and traversal identifiers", () => {
    expect(() =>
      normalizeScope({ kind: "notes", workspaceId: "w1", noteIds: ["*"] })
    ).toThrow();
    expect(() =>
      normalizeScope({ kind: "files", workspaceId: "w1", fileIds: ["../x"] })
    ).toThrow();
    expect(() => normalizeScope({ kind: "workspace", workspaceId: "w/1" })).toThrow();
  });

  it("rejects empty scopes and duplicate selectors", () => {
    expect(() =>
      normalizeScope({ kind: "notes", workspaceId: "w1", noteIds: [] })
    ).toThrow();
    expect(() =>
      normalizeScope({
        kind: "files",
        workspaceId: "w1",
        fileIds: ["file-1", "file-1"],
      })
    ).toThrow();
  });

  it("limits bulk selections", () => {
    const ids = Array.from({ length: 501 }, (_, index) => `note-${index}`);

    expect(() =>
      normalizeScope({ kind: "notes", workspaceId: "w1", noteIds: ids })
    ).toThrow();
  });

  it("normalizes origins and rejects credentials or insecure non-loopback http", () => {
    expect(
      normalizeScope({ kind: "origin", origin: "HTTPS://Example.COM:443/path" })
    ).toEqual({
      kind: "origin",
      origin: "https://example.com",
    });
    expect(() =>
      normalizeScope({ kind: "origin", origin: "http://example.com" })
    ).toThrow();
    expect(() =>
      normalizeScope({ kind: "origin", origin: "https://user:pass@example.com" })
    ).toThrow();
    expect(() =>
      normalizeScope({ kind: "origin", origin: "https://*.example.com" })
    ).toThrow();
    expect(normalizeScope({ kind: "origin", origin: "http://127.0.0.1:3000" })).toEqual({
      kind: "origin",
      origin: "http://127.0.0.1:3000",
    });
  });
});

describe("scope containment", () => {
  const workspace = { kind: "workspace", workspaceId: "w1" } as const;

  it("lets a workspace grant cover selected entities in the same workspace", () => {
    expect(() =>
      assertScopeSubset(workspace, {
        kind: "notes",
        workspaceId: "w1",
        noteIds: ["note-1"],
      })
    ).not.toThrow();
  });

  it("does not let a selected-entity grant widen to the workspace", () => {
    expect(() =>
      assertScopeSubset(
        { kind: "notes", workspaceId: "w1", noteIds: ["note-1"] },
        workspace
      )
    ).toThrow();
  });

  it("requires every requested selector to be present in the grant", () => {
    expect(() =>
      assertScopeSubset(
        { kind: "notes", workspaceId: "w1", noteIds: ["note-1"] },
        { kind: "notes", workspaceId: "w1", noteIds: ["note-1", "note-2"] }
      )
    ).toThrow();
  });

  it("rejects cross-workspace and cross-kind matches", () => {
    expect(() =>
      assertScopeSubset(workspace, {
        kind: "files",
        workspaceId: "w2",
        fileIds: ["file-1"],
      })
    ).toThrow();
    expect(() =>
      assertScopeSubset(
        { kind: "files", workspaceId: "w1", fileIds: ["file-1"] },
        { kind: "notes", workspaceId: "w1", noteIds: ["note-1"] }
      )
    ).toThrow();
  });

  it("produces a stable digest regardless of selector order", async () => {
    const first = await scopeDigest({
      kind: "notes",
      workspaceId: "w1",
      noteIds: ["note-2", "note-1"],
    });
    const second = await scopeDigest({
      kind: "notes",
      workspaceId: "w1",
      noteIds: ["note-1", "note-2"],
    });

    expect(first).toBe(second);
  });
});
