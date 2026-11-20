import type { IncomingMessage, ServerResponse } from "node:http";

import {
  findUserByEmail,
  findUserById,
  type AuthDatabase,
  type AuthUser,
} from "../auth/auth-db";
import { getMembership, type MembershipRecord } from "../auth/membership";
import { verifyPassword } from "../auth/password";
import {
  SESSION_TTL_MS,
  createSession,
  revokeSession,
  setSessionCsrf,
  verifySession,
  type SessionRecord,
} from "../auth/session";
import { HttpError } from "../errors";
import { CSRF_COOKIE_NAME, assertCsrf, createCsrfChallenge } from "../http/csrf";
import {
  SESSION_COOKIE_NAME,
  appendCookie,
  readCookie,
  serializeCookie,
} from "../http/cookies";
import { createRateLimiter, type RateLimiter } from "../http/rate-limit";
import { readJsonBody, sendJson, type Router } from "../http/router";

const LOGIN_RATE_LIMIT = 5;
const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;
const SESSION_MAX_AGE_SECONDS = Math.floor(SESSION_TTL_MS / 1000);
const DUMMY_DIGEST = {
  salt: "0".repeat(32),
  hash: "0".repeat(64),
};

export interface AuthRouteDependencies {
  auth: AuthDatabase;
  rateLimiter?: RateLimiter;
  now?: () => Date;
}

export interface AuthenticatedSession {
  session: SessionRecord;
  user: AuthUser;
  membership: MembershipRecord;
}

interface LoginBody {
  email: string;
  password: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLoginBody(value: unknown): LoginBody | null {
  if (
    !isRecord(value) ||
    typeof value.email !== "string" ||
    typeof value.password !== "string"
  ) {
    return null;
  }

  return {
    email: value.email,
    password: value.password,
  };
}

function sendInvalidCredentials(response: ServerResponse): void {
  sendJson(response, 401, {
    error: {
      code: "invalid_credentials",
      message: "The email or password is incorrect.",
    },
  });
}

function clientKey(request: IncomingMessage): string {
  return request.socket.remoteAddress ?? "unknown";
}

function setSessionCookies(
  response: ServerResponse,
  sessionToken: string,
  csrfToken: string
): void {
  appendCookie(
    response,
    serializeCookie(SESSION_COOKIE_NAME, sessionToken, {
      maxAge: SESSION_MAX_AGE_SECONDS,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
    })
  );
  appendCookie(
    response,
    serializeCookie(CSRF_COOKIE_NAME, csrfToken, {
      maxAge: SESSION_MAX_AGE_SECONDS,
      httpOnly: false,
      secure: true,
      sameSite: "Lax",
      path: "/",
    })
  );
}

function clearSessionCookies(response: ServerResponse): void {
  const expired = {
    maxAge: 0,
    expires: new Date(0),
    secure: true,
    sameSite: "Lax" as const,
    path: "/",
  };

  appendCookie(
    response,
    serializeCookie(SESSION_COOKIE_NAME, "", {
      ...expired,
      httpOnly: true,
    })
  );
  appendCookie(
    response,
    serializeCookie(CSRF_COOKIE_NAME, "", {
      ...expired,
      httpOnly: false,
    })
  );
}

export function sendNoContent(response: ServerResponse): void {
  if (response.headersSent) {
    return;
  }

  response.writeHead(204, {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end();
}

export function requireSession(
  request: IncomingMessage,
  auth: AuthDatabase,
  now: Date = new Date()
): AuthenticatedSession {
  const token = readCookie(request, SESSION_COOKIE_NAME);

  if (token === undefined) {
    throw new HttpError(401, "unauthorized", "Authentication is required.");
  }

  const session = verifySession(auth, token, now);

  if (session === null) {
    throw new HttpError(401, "unauthorized", "Authentication is required.");
  }

  const user = findUserById(auth, session.userId);
  const membership = getMembership(auth, session.userId);

  if (user === null || membership === null) {
    throw new HttpError(401, "unauthorized", "Authentication is required.");
  }

  return { session, user, membership };
}

export interface EstablishedSession {
  session: SessionRecord;
  token: string;
  csrfToken: string;
}

export function establishSession(
  auth: AuthDatabase,
  userId: string,
  response: ServerResponse,
  now: Date = new Date()
): EstablishedSession {
  const created = createSession(auth, userId, now);
  const challenge = createCsrfChallenge();
  setSessionCsrf(auth, created.session.id, challenge.hash);
  setSessionCookies(response, created.token, challenge.token);

  return {
    session: created.session,
    token: created.token,
    csrfToken: challenge.token,
  };
}

export function requireCsrf(request: IncomingMessage, session: SessionRecord): void {
  assertCsrf(request, session);
}

export function registerAuthRoutes(
  router: Router,
  dependencies: AuthRouteDependencies
): void {
  const rateLimiter =
    dependencies.rateLimiter ??
    createRateLimiter({
      limit: LOGIN_RATE_LIMIT,
      windowMs: LOGIN_RATE_WINDOW_MS,
    });
  const now = dependencies.now ?? (() => new Date());

  router.post("/auth/login", async (request, response) => {
    const body = parseLoginBody(await readJsonBody(request));

    if (body === null) {
      throw new HttpError(400, "bad_request", "The request body is not valid.");
    }

    const limit = rateLimiter.consume(clientKey(request));

    if (!limit.allowed) {
      response.setHeader("retry-after", String(limit.retryAfterSeconds));
      sendJson(response, 429, {
        error: {
          code: "rate_limited",
          message: "Too many login attempts. Try again later.",
        },
      });
      return;
    }

    const user = findUserByEmail(dependencies.auth, body.email);

    if (user === null) {
      await verifyPassword(body.password, DUMMY_DIGEST);
      sendInvalidCredentials(response);
      return;
    }

    if (
      !(await verifyPassword(body.password, {
        salt: user.passwordSalt,
        hash: user.passwordHash,
      }))
    ) {
      sendInvalidCredentials(response);
      return;
    }

    const membership = getMembership(dependencies.auth, user.id);

    if (membership === null) {
      sendInvalidCredentials(response);
      return;
    }

    const established = establishSession(dependencies.auth, user.id, response, now());
    rateLimiter.reset(clientKey(request));

    sendJson(response, 200, {
      user: {
        id: user.id,
        email: user.email,
        role: membership.role,
      },
      csrfToken: established.csrfToken,
    });
  });

  router.post("/auth/logout", (request, response) => {
    const token = readCookie(request, SESSION_COOKIE_NAME);

    if (token === undefined) {
      clearSessionCookies(response);
      sendNoContent(response);
      return;
    }

    const session = verifySession(dependencies.auth, token, now());

    if (session === null) {
      clearSessionCookies(response);
      sendNoContent(response);
      return;
    }

    requireCsrf(request, session);
    revokeSession(dependencies.auth, token, now());
    clearSessionCookies(response);
    sendNoContent(response);
  });
}
