import type { IncomingMessage, ServerResponse } from "node:http";

import { HttpError } from "../errors";

export interface RouteContext {
  params: Record<string, string>;
  url: URL;
}

export type RouteHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  context: RouteContext
) => void | Promise<void>;

interface Route {
  method: string;
  segments: string[];
  handler: RouteHandler;
}

export interface Router {
  add(method: string, pattern: string, handler: RouteHandler): void;
  get(pattern: string, handler: RouteHandler): void;
  post(pattern: string, handler: RouteHandler): void;
  patch(pattern: string, handler: RouteHandler): void;
  delete(pattern: string, handler: RouteHandler): void;
  handle(request: IncomingMessage, response: ServerResponse): Promise<void>;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) {
    return;
  }

  const payload = JSON.stringify(body);

  response.writeHead(status, {
    ...JSON_HEADERS,
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function segmentsOf(pattern: string): string[] {
  return pattern.split("/").filter((segment) => segment.length > 0);
}

function matchRoute(route: Route, segments: string[]): Record<string, string> | null {
  if (route.segments.length !== segments.length) {
    return null;
  }

  const params: Record<string, string> = {};

  for (let index = 0; index < route.segments.length; index += 1) {
    const expected = route.segments[index];
    const actual = segments[index];

    if (expected === undefined || actual === undefined) {
      return null;
    }

    if (expected.startsWith(":")) {
      if (actual.length === 0) {
        return null;
      }

      params[expected.slice(1)] = actual;
      continue;
    }

    if (expected !== actual) {
      return null;
    }
  }

  return params;
}

function decodeSegments(pathname: string): string[] | null {
  const raw = pathname.split("/").filter((segment) => segment.length > 0);

  try {
    return raw.map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
}

export function createRouter(): Router {
  const routes: Route[] = [];

  function add(method: string, pattern: string, handler: RouteHandler): void {
    routes.push({
      method: method.toUpperCase(),
      segments: segmentsOf(pattern),
      handler,
    });
  }

  return {
    add,
    get(pattern, handler) {
      add("GET", pattern, handler);
    },
    post(pattern, handler) {
      add("POST", pattern, handler);
    },
    patch(pattern, handler) {
      add("PATCH", pattern, handler);
    },
    delete(pattern, handler) {
      add("DELETE", pattern, handler);
    },
    async handle(request, response) {
      const method = (request.method ?? "GET").toUpperCase();

      let url: URL;

      try {
        url = new URL(request.url ?? "/", "http://localhost");
      } catch {
        sendJson(response, 400, {
          error: { code: "bad_request", message: "The request URL is not valid." },
        });
        return;
      }

      const segments = decodeSegments(url.pathname);

      if (segments === null) {
        sendJson(response, 400, {
          error: { code: "bad_request", message: "The request URL is not valid." },
        });
        return;
      }

      const allowed = new Set<string>();

      for (const route of routes) {
        const params = matchRoute(route, segments);

        if (params === null) {
          continue;
        }

        if (route.method !== method) {
          allowed.add(route.method);
          continue;
        }

        try {
          await route.handler(request, response, { params, url });
        } catch (error) {
          if (error instanceof HttpError) {
            sendJson(response, error.status, {
              error: { code: error.code, message: error.message },
            });
          } else {
            sendJson(response, 500, {
              error: {
                code: "internal_error",
                message: "An internal error occurred.",
              },
            });
          }
        }

        return;
      }

      if (allowed.size > 0) {
        response.setHeader("allow", [...allowed].sort().join(", "));
        sendJson(response, 405, {
          error: {
            code: "method_not_allowed",
            message: "The method is not allowed for this path.",
          },
        });
        return;
      }

      sendJson(response, 404, {
        error: { code: "not_found", message: "The requested path was not found." },
      });
    },
  };
}

export interface ReadJsonOptions {
  maxBytes?: number;
}

export async function readJsonBody(
  request: IncomingMessage,
  options: ReadJsonOptions = {}
): Promise<unknown> {
  const contentType = (request.headers["content-type"] ?? "").toLowerCase();

  if (!contentType.startsWith("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "The request body must be JSON.");
  }

  const maxBytes = options.maxBytes ?? 16 * 1024;
  const declaredLength = request.headers["content-length"];

  if (typeof declaredLength === "string" && /^\d+$/.test(declaredLength)) {
    const declaredBytes = Number(declaredLength);

    if (Number.isSafeInteger(declaredBytes) && declaredBytes > maxBytes) {
      request.resume();
      throw new HttpError(413, "payload_too_large", "The request body is too large.");
    }
  }

  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += bytes.length;

    if (size > maxBytes) {
      request.resume();
      throw new HttpError(413, "payload_too_large", "The request body is too large.");
    }

    chunks.push(bytes);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "bad_request", "The request body is not valid JSON.");
  }
}
