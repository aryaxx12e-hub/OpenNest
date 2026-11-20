import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

import { HttpError } from "../errors";
import { sha256Hex, type SessionRecord } from "../auth/session";
import { readCookie } from "./cookies";

export const CSRF_COOKIE_NAME = "opennest_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";
const CSRF_TOKEN_BYTES = 32;

export interface CsrfChallenge {
  token: string;
  hash: string;
}

export interface CsrfEvidence {
  headerToken: string | undefined;
  cookieToken: string | undefined;
  sessionHash: string | null;
}

function safeEqual(first: string, second: string): boolean {
  const firstBytes = Buffer.from(first, "utf8");
  const secondBytes = Buffer.from(second, "utf8");

  if (firstBytes.length !== secondBytes.length) {
    return false;
  }

  return timingSafeEqual(firstBytes, secondBytes);
}

export function createCsrfChallenge(): CsrfChallenge {
  const token = randomBytes(CSRF_TOKEN_BYTES).toString("base64url");

  return {
    token,
    hash: sha256Hex(token),
  };
}

export function verifyCsrf(evidence: CsrfEvidence): boolean {
  const { headerToken, cookieToken, sessionHash } = evidence;

  if (
    headerToken === undefined ||
    cookieToken === undefined ||
    sessionHash === null ||
    sessionHash.length === 0 ||
    !safeEqual(headerToken, cookieToken)
  ) {
    return false;
  }

  return safeEqual(sha256Hex(headerToken), sessionHash);
}

export function readCsrfHeader(request: IncomingMessage): string | undefined {
  const value = request.headers[CSRF_HEADER_NAME];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export function assertCsrf(request: IncomingMessage, session: SessionRecord): void {
  const valid = verifyCsrf({
    headerToken: readCsrfHeader(request),
    cookieToken: readCookie(request, CSRF_COOKIE_NAME),
    sessionHash: session.csrfHash,
  });

  if (!valid) {
    throw new HttpError(403, "csrf_invalid", "The CSRF token is missing or invalid.");
  }
}
