// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openAuthDatabase, type AuthDatabase } from "../../auth/auth-db";
import { bootstrapOwner } from "../../auth/membership";
import { verifySession } from "../../auth/session";
import { registerAuthRoutes } from "../../routes/auth";
import { createRouter } from "../router";
import { createRateLimiter } from "../rate-limit";

const PASSWORD = "correct horse battery staple";
const roots: string[] = [];
const databases: AuthDatabase[] = [];
const servers: Server[] = [];

interface AuthTestServer {
  auth: AuthDatabase;
  base: string;
  ownerId: string;
  clock: { now: Date };
}

async function startAuthServer(limit = 5): Promise<AuthTestServer> {
  const root = await mkdtemp(path.join(tmpdir(), "opennest-auth-routes-"));
  roots.push(root);
  const auth = openAuthDatabase({
    databaseFile: path.join(root, "auth.sqlite"),
  });
  databases.push(auth);
  const owner = await bootstrapOwner(auth, {
    email: "owner@example.com",
    password: PASSWORD,
  });
  const clock = { now: new Date("2026-11-18T10:00:00.000Z") };
  const router = createRouter();

  registerAuthRoutes(router, {
    auth,
    rateLimiter: createRateLimiter({
      limit,
      windowMs: 60_000,
      now: () => clock.now,
    }),
    now: () => clock.now,
  });

  const server = createServer((request, response) => {
    void router.handle(request, response);
  });
  servers.push(server);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;

  return {
    auth,
    base: `http://127.0.0.1:${address.port}`,
    ownerId: owner.user.id,
    clock,
  };
}

function cookieLines(response: Response): string[] {
  return response.headers.getSetCookie();
}

function cookiePair(line: string): string {
  return line.split(";")[0] ?? "";
}

function cookieHeader(response: Response): string {
  return cookieLines(response).map(cookiePair).join("; ");
}

function findCookie(response: Response, name: string): string | undefined {
  return cookieLines(response)
    .find((line) => line.startsWith(`${name}=`))
    ?.split(";")[0];
}

async function login(
  base: string,
  email = "owner@example.com",
  password = PASSWORD
): Promise<{ response: Response; body: { csrfToken?: string; user?: unknown } }> {
  const response = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  return {
    response,
    body: (await response.json()) as { csrfToken?: string; user?: unknown },
  };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    )
  );

  for (const database of databases.splice(0)) {
    database.close();
  }

  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("auth routes", () => {
  it("logs in with an HttpOnly, Secure, SameSite=Lax session cookie", async () => {
    const { base, auth } = await startAuthServer();
    const { response, body } = await login(base);

    expect(response.status).toBe(200);
    expect(body.user).toMatchObject({
      email: "owner@example.com",
      role: "owner",
    });

    const sessionCookie = cookieLines(response).find((line) =>
      line.startsWith("opennest_session=")
    );
    const csrfCookie = cookieLines(response).find((line) =>
      line.startsWith("opennest_csrf=")
    );

    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("Secure");
    expect(sessionCookie).toContain("SameSite=Lax");
    expect(sessionCookie).toContain("Path=/");
    expect(csrfCookie).toBeDefined();
    expect(csrfCookie).not.toContain("HttpOnly");
    expect(csrfCookie).toContain("Secure");
    expect(body.csrfToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(body.csrfToken ?? "", "base64url")).toHaveLength(32);

    const token = cookiePair(sessionCookie ?? "").split("=")[1] ?? "";
    expect(verifySession(auth, token)).not.toBeNull();
    expect(JSON.stringify(body)).not.toContain(token);
  });

  it("returns the same generic failure for an unknown email and a wrong password", async () => {
    const { base } = await startAuthServer();
    const unknown = await login(base, "missing@example.com", PASSWORD);
    const wrong = await login(base, "owner@example.com", "wrong password");

    expect(unknown.response.status).toBe(401);
    expect(wrong.response.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(unknown.body).toEqual({
      error: {
        code: "invalid_credentials",
        message: "The email or password is incorrect.",
      },
    });
  });

  it("logs out and revokes the session when CSRF matches", async () => {
    const { base, auth } = await startAuthServer();
    const loggedIn = await login(base);
    const token = (findCookie(loggedIn.response, "opennest_session") ?? "").split("=")[1];
    const cookies = cookieHeader(loggedIn.response);

    expect(verifySession(auth, token ?? "")).not.toBeNull();

    const response = await fetch(`${base}/auth/logout`, {
      method: "POST",
      headers: {
        cookie: cookies,
        "x-csrf-token": loggedIn.body.csrfToken ?? "",
      },
    });

    expect(response.status).toBe(204);
    expect(verifySession(auth, token ?? "")).toBeNull();
    expect(cookieLines(response).every((line) => /Max-Age=0/i.test(line))).toBe(true);
  });

  it("rejects state-changing requests without CSRF or with another session's token", async () => {
    const { base, auth } = await startAuthServer();
    const first = await login(base);
    const second = await login(base);
    const token = (findCookie(first.response, "opennest_session") ?? "").split("=")[1];

    const missing = await fetch(`${base}/auth/logout`, {
      method: "POST",
      headers: { cookie: cookieHeader(first.response) },
    });

    expect(missing.status).toBe(403);
    expect(verifySession(auth, token ?? "")).not.toBeNull();

    const crossed = await fetch(`${base}/auth/logout`, {
      method: "POST",
      headers: {
        cookie: cookieHeader(second.response),
        "x-csrf-token": first.body.csrfToken ?? "",
      },
    });

    expect(crossed.status).toBe(403);
  });

  it("rate limits repeated login attempts and releases after the window", async () => {
    const { base, clock } = await startAuthServer(2);

    await login(base, "owner@example.com", "wrong one");
    await login(base, "owner@example.com", "wrong two");

    const blocked = await login(base, "owner@example.com", PASSWORD);
    expect(blocked.response.status).toBe(429);
    expect(blocked.response.headers.get("retry-after")).toBe("60");

    clock.now = new Date(clock.now.getTime() + 60_000);
    const allowed = await login(base);
    expect(allowed.response.status).toBe(200);
  });

  it("rejects malformed login bodies without revealing account state", async () => {
    const { base } = await startAuthServer();
    const response = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "bad_request",
        message: "The request body is not valid JSON.",
      },
    });
  });
});
