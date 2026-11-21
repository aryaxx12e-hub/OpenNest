import { describe, expect, it } from "vitest";

import {
  extensionHref,
  fileHref,
  folderHref,
  legacyRouteRedirect,
  noteHref,
} from "../routes";

describe("route helpers", () => {
  it("builds note and extension query routes", () => {
    expect(noteHref("note-1")).toBe("/notes?noteId=note-1");
    expect(extensionHref("com.example.notes")).toBe(
      "/extensions?extensionId=com.example.notes"
    );
  });

  it("builds folder routes with an optional folder id", () => {
    expect(folderHref("folder-1")).toBe("/library?folderId=folder-1");
    expect(folderHref(null)).toBe("/library");
  });

  it("builds file query routes", () => {
    expect(fileHref("file-1")).toBe("/files?fileId=file-1");
  });

  it("encodes identifiers safely", () => {
    expect(noteHref("a/b?c&d")).toBe("/notes?noteId=a%2Fb%3Fc%26d");
    expect(folderHref("a/b")).toBe("/library?folderId=a%2Fb");
    expect(fileHref("a b")).toBe("/files?fileId=a%20b");
    expect(extensionHref("a/b")).toBe("/extensions?extensionId=a%2Fb");
  });

  it("maps legacy dynamic paths to query routes", () => {
    expect(legacyRouteRedirect("/notes/note-1")).toBe("/notes?noteId=note-1");
    expect(legacyRouteRedirect("/library/folder-1/")).toBe("/library?folderId=folder-1");
    expect(legacyRouteRedirect("/files/file-1")).toBe("/files?fileId=file-1");
    expect(legacyRouteRedirect("/extensions/com.example.notes")).toBe(
      "/extensions?extensionId=com.example.notes"
    );
  });

  it("returns null for current routes and malformed paths", () => {
    expect(legacyRouteRedirect("/notes")).toBeNull();
    expect(legacyRouteRedirect("/library")).toBeNull();
    expect(legacyRouteRedirect("/files")).toBeNull();
    expect(legacyRouteRedirect("/extensions")).toBeNull();
    expect(legacyRouteRedirect("/notes/a/b")).toBeNull();
    expect(legacyRouteRedirect("/notes/%E0%A4%A")).toBeNull();
    expect(legacyRouteRedirect("/")).toBeNull();
  });
});
