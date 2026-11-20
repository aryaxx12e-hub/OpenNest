import { randomBytes, randomUUID } from "node:crypto";

import {
  assertEmail,
  createUser,
  findUserByEmail,
  toAuthUser,
  withTransaction,
  type AuthDatabase,
  type AuthUser,
} from "./auth-db";
import type { AuditLog } from "../audit/audit-log";
import { AuthError } from "./errors";
import { addMembership, assertOwner, type MembershipRecord } from "./membership";
import { hashPassword } from "./password";
import { sha256Hex } from "./session";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVITE_TOKEN_BYTES = 32;

export type InviteRole = "editor" | "viewer";

export interface InviteRecord {
  id: string;
  email: string;
  role: InviteRole;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedBy: string | null;
}

export interface CreateInviteInput {
  email: string;
  role: InviteRole;
}

export interface CreatedInvite {
  invite: InviteRecord;
  token: string;
}

export interface AcceptedInvite {
  user: AuthUser;
  membership: MembershipRecord;
}

interface InviteRow {
  id: string;
  email: string;
  role: InviteRole;
  created_by: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
}

export function createInvite(
  database: AuthDatabase,
  actorId: string,
  input: CreateInviteInput,
  now: Date = new Date(),
  audit?: AuditLog
): CreatedInvite {
  assertOwner(database, actorId);

  if (input.role !== "editor" && input.role !== "viewer") {
    throw new AuthError("validation", "The invite role is not valid.");
  }

  const email = assertEmail(input.email);
  const token = randomBytes(INVITE_TOKEN_BYTES).toString("base64url");
  const invite: InviteRecord = {
    id: randomUUID(),
    email,
    role: input.role,
    createdBy: actorId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString(),
    acceptedAt: null,
    acceptedBy: null,
  };

  withTransaction(database, () => {
    database.sqlite
      .prepare(
        "INSERT INTO invites (id, email, role, token_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        invite.id,
        invite.email,
        invite.role,
        sha256Hex(token),
        invite.createdBy,
        invite.createdAt,
        invite.expiresAt
      );
    audit?.record(
      {
        actorId,
        action: "member.invite",
        targetType: "invite",
        targetId: invite.id,
        result: "success",
      },
      now
    );
  });

  return { invite, token };
}

export async function acceptInvite(
  database: AuthDatabase,
  token: string,
  password: string,
  now: Date = new Date(),
  audit?: AuditLog
): Promise<AcceptedInvite> {
  const digest = await hashPassword(password);

  return withTransaction(database, () => {
    const row = database.sqlite
      .prepare(
        "SELECT id, email, role, created_by, created_at, expires_at, accepted_at, accepted_by FROM invites WHERE token_hash = ?"
      )
      .get(sha256Hex(token)) as InviteRow | undefined;

    if (row === undefined) {
      throw new AuthError("invite_invalid", "The invite is not valid.");
    }

    if (row.accepted_at !== null) {
      throw new AuthError("invite_used", "The invite has already been used.");
    }

    if (row.expires_at <= now.toISOString()) {
      throw new AuthError("invite_expired", "The invite has expired.");
    }

    if (findUserByEmail(database, row.email) !== null) {
      throw new AuthError("user_exists", "A user with that email already exists.");
    }

    const user = createUser(database, { email: row.email, digest, now });
    const membership = addMembership(database, user.id, row.role, now);

    database.sqlite
      .prepare("UPDATE invites SET accepted_at = ?, accepted_by = ? WHERE id = ?")
      .run(now.toISOString(), user.id, row.id);
    audit?.record(
      {
        actorId: user.id,
        action: "member.accept",
        targetType: "member",
        targetId: user.id,
        result: "success",
      },
      now
    );

    return {
      user: toAuthUser(user),
      membership,
    };
  });
}
