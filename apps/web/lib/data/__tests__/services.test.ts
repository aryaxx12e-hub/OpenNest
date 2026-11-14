import { describe, expect, it } from "vitest";

import { createMemoryStorage, type IsoDate } from "@opennest/core";

import { createAppServices, sha256Hex, randomBlobKey } from "../services";

describe("createAppServices", () => {
  it("ensures one workspace with the localized default name", async () => {
    const storage = createMemoryStorage({
      idGenerator: () => "11111111-1111-4111-8111-111111111111",
    });

    const result = await createAppServices(storage, {
      defaultWorkspaceName: "Ruang Kerja",
      clock: () => "2030-01-01T00:00:00.000Z" as IsoDate,
      hash: sha256Hex,
      generateBlobKey: randomBlobKey,
    });

    expect(result.workspace.name).toBe("Ruang Kerja");
    expect(result.services.workspace).toBeDefined();
    expect(result.services.file).toBeDefined();
    expect(result.services.note).toBeDefined();
    expect(result.services.search).toBeDefined();
  });

  it("returns the existing workspace unchanged", async () => {
    const storage = createMemoryStorage({
      idGenerator: () => "22222222-2222-4222-8222-222222222222",
    });

    const first = await createAppServices(storage, {
      defaultWorkspaceName: "Pertama",
      clock: () => "2030-01-01T00:00:00.000Z" as IsoDate,
      hash: sha256Hex,
      generateBlobKey: randomBlobKey,
    });
    const second = await createAppServices(storage, {
      defaultWorkspaceName: "Kedua",
      clock: () => "2030-01-01T00:00:01.000Z" as IsoDate,
      hash: sha256Hex,
      generateBlobKey: randomBlobKey,
    });

    expect(second.workspace.id).toBe(first.workspace.id);
    expect(second.workspace.name).toBe("Pertama");
  });
});

describe("sha256Hex", () => {
  it("hashes bytes as lowercase SHA-256 hex", async () => {
    await expect(sha256Hex(new Uint8Array([1, 2, 3]))).resolves.toBe(
      "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81"
    );
  });
});

describe("randomBlobKey", () => {
  it("returns a lowercase UUID v4", () => {
    expect(randomBlobKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
});
