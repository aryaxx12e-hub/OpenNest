import type { IncomingMessage } from "node:http";

import { createAuditLog, type AuditLog } from "../audit/audit-log";
import type { AuthDatabase } from "../auth/auth-db";
import { AuthError } from "../auth/errors";
import { acceptInvite, createInvite, type InviteRole } from "../auth/invite";
import { changeRole, listMembers, revokeMember, type Role } from "../auth/membership";
import { HttpError } from "../errors";
import { roleAllows } from "../http/auth";
import { readJsonBody, sendJson, type Router } from "../http/router";
import {
  establishSession,
  requireCsrf,
  requireSession,
  sendNoContent,
  type AuthenticatedSession,
} from "./auth";

export interface MembershipRouteDependencies {
  auth: AuthDatabase;
  audit?: AuditLog;
  now?: () => Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseInviteBody(value: unknown): { email: string; role: InviteRole } | null {
  if (
    !isRecord(value) ||
    typeof value.email !== "string" ||
    (value.role !== "editor" && value.role !== "viewer")
  ) {
    return null;
  }

  return { email: value.email, role: value.role };
}

function parseRole(value: unknown): Role | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.role === "owner" || value.role === "editor" || value.role === "viewer") {
    return value.role;
  }

  return null;
}

function parseAcceptBody(value: unknown): { token: string; password: string } | null {
  if (
    !isRecord(value) ||
    typeof value.token !== "string" ||
    typeof value.password !== "string" ||
    value.token.length === 0 ||
    value.password.length === 0
  ) {
    return null;
  }

  return { token: value.token, password: value.password };
}

function mapAuthError(error: unknown): unknown {
  if (!(error instanceof AuthError)) {
    return error;
  }

  switch (error.code) {
    case "forbidden":
      return new HttpError(403, error.code, error.message);
    case "not_found":
      return new HttpError(404, error.code, error.message);
    case "last_owner":
    case "user_exists":
    case "already_bootstrapped":
      return new HttpError(409, error.code, error.message);
    case "invite_invalid":
    case "invite_expired":
    case "invite_used":
    case "validation":
      return new HttpError(400, error.code, error.message);
    default:
      return new HttpError(500, "internal_error", "An internal error occurred.");
  }
}

function ownerSession(
  request: IncomingMessage,
  dependencies: MembershipRouteDependencies,
  now: Date
): AuthenticatedSession {
  const session = requireSession(request, dependencies.auth, now);
  requireCsrf(request, session.session);

  if (!roleAllows(session.membership.role, "admin")) {
    throw new HttpError(403, "forbidden", "You are not allowed to perform this action.");
  }

  return session;
}

function badBody(): never {
  throw new HttpError(400, "bad_request", "The request body is not valid.");
}

export function registerMembershipRoutes(
  router: Router,
  dependencies: MembershipRouteDependencies
): void {
  const audit = dependencies.audit ?? createAuditLog(dependencies.auth);
  const now = dependencies.now ?? (() => new Date());

  router.get("/auth/members", (request, response) => {
    try {
      requireSession(request, dependencies.auth, now());
      sendJson(response, 200, { members: listMembers(dependencies.auth) });
    } catch (error) {
      throw mapAuthError(error);
    }
  });

  router.post("/auth/invites", async (request, response) => {
    try {
      const session = ownerSession(request, dependencies, now());
      const body = parseInviteBody(await readJsonBody(request));

      if (body === null) {
        badBody();
      }

      const created = createInvite(
        dependencies.auth,
        session.user.id,
        body,
        now(),
        audit
      );

      sendJson(response, 201, created);
    } catch (error) {
      throw mapAuthError(error);
    }
  });

  router.post("/auth/invites/accept", async (request, response) => {
    try {
      const body = parseAcceptBody(await readJsonBody(request));

      if (body === null) {
        badBody();
      }

      const accepted = await acceptInvite(
        dependencies.auth,
        body.token,
        body.password,
        now(),
        audit
      );
      const established = establishSession(
        dependencies.auth,
        accepted.user.id,
        response,
        now()
      );

      sendJson(response, 201, {
        user: {
          id: accepted.user.id,
          email: accepted.user.email,
          role: accepted.membership.role,
        },
        csrfToken: established.csrfToken,
      });
    } catch (error) {
      throw mapAuthError(error);
    }
  });

  router.patch("/auth/members/:userId", async (request, response, context) => {
    try {
      const session = ownerSession(request, dependencies, now());
      const role = parseRole(await readJsonBody(request));

      if (role === null) {
        badBody();
      }

      const targetUserId = context.params.userId;

      if (targetUserId === undefined) {
        throw new HttpError(400, "bad_request", "The request path is not valid.");
      }

      const member = changeRole(
        dependencies.auth,
        session.user.id,
        targetUserId,
        role,
        now(),
        audit
      );

      sendJson(response, 200, { member });
    } catch (error) {
      throw mapAuthError(error);
    }
  });

  router.delete("/auth/members/:userId", (request, response, context) => {
    try {
      const session = ownerSession(request, dependencies, now());
      const targetUserId = context.params.userId;

      if (targetUserId === undefined) {
        throw new HttpError(400, "bad_request", "The request path is not valid.");
      }

      revokeMember(dependencies.auth, session.user.id, targetUserId, now(), audit);
      sendNoContent(response);
    } catch (error) {
      throw mapAuthError(error);
    }
  });
}
