// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openAuthDatabase, type AuthDatabase } from "../auth-db";
import { AuthError } from "../errors";
import { acceptInvite, createInvite } from "../invite";
import {
  bootstrapOwner,
  changeRole,
  getMembership,
  listMembers,
  revokeMember,
} from "../membership";
import { createSession, verifySession } from "../session";

const NOW = new Date("2026-11-18T10:00:00.000Z");
const roots: string[] = [];
const databases: AuthDatabase[] = [];

async function makeDatabase(): Promise<AuthDatabase> {
  const root = await mkdtemp(path.join(tmpdir(), "opennest-auth-membership-"));
  roots.push(root);
  const database = openAuthDatabase({
    databaseFile: path.join(root, "auth.sqlite"),
  });
  databases.push(database);
  return database;
}

async function makeOwner(database: AuthDatabase): Promise<string> {
  const owner = await bootstrapOwner(
    database,
    {
      email: "owner@example.com",
      password: "correct horse battery staple",
    },
    NOW
  );

  return owner.user.id;
}

async function addMember(
  database: AuthDatabase,
  ownerId: string,
  role: "editor" | "viewer",
  email: string
): Promise<{ userId: string; token: string }> {
  const invite = createInvite(database, ownerId, { email, role }, NOW);
  const accepted = await acceptInvite(
    database,
    invite.token,
    "member password is long",
    new Date(NOW.getTime() + 1000)
  );

  return {
    userId: accepted.user.id,
    token: createSession(database, accepted.user.id, NOW).token,
  };
}

async function expectAuthError(
  action: () => unknown | Promise<unknown>,
  code: string
): Promise<AuthError> {
  let caught: unknown;

  try {
    await action();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(AuthError);
  expect((caught as AuthError).code).toBe(code);
  return caught as AuthError;
}

afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
  }
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("membership", () => {
  it("lets an owner promote a viewer but not the viewer themselves", async () => {
    const database = await makeDatabase();
    const ownerId = await makeOwner(database);
    const viewer = await addMember(database, ownerId, "viewer", "viewer@example.com");

    await expectAuthError(
      () => changeRole(database, viewer.userId, viewer.userId, "editor"),
      "forbidden"
    );

    const updated = changeRole(database, ownerId, viewer.userId, "editor");
    expect(updated.role).toBe("editor");
    expect(getMembership(database, viewer.userId)?.role).toBe("editor");
  });

  it("revokes membership and every active session", async () => {
    const database = await makeDatabase();
    const ownerId = await makeOwner(database);
    const viewer = await addMember(database, ownerId, "viewer", "viewer@example.com");

    expect(verifySession(database, viewer.token, NOW)).not.toBeNull();

    revokeMember(database, ownerId, viewer.userId);

    expect(getMembership(database, viewer.userId)).toBeNull();
    expect(verifySession(database, viewer.token, NOW)).toBeNull();
    expect(listMembers(database).map((member) => member.userId)).toEqual([ownerId]);
  });

  it("does not let a non-owner invite or revoke", async () => {
    const database = await makeDatabase();
    const ownerId = await makeOwner(database);
    const viewer = await addMember(database, ownerId, "viewer", "viewer@example.com");

    await expectAuthError(
      () =>
        createInvite(
          database,
          viewer.userId,
          { email: "another@example.com", role: "viewer" },
          NOW
        ),
      "forbidden"
    );
    await expectAuthError(
      () => revokeMember(database, viewer.userId, ownerId),
      "forbidden"
    );
  });
});

describe("invites", () => {
  it("accepts an invite exactly once and creates one member", async () => {
    const database = await makeDatabase();
    const ownerId = await makeOwner(database);
    const invite = createInvite(
      database,
      ownerId,
      { email: "new@example.com", role: "viewer" },
      NOW
    );

    expect(invite.invite.expiresAt).toBe(
      new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
    );

    const accepted = await acceptInvite(
      database,
      invite.token,
      "a sufficiently long password",
      new Date(NOW.getTime() + 1000)
    );

    expect(accepted.user.email).toBe("new@example.com");
    expect(accepted.membership.role).toBe("viewer");
    expect(listMembers(database)).toHaveLength(2);

    await expectAuthError(
      () =>
        acceptInvite(
          database,
          invite.token,
          "a sufficiently long password",
          new Date(NOW.getTime() + 2000)
        ),
      "invite_used"
    );

    expect(listMembers(database)).toHaveLength(2);
  });

  it("rejects an expired invite without creating a user", async () => {
    const database = await makeDatabase();
    const ownerId = await makeOwner(database);
    const invite = createInvite(
      database,
      ownerId,
      { email: "late@example.com", role: "editor" },
      NOW
    );
    const password = "a sufficiently long password";

    const error = await expectAuthError(
      () =>
        acceptInvite(
          database,
          invite.token,
          password,
          new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000)
        ),
      "invite_expired"
    );

    expect(String(error)).not.toContain(invite.token);
    expect(String(error)).not.toContain(password);
    expect(
      database.sqlite.prepare("SELECT COUNT(*) AS count FROM users").get()
    ).toMatchObject({ count: 1 });
    expect(listMembers(database)).toHaveLength(1);
  });

  it("stores only the invite token hash", async () => {
    const database = await makeDatabase();
    const ownerId = await makeOwner(database);
    const invite = createInvite(
      database,
      ownerId,
      { email: "hash@example.com", role: "viewer" },
      NOW
    );

    expect(
      JSON.stringify(database.sqlite.prepare("SELECT * FROM invites").all())
    ).not.toContain(invite.token);
    expect(invite.token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
