import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const plugin = vi.hoisted(() => ({
  writeFile: vi.fn(async () => ({ uri: "file:///cache/exports/note.md" })),
  share: vi.fn(async () => undefined),
}));

vi.mock("@capacitor/filesystem", () => ({
  Filesystem: { writeFile: plugin.writeFile },
  Directory: { Cache: "CACHE" },
  Encoding: { UTF8: "utf8" },
}));

vi.mock("@capacitor/share", () => ({
  Share: { share: plugin.share },
}));

import { exportBinaryFile, exportTextFile, sanitizeExportFileName } from "../export";

let createObjectURL: ReturnType<typeof vi.spyOn>;
let revokeObjectURL: ReturnType<typeof vi.spyOn>;
let click: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  plugin.writeFile.mockClear();
  plugin.share.mockClear();
  createObjectURL = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValue("blob:opennest-export");
  revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => undefined);
  delete window.Capacitor;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.Capacitor;
});

describe("export file names", () => {
  it("strips path separators and control characters", () => {
    expect(sanitizeExportFileName("../a/b:c?.txt")).toBe("a-b-c-.txt");
    expect(sanitizeExportFileName(" \u0000 ")).toBe("opennest-export");
  });
});

describe("text exports", () => {
  it("downloads through the browser on the web", async () => {
    await exportTextFile("note.md", "hello", "text/markdown");

    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:opennest-export");
    expect(plugin.writeFile).not.toHaveBeenCalled();
  });

  it("writes to the cache and opens the share sheet on native", async () => {
    window.Capacitor = { isNativePlatform: () => true };

    await exportTextFile("note.md", "hello", "text/markdown");

    expect(plugin.writeFile).toHaveBeenCalledWith({
      path: "exports/note.md",
      data: "hello",
      directory: "CACHE",
      encoding: "utf8",
      recursive: true,
    });
    expect(plugin.share).toHaveBeenCalledWith(
      expect.objectContaining({ url: "file:///cache/exports/note.md" })
    );
    expect(click).not.toHaveBeenCalled();
  });
});

describe("binary exports", () => {
  it("writes base64 data and shares it on native", async () => {
    window.Capacitor = { isNativePlatform: () => true };

    await exportBinaryFile(
      "file.bin",
      new Blob(["hi"], { type: "application/octet-stream" })
    );

    expect(plugin.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "exports/file.bin",
        data: "aGk=",
        directory: "CACHE",
      })
    );
    expect(plugin.share).toHaveBeenCalled();
  });

  it("downloads the blob on the web", async () => {
    await exportBinaryFile("file.bin", new Blob(["hi"]));

    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(plugin.writeFile).not.toHaveBeenCalled();
  });
});
