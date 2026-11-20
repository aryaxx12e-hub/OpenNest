// @vitest-environment node

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { HttpError } from "../errors";
import { createRouter, readJsonBody, sendJson } from "../http/router";

const servers: Server[] = [];

async function serve(router: ReturnType<typeof createRouter>): Promise<string> {
  const server = createServer((request, response) => {
    void router.handle(request, response);
  });
  servers.push(server);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
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
});

describe("HTTP router", () => {
  it("serves exact routes", async () => {
    const router = createRouter();
    router.get("/health/live", (_request, response) => {
      sendJson(response, 200, { status: "ok" });
    });
    const url = await serve(router);

    const response = await fetch(`${url}/health/live`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("extracts route parameters", async () => {
    const router = createRouter();
    router.post("/notes/:noteId", (request, response, context) => {
      sendJson(response, 200, {
        noteId: context.params.noteId,
        method: request.method,
      });
    });
    const url = await serve(router);

    const response = await fetch(`${url}/notes/note-1`, { method: "POST" });

    await expect(response.json()).resolves.toEqual({
      noteId: "note-1",
      method: "POST",
    });
  });

  it("returns 404 for an unknown path", async () => {
    const router = createRouter();
    const url = await serve(router);

    const response = await fetch(`${url}/missing`);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "not_found" },
    });
  });

  it("returns 405 and Allow for a known path with the wrong method", async () => {
    const router = createRouter();
    router.get("/health", (_request, response) => {
      sendJson(response, 200, { status: "ok" });
    });
    const url = await serve(router);

    const response = await fetch(`${url}/health`, { method: "POST" });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "method_not_allowed" },
    });
  });

  it("maps HttpError to a safe response", async () => {
    const router = createRouter();
    router.get("/denied", () => {
      throw new HttpError(403, "forbidden", "You do not have access.");
    });
    const url = await serve(router);

    const response = await fetch(`${url}/denied`);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: "forbidden", message: "You do not have access." },
    });
  });

  it("rejects an oversized declared body before reading it", async () => {
    const request = {
      headers: {
        "content-type": "application/json",
        "content-length": "2048",
      },
      resume: () => undefined,
      async *[Symbol.asyncIterator]() {
        throw new Error("The body should not be read.");
      },
    } as unknown as IncomingMessage;

    await expect(readJsonBody(request, { maxBytes: 1024 })).rejects.toMatchObject({
      status: 413,
      code: "payload_too_large",
    });
  });

  it("does not expose unknown errors", async () => {
    const router = createRouter();
    router.get("/explode", () => {
      throw new Error("database password leaked");
    });
    const url = await serve(router);

    const response = await fetch(`${url}/explode`);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: { code: "internal_error", message: "An internal error occurred." },
    });
    expect(JSON.stringify(body)).not.toContain("password");
  });
});
