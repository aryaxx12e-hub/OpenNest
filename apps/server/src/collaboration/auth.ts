import type { IncomingHttpHeaders } from "node:http";

import { findUserById, type AuthDatabase } from "../auth/auth-db";
import { getMembership, type Role } from "../auth/membership";
import { verifySession } from "../auth/session";
import { SESSION_COOKIE_NAME, parseCookies } from "../http/cookies";

export interface CollaborationIdentity {
  userId: string;
  displayName: string;
  role: Role;
  sessionId: string;
}

export interface CollaborationHandshakeRequest {
  headers: IncomingHttpHeaders;
}

export interface CollaborationHandshakeOptions {
  auth: AuthDatabase;
  publicUrl: string;
  now?: () => Date;
}

export class CollaborationAuthError extends Error {
  readonly status: 401 | 403;

  constructor(status: 401 | 403, message: string) {
    super(message);
    this.name = "CollaborationAuthError";
    this.status = status;
  }
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export function isAllowedCollaborationOrigin(
  origin: string | undefined,
  publicUrl: string
): boolean {
  if (origin === undefined || origin.length === 0) {
    return false;
  }

  try {
    return new URL(origin).origin === new URL(publicUrl).origin;
  } catch {
    return false;
  }
}

export function authenticateCollaborationHandshake(
  request: CollaborationHandshakeRequest,
  options: CollaborationHandshakeOptions
): CollaborationIdentity {
  if (
    !isAllowedCollaborationOrigin(
      headerValue(request.headers, "origin"),
      options.publicUrl
    )
  ) {
    throw new CollaborationAuthError(403, "The origin is not allowed.");
  }

  const cookieHeader = headerValue(request.headers, "cookie");
  const token = parseCookies(cookieHeader)[SESSION_COOKIE_NAME];

  if (token === undefined) {
    throw new CollaborationAuthError(401, "Authentication is required.");
  }

  const session = verifySession(options.auth, token, options.now?.() ?? new Date());

  if (session === null) {
    throw new CollaborationAuthError(401, "Authentication is required.");
  }

  const user = findUserById(options.auth, session.userId);
  const membership = getMembership(options.auth, session.userId);

  if (user === null || membership === null) {
    throw new CollaborationAuthError(403, "Membership is required.");
  }

  return {
    userId: user.id,
    displayName: user.email,
    role: membership.role,
    sessionId: session.id,
  };
}
