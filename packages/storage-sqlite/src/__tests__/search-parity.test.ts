// @vitest-environment node

import "fake-indexeddb/auto";

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  HOSTILE_SEARCH_QUERIES,
  searchCorpusSnapshot,
  type FolderId,
  type SearchQuery,
  type StorageAdapter,
  type TagId,
} from "@opennest/core";
import { createDexieStorage } from "@opennest/storage-dexie";
import { backupSnapshotSchema } from "@opennest/validation";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSqliteStorage } from "../index";

const WORKSPACE_ID = searchCorpusSnapshot().workspace.id;
const ROOT = "22222222-2222-4222-8222-222222222221" as FolderId;
const CHILD = "22222222-2222-4222-8222-222222222222" as FolderId;
const KERJA = "66666666-6666-4666-8666-666666666601" as TagId;
const PENTING = "66666666-6666-4666-8666-666666666602" as TagId;

const F1 = "33333333-3333-4333-8333-333333333301";
const F2 = "33333333-3333-4333-8333-333333333302";
const F3 = "33333333-3333-4333-8333-333333333303";
const F5 = "33333333-3333-4333-8333-333333333305";
const N1 = "55555555-5555-4555-8555-555555555501";
const N2 = "55555555-5555-4555-8555-555555555502";
const N3 = "55555555-5555-4555-8555-555555555503";
const N4 = "55555555-5555-4555-8555-555555555504";
const N5 = "55555555-5555-4555-8555-555555555505";
const N6 = "55555555-5555-4555-8555-555555555506";
const N7 = "55555555-5555-4555-8555-555555555507";
const N8 = "55555555-5555-4555-8555-555555555508";
const N9 = "55555555-5555-4555-8555-555555555509";
const N12 = "55555555-5555-4555-8555-55555555550c";
const N13 = "55555555-5555-4555-8555-55555555550d";
const N14 = "55555555-5555-4555-8555-55555555550e";
const N15 = "55555555-5555-4555-8555-55555555550f";

const BELANJA_ORDER = [F1, N1, N2, N3, N4, F2, N12, F3, N5, N6, N15];

let counter = 0;
let root = "";
let dexie: StorageAdapter | null = null;
let sqlite: StorageAdapter | null = null;

async function ids(adapter: StorageAdapter, query: SearchQuery): Promise<string[]> {
  const hits = await adapter.search.search(query);

  return hits.map((hit) => hit.id);
}

async function both(query: Omit<SearchQuery, "workspaceId">): Promise<{
  dexie: string[];
  sqlite: string[];
}> {
  const full = { workspaceId: WORKSPACE_ID, ...query };

  return {
    dexie: await ids(dexie as StorageAdapter, full),
    sqlite: await ids(sqlite as StorageAdapter, full),
  };
}

beforeEach(async () => {
  counter += 1;
  root = await mkdtemp(path.join(tmpdir(), "opennest-b5-parity-"));
  const snapshot = backupSnapshotSchema.parse(searchCorpusSnapshot());

  dexie = createDexieStorage({ databaseName: `opennest-b5-parity-${counter}` });
  sqlite = createSqliteStorage({
    databaseFile: ":memory:",
    blobRoot: path.join(root, "blobs"),
  });

  await dexie.init();
  await sqlite.init();
  await dexie.restore(snapshot);
  await sqlite.restore(snapshot);
});

afterEach(async () => {
  await dexie?.close();
  await sqlite?.close();
  dexie = null;
  sqlite = null;
  await rm(root, { recursive: true, force: true });
});

describe("search parity", () => {
  it("restores the same corpus into both adapters", async () => {
    expect(await (dexie as StorageAdapter).workspaces.list()).toHaveLength(1);
    expect(await (sqlite as StorageAdapter).workspaces.list()).toHaveLength(1);

    const result = await both({ text: "belanja" });

    expect(result.dexie.length).toBeGreaterThan(0);
    expect(result.sqlite).toEqual(result.dexie);
  });

  it("orders the belanja query by tier, folded title, then id", async () => {
    const result = await both({ text: "belanja" });

    expect(result.dexie).toEqual(BELANJA_ORDER);
    expect(result.sqlite).toEqual(BELANJA_ORDER);
  });

  it("orders a multi-token query by the same rules", async () => {
    const result = await both({ text: "belanja bulanan" });

    expect(result.dexie).toEqual([N4, F2, N12, N6]);
    expect(result.sqlite).toEqual([N4, F2, N12, N6]);
  });

  it("matches case, diacritics, punctuation, and token prefixes identically", async () => {
    const queries = [
      "Belanja",
      "  BELANJA  ",
      "belan",
      "bulanan",
      "oat",
      "cafe",
      "CAFÉ",
      "ünïcode",
      "istanbul",
      "İSTANBUL",
      "don",
      "don't",
      "foo-bar",
      "belanja,",
      "belanja - bulanan",
      "file",
      "strasse",
    ];

    for (const text of queries) {
      const result = await both({ text });
      expect(result.sqlite, text).toEqual(result.dexie);
    }

    expect(
      await ids(dexie as StorageAdapter, {
        workspaceId: WORKSPACE_ID,
        text: "cafe",
      })
    ).toEqual([F5, N7]);
    expect(
      await ids(sqlite as StorageAdapter, {
        workspaceId: WORKSPACE_ID,
        text: "cafe",
      })
    ).toEqual([F5, N7]);
    expect((await both({ text: "istanbul" })).sqlite).toEqual([N9]);
    const unicode = await both({ text: "ünïcode" });
    expect(unicode.dexie).toEqual([N8]);
    expect(unicode.sqlite).toEqual([N8]);
    expect((await both({ text: "don't" })).sqlite).toEqual([N13]);
    expect((await both({ text: "foo-bar" })).sqlite).toEqual([N14]);
    expect((await both({ text: "file" })).sqlite).toEqual([]);
    expect((await both({ text: "strasse" })).sqlite).toEqual([]);
  });

  it("applies folder subtree, tag, and kind filters identically", async () => {
    const cases: Array<{
      label: string;
      query: Omit<SearchQuery, "workspaceId">;
      expected: string[];
    }> = [
      {
        label: "root subtree",
        query: { text: "belanja", folderId: ROOT },
        expected: [F1, N2, N3, N4, F2, F3],
      },
      {
        label: "child",
        query: { text: "belanja", folderId: CHILD },
        expected: [N2, N4, F2],
      },
      {
        label: "root only",
        query: { text: "belanja", folderId: null },
        expected: [N1, N12, N5, N6, N15],
      },
      {
        label: "tag kerja",
        query: { text: "belanja", tagIds: [KERJA] },
        expected: [F1, N1, N2, N4, F2],
      },
      {
        label: "tag penting",
        query: { text: "belanja", tagIds: [PENTING] },
        expected: [N4, F2, N5, N15],
      },
      {
        label: "two tags",
        query: { text: "belanja", tagIds: [KERJA, PENTING] },
        expected: [N4, F2],
      },
      {
        label: "files only",
        query: { text: "belanja", kinds: ["file"] },
        expected: [F1, F2, F3],
      },
      {
        label: "notes only",
        query: { text: "belanja", kinds: ["note"] },
        expected: [N1, N2, N3, N4, N12, N5, N6, N15],
      },
      {
        label: "combined",
        query: {
          text: "belanja",
          folderId: CHILD,
          tagIds: [PENTING],
        },
        expected: [N4, F2],
      },
    ];

    for (const testCase of cases) {
      const result = await both(testCase.query);

      expect(result.dexie, testCase.label).toEqual(testCase.expected);
      expect(result.sqlite, testCase.label).toEqual(testCase.expected);
    }
  });

  it("paginates with the same slices", async () => {
    const full = await both({ text: "belanja" });
    expect(full.dexie).toEqual(BELANJA_ORDER);

    const cases = [
      { limit: 2, offset: 0 },
      { limit: 2, offset: 2 },
      { limit: 2, offset: 10 },
      { limit: 2, offset: 20 },
      { limit: 100, offset: 0 },
      { offset: 4 },
    ];

    for (const testCase of cases) {
      const result = await both({ text: "belanja", ...testCase });
      const start = testCase.offset ?? 0;
      const end = testCase.limit === undefined ? undefined : start + testCase.limit;
      const expected = BELANJA_ORDER.slice(start, end);

      expect(result.dexie, JSON.stringify(testCase)).toEqual(expected);
      expect(result.sqlite, JSON.stringify(testCase)).toEqual(expected);
    }
  });

  it("never throws on hostile queries and returns identical results", async () => {
    for (const text of HOSTILE_SEARCH_QUERIES) {
      const result = await both({ text });

      expect(result.sqlite, text).toEqual(result.dexie);
    }
  });

  it("returns no hits for empty or punctuation-only text", async () => {
    for (const text of ["", "   ", "*", "()", "-", '"']) {
      const result = await both({ text });

      expect(result.dexie, text).toEqual([]);
      expect(result.sqlite, text).toEqual([]);
    }
  });
});
