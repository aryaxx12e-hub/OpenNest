import { randomUUID } from "node:crypto";

import type { IsoDate } from "@opennest/core";
import {
  SYNC_PROTOCOL_VERSION,
  type PullRequest,
  type PushRequest,
} from "@opennest/sync-protocol";
import { describe, expect, it, vi } from "vitest";

import { createHttpSyncRequest, SyncRequestError } from "../request";

const NOW = "2026-11-19T12:00:00.000Z" as IsoDate;
const WORKSPACE_ID = randomUUID();

function pushRequest(): PushRequest {
  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    workspaceId: WORKSPACE_ID as PushRequest["workspaceId"],
    operations: [
      {
        opId: randomUUID() as PushRequest["operations"][number]["opId"],
        entityType: "note",
        entityId: randomUUID() as PushRequest["operations"][number]["entityId"],
        operation: "update",
        baseEntityRevision: 1,
        baseWorkspaceRevision: 0,
        fieldPatches: { title: "Local" },
        payloadHash: "a".repeat(64),
        deviceId: randomUUID() as PushRequest["operations"][number]["deviceId"],
        localSequence: 1,
        createdAt: NOW as PushRequest["operations"][number]["createdAt"],
      },
    ],
  };
}

function pushResponse(): unknown {
  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    workspaceId: WORKSPACE_ID,
    applied: [],
    conflicts: [],
    rejected: [],
  };
}

function pullRequest(): PullRequest {
  return {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    workspaceId: WORKSPACE_ID as PullRequest["workspaceId"],
    cursor: null,
    limit: 100,
  };
}

describe("createHttpSyncRequest", () => {
  it("sends the CSRF header and parses a push response", async () => {
    const fetchImpl = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => Response.json(pushResponse()));
    const request = createHttpSyncRequest({
      baseUrl: "https://example.test",
      fetchImpl: fetchImpl as typeof fetch,
      getCsrfToken: () => "csrf-token",
    });

    await expect(request.push(pushRequest())).resolves.toMatchObject({
      protocolVersion: SYNC_PROTOCOL_VERSION,
      workspaceId: WORKSPACE_ID,
      rejected: [],
    });

    const call = fetchImpl.mock.calls[0];
    expect(call?.[0]).toBe("https://example.test/api/sync/push");
    expect(call?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": "csrf-token",
      },
    });
  });

  it("maps server errors to retryable and terminal request errors", async () => {
    const terminalFetch = vi.fn(async (): Promise<Response> =>
      Response.json(
        { error: { code: "forbidden", message: "No access" } },
        { status: 403 }
      )
    );
    const terminalRequest = createHttpSyncRequest({
      fetchImpl: terminalFetch as typeof fetch,
    });

    await expect(terminalRequest.pull(pullRequest())).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
      retryable: false,
    });

    const retryableFetch = vi.fn(async (): Promise<Response> =>
      Response.json(
        { error: { code: "unavailable", message: "Try later" } },
        { status: 503 }
      )
    );
    const retryableRequest = createHttpSyncRequest({
      fetchImpl: retryableFetch as typeof fetch,
    });

    await expect(retryableRequest.pull(pullRequest())).rejects.toMatchObject({
      status: 503,
      code: "unavailable",
      retryable: true,
    });
  });

  it("treats network and malformed responses safely", async () => {
    const networkRequest = createHttpSyncRequest({
      fetchImpl: vi.fn(async () => {
        throw new TypeError("offline");
      }) as typeof fetch,
    });

    await expect(networkRequest.pull(pullRequest())).rejects.toMatchObject({
      code: "network_error",
      retryable: true,
    });

    const malformedRequest = createHttpSyncRequest({
      fetchImpl: vi.fn(async () => Response.json({ protocolVersion: 1 })) as typeof fetch,
    });

    await expect(malformedRequest.pull(pullRequest())).rejects.toBeInstanceOf(
      SyncRequestError
    );
    await expect(malformedRequest.pull(pullRequest())).rejects.toMatchObject({
      code: "invalid_response",
      retryable: false,
    });
  });
});
