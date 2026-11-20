// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { openAuthDatabase } from "../../auth/auth-db";
import { countOwners } from "../../auth/membership";
import { runBootstrapOwner, type BootstrapIO } from "../bootstrap-owner";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "opennest-bootstrap-"));
  roots.push(root);
  return root;
}

function makeIO(
  root: string,
  password: string,
  args: string[] = ["--email", "owner@example.com"]
): { io: BootstrapIO; output: () => string; errors: () => string } {
  const out: string[] = [];
  const err: string[] = [];

  return {
    io: {
      args,
      env: { OPENNEST_DATA_DIR: root },
      stdin: Readable.from([`${password}\n`]),
      stdout: { write: (chunk: string) => out.push(chunk) },
      stderr: { write: (chunk: string) => err.push(chunk) },
    },
    output: () => out.join(""),
    errors: () => err.join(""),
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("bootstrap-owner", () => {
  it("creates the first owner from a password on stdin", async () => {
    const root = await makeRoot();
    const password = "correct horse battery staple";
    const { io, output, errors } = makeIO(root, password);

    await expect(runBootstrapOwner(io)).resolves.toBe(0);

    const database = openAuthDatabase({
      databaseFile: path.join(root, "auth.sqlite"),
    });

    try {
      expect(countOwners(database)).toBe(1);
      expect(output()).toContain("owner@example.com");
      expect(output()).not.toContain(password);
      expect(errors()).not.toContain(password);
    } finally {
      database.close();
    }
  });

  it("refuses to create a second owner", async () => {
    const root = await makeRoot();
    const first = makeIO(root, "first password is long");

    await expect(runBootstrapOwner(first.io)).resolves.toBe(0);

    const second = makeIO(root, "second password is long");
    await expect(runBootstrapOwner(second.io)).resolves.toBe(1);
    expect(second.output()).not.toContain("owner@example.com");
    expect(second.errors()).not.toContain("second password is long");

    const database = openAuthDatabase({
      databaseFile: path.join(root, "auth.sqlite"),
    });

    try {
      expect(countOwners(database)).toBe(1);
    } finally {
      database.close();
    }
  });

  it("rejects a password passed as an argument", async () => {
    const root = await makeRoot();
    const { io, output, errors } = makeIO(root, "stdin password is long", [
      "--email",
      "owner@example.com",
      "--password",
      "argv password is long",
    ]);

    await expect(runBootstrapOwner(io)).resolves.toBe(1);
    expect(output()).toBe("");
    expect(errors()).not.toContain("argv password is long");

    const database = openAuthDatabase({
      databaseFile: path.join(root, "auth.sqlite"),
    });

    try {
      expect(countOwners(database)).toBe(0);
    } finally {
      database.close();
    }
  });
});
