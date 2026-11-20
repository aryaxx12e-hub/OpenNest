import type { IncomingMessage, ServerResponse } from "node:http";

export const SESSION_COOKIE_NAME = "opennest_session";

export interface CookieOptions {
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  path?: string;
}

export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {}
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }

  if (options.expires !== undefined) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }

  if (options.path !== undefined) {
    parts.push(`Path=${options.path}`);
  }

  if (options.httpOnly) {
    parts.push("HttpOnly");
  }

  if (options.secure) {
    parts.push("Secure");
  }

  if (options.sameSite !== undefined) {
    parts.push(`SameSite=${options.sameSite}`);
  }

  return parts.join("; ");
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};

  if (header === undefined) {
    return cookies;
  }

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");

    if (separator <= 0) {
      continue;
    }

    const name = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();

    if (name.length === 0) {
      continue;
    }

    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      cookies[name] = rawValue;
    }
  }

  return cookies;
}

export function readCookie(request: IncomingMessage, name: string): string | undefined {
  return parseCookies(request.headers.cookie)[name];
}

export function appendCookie(response: ServerResponse, cookie: string): void {
  const existing = response.getHeader("set-cookie");
  const cookies =
    existing === undefined
      ? []
      : Array.isArray(existing)
        ? existing.map(String)
        : [String(existing)];

  response.setHeader("set-cookie", [...cookies, cookie]);
}
