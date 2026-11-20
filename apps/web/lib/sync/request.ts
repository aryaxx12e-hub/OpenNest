import {
  pullResponseSchema,
  pushResponseSchema,
  type PullRequest,
  type PullResponse,
  type PushRequest,
  type PushResponse,
} from "@opennest/sync-protocol";

const CSRF_COOKIE_NAME = "opennest_csrf";
const CSRF_HEADER_NAME = "x-csrf-token";

export class SyncRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(status: number, code: string, retryable: boolean) {
    super(`Sync request failed: ${code}`);
    this.name = "SyncRequestError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export interface SyncRequest {
  push(request: PushRequest): Promise<PushResponse>;
  pull(request: PullRequest): Promise<PullResponse>;
}

export interface HttpSyncRequestOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  getCsrfToken?: () => string | null;
}

interface ErrorBody {
  error?: {
    code?: unknown;
  };
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }

  for (const part of document.cookie.split(";")) {
    const separator = part.indexOf("=");

    if (separator === -1) {
      continue;
    }

    if (part.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return null;
      }
    }
  }

  return null;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function errorCode(body: unknown, status: number): string {
  if (typeof body === "object" && body !== null) {
    const error = (body as ErrorBody).error;

    if (typeof error?.code === "string" && error.code.length > 0) {
      return error.code;
    }
  }

  return `http_${status}`;
}

export function createHttpSyncRequest(options: HttpSyncRequestOptions = {}): SyncRequest {
  const baseUrl = options.baseUrl ?? "";
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const getCsrfToken = options.getCsrfToken ?? (() => readCookie(CSRF_COOKIE_NAME));

  async function post(path: string, body: unknown): Promise<unknown> {
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
    };
    const csrfToken = getCsrfToken();

    if (csrfToken !== null && csrfToken.length > 0) {
      headers[CSRF_HEADER_NAME] = csrfToken;
    }

    let response: Response;

    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify(body),
      });
    } catch {
      throw new SyncRequestError(0, "network_error", true);
    }

    if (!response.ok) {
      let errorBody: unknown = null;

      try {
        errorBody = await response.json();
      } catch {
        errorBody = null;
      }

      throw new SyncRequestError(
        response.status,
        errorCode(errorBody, response.status),
        isRetryableStatus(response.status)
      );
    }

    try {
      return await response.json();
    } catch {
      throw new SyncRequestError(response.status, "invalid_response", false);
    }
  }

  return {
    async push(request) {
      const body = await post("/api/sync/push", request);
      const parsed = pushResponseSchema.safeParse(body);

      if (!parsed.success) {
        throw new SyncRequestError(502, "invalid_response", false);
      }

      return parsed.data;
    },

    async pull(request) {
      const body = await post("/api/sync/pull", request);
      const parsed = pullResponseSchema.safeParse(body);

      if (!parsed.success) {
        throw new SyncRequestError(502, "invalid_response", false);
      }

      return parsed.data;
    },
  };
}
