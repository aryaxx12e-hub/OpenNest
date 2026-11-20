import {
  createUser,
  findUserByEmail,
  normalizeEmail,
  toAuthUser,
  withTransaction,
  type AuthDatabase,
  type AuthUser,
} from "./auth-db";
import type { AuditLog } from "../audit/audit-log";
import { AuthError } from "./errors";
import { hashPassword } from "./password";
import { revokeUserSessions } from "./session";

export type Role = "owner" | "editor" | "viewer";

export interface MembershipRecord {
  userId: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

export interface MemberView extends MembershipRecord {
  email: string;
}

export interface BootstrapOwnerInput {
  email: string;
  password: string;
}

interface MembershipRow {
  user_id: string;
  role: Role;
  created_at: string;
  updated_at: string;
}

function toMembership(row: MembershipRow): MembershipRecord {
  return {
    userId: row.user_id,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function addMembership(
  database: AuthDatabase,
  userId: string,
  role: Role,
  now: Date = new Date()
): MembershipRecord {
  const timestamp = now.toISOString();
  const membership: MembershipRecord = {
    userId,
    role,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  database.sqlite
    .prepare(
      "INSERT INTO membership (user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?)"
    )
    .run(membership.userId, membership.role, membership.createdAt, membership.updatedAt);

  return membership;
}

export function getMembership(
  database: AuthDatabase,
  userId: string
): MembershipRecord | null {
  const row = database.sqlite
    .prepare(
      "SELECT user_id, role, created_at, updated_at FROM membership WHERE user_id = ?"
    )
    .get(userId) as MembershipRow | undefined;

  return row === undefined ? null : toMembership(row);
}

export function listMembers(database: AuthDatabase): MemberView[] {
  const rows = database.sqlite
    .prepare(
      "SELECT membership.user_id, membership.role, membership.created_at, membership.updated_at, users.email FROM membership JOIN users ON users.id = membership.user_id ORDER BY membership.created_at, users.email"
    )
    .all() as unknown as Array<MembershipRow & { email: string }>;

  return rows.map((row) => ({
    ...toMembership(row),
    email: row.email,
  }));
}

export function countOwners(database: AuthDatabase): number {
  const row = database.sqlite
    .prepare("SELECT COUNT(*) AS count FROM membership WHERE role = 'owner'")
    .get() as { count: number | bigint } | undefined;

  return Number(row?.count ?? 0);
}

export function assertOwner(database: AuthDatabase, userId: string): MembershipRecord {
  const membership = getMembership(database, userId);

  if (membership === null || membership.role !== "owner") {
    throw new AuthError("forbidden", "You are not allowed to perform this action.");
  }

  return membership;
}

export async function bootstrapOwner(
  database: AuthDatabase,
  input: BootstrapOwnerInput,
  now: Date = new Date(),
  audit?: AuditLog
): Promise<{ user: AuthUser; membership: MembershipRecord }> {
  const email = normalizeEmail(input.email);
  const digest = await hashPassword(input.password);

  return withTransaction(database, () => {
    if (countOwners(database) > 0) {
      throw new AuthError(
        "already_bootstrapped",
        "An owner already exists for this workspace."
      );
    }

    if (findUserByEmail(database, email) !== null) {
      throw new AuthError("user_exists", "A user with that email already exists.");
    }

    const user = createUser(database, { email, digest, now });
    const membership = addMembership(database, user.id, "owner", now);

    audit?.record(
      {
        actorId: user.id,
        action: "bootstrap.owner",
        targetType: "member",
        targetId: user.id,
        result: "success",
      },
      now
    );

    return { user: toAuthUser(user), membership };
  });
}

export function changeRole(
  database: AuthDatabase,
  actorId: string,
  targetUserId: string,
  role: Role,
  now: Date = new Date(),
  audit?: AuditLog
): MembershipRecord {
  assertOwner(database, actorId);

  const target = getMembership(database, targetUserId);

  if (target === null) {
    throw new AuthError("not_found", "The member does not exist.");
  }

  if (target.role === "owner" && role !== "owner" && countOwners(database) <= 1) {
    throw new AuthError("last_owner", "The last owner cannot be demoted.");
  }

  const updatedAt = now.toISOString();

  withTransaction(database, () => {
    database.sqlite
      .prepare("UPDATE membership SET role = ?, updated_at = ? WHERE user_id = ?")
      .run(role, updatedAt, targetUserId);
    audit?.record(
      {
        actorId,
        action: "member.role_change",
        targetType: "member",
        targetId: targetUserId,
        result: "success",
      },
      now
    );
  });

  return {
    ...target,
    role,
    updatedAt,
  };
}

export function revokeMember(
  database: AuthDatabase,
  actorId: string,
  targetUserId: string,
  now: Date = new Date(),
  audit?: AuditLog
): void {
  assertOwner(database, actorId);

  const target = getMembership(database, targetUserId);

  if (target === null) {
    throw new AuthError("not_found", "The member does not exist.");
  }

  if (target.role === "owner" && countOwners(database) <= 1) {
    throw new AuthError("last_owner", "The last owner cannot be revoked.");
  }

  withTransaction(database, () => {
    database.sqlite.prepare("DELETE FROM membership WHERE user_id = ?").run(targetUserId);
    revokeUserSessions(database, targetUserId, now);
    audit?.record(
      {
        actorId,
        action: "member.revoke",
        targetType: "member",
        targetId: targetUserId,
        result: "success",
      },
      now
    );
  });
}
