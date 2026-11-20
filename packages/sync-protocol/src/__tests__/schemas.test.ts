import { describe, expect, it } from "vitest";

import {
  MAX_SYNC_BATCH_OPERATIONS,
  MAX_SYNC_PAYLOAD_BYTES,
  pullRequestSchema,
  pullResponseSchema,
  pushRequestSchema,
  pushResponseSchema,
  serializePullRequest,
  serializePushRequest,
} from "../schemas";
import type { PushRequest } from "../types";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const ENTITY = "22222222-2222-4222-8222-222222222222";
const DEVICE = "33333333-3333-4333-8333-333333333333";
const OP = "44444444-4444-4444-8444-444444444444";
const CONFLICT = "55555555-5555-4555-8555-555555555555";
const HASH = "a".repeat(64);
const CURSOR = "djE6NDI";
const NOW = "2026-11-19T10:00:00.000Z";

function operation(overrides: Record<string, unknown> = {}) {
  return {
    opId: OP,
    entityType: "note",
    entityId: ENTITY,
    operation: "update",
    baseEntityRevision: 3,
    baseWorkspaceRevision: 7,
    fieldPatches: { title: "Rencana" },
    payloadHash: HASH,
    deviceId: DEVICE,
    localSequence: 2,
    createdAt: NOW,
    ...overrides,
  };
}

function pushRequest(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 1,
    workspaceId: WORKSPACE,
    operations: [operation()],
    ...overrides,
  };
}

function appliedOperation() {
  return {
    ...operation(),
    canonicalRevision: 12,
  };
}

const conflict = {
  conflictId: CONFLICT,
  entityType: "note",
  entityId: ENTITY,
  fieldPath: "content",
  localOpId: OP,
  remoteOpId: "66666666-6666-4666-8666-666666666666",
  localFieldRevision: 4,
  remoteFieldRevision: 5,
  localValue: "local",
  remoteValue: "remote",
  localDeviceId: DEVICE,
  remoteDeviceId: "77777777-7777-4777-8777-777777777777",
  createdAt: NOW,
};

describe("pushRequestSchema", () => {
  it("accepts a valid push request", () => {
    const parsed = pushRequestSchema.parse(pushRequest());
    const typed: PushRequest = parsed;

    expect(typed.workspaceId).toBe(WORKSPACE);
    expect(typed.operations).toHaveLength(1);
    expect(typed.operations[0]?.fieldPatches).toEqual({ title: "Rencana" });
  });

  it("accepts exactly the maximum batch size", () => {
    const operations = Array.from({ length: MAX_SYNC_BATCH_OPERATIONS }, () =>
      operation()
    );

    expect(pushRequestSchema.safeParse(pushRequest({ operations })).success).toBe(true);
  });

  it("rejects an empty batch", () => {
    expect(pushRequestSchema.safeParse(pushRequest({ operations: [] })).success).toBe(
      false
    );
  });

  it("rejects a batch over the operation limit", () => {
    const operations = Array.from({ length: MAX_SYNC_BATCH_OPERATIONS + 1 }, () =>
      operation()
    );

    expect(pushRequestSchema.safeParse(pushRequest({ operations })).success).toBe(false);
  });

  it("rejects an unknown entity type", () => {
    expect(
      pushRequestSchema.safeParse(
        pushRequest({ operations: [operation({ entityType: "database" })] })
      ).success
    ).toBe(false);
  });

  it("rejects an unknown operation type", () => {
    expect(
      pushRequestSchema.safeParse(
        pushRequest({ operations: [operation({ operation: "overwrite" })] })
      ).success
    ).toBe(false);
  });

  it("rejects a missing protocol version", () => {
    expect(
      pushRequestSchema.safeParse({ workspaceId: WORKSPACE, operations: [operation()] })
        .success
    ).toBe(false);
  });

  it("rejects oversized payloads", () => {
    const oversized = "x".repeat(MAX_SYNC_PAYLOAD_BYTES + 1);

    expect(
      pushRequestSchema.safeParse(
        pushRequest({
          operations: [operation({ fieldPatches: { content: oversized } })],
        })
      ).success
    ).toBe(false);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects malformed base entity revision %s",
    (value) => {
      expect(
        pushRequestSchema.safeParse(
          pushRequest({ operations: [operation({ baseEntityRevision: value })] })
        ).success
      ).toBe(false);
    }
  );

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects malformed base workspace revision %s",
    (value) => {
      expect(
        pushRequestSchema.safeParse(
          pushRequest({ operations: [operation({ baseWorkspaceRevision: value })] })
        ).success
      ).toBe(false);
    }
  );

  it.each([0, -1, 1.5])("rejects malformed local sequence %s", (value) => {
    expect(
      pushRequestSchema.safeParse(
        pushRequest({ operations: [operation({ localSequence: value })] })
      ).success
    ).toBe(false);
  });

  it.each([
    "2026-11-19",
    "2026-11-19T10:00:00+07:00",
    "2026-11-19T10:00:00z",
    "not-a-date",
  ])("rejects malformed timestamp %j", (value) => {
    expect(
      pushRequestSchema.safeParse(
        pushRequest({ operations: [operation({ createdAt: value })] })
      ).success
    ).toBe(false);
  });

  it.each(["not-a-uuid", "", "11111111-1111-1111-8111-111111111111"])(
    "rejects malformed op id %j",
    (value) => {
      expect(
        pushRequestSchema.safeParse(
          pushRequest({ operations: [operation({ opId: value })] })
        ).success
      ).toBe(false);
    }
  );

  it.each([HASH.toUpperCase(), "a".repeat(63), "g".repeat(64)])(
    "rejects malformed payload hash %j",
    (value) => {
      expect(
        pushRequestSchema.safeParse(
          pushRequest({ operations: [operation({ payloadHash: value })] })
        ).success
      ).toBe(false);
    }
  );

  it.each(["", "1title", "__proto__", "constructor", "a/b", "a".repeat(129)])(
    "rejects unsafe field path %j",
    (value) => {
      expect(
        pushRequestSchema.safeParse(
          pushRequest({
            operations: [
              operation({
                fieldPatches: JSON.parse(`{"${value}":1}`) as Record<string, unknown>,
              }),
            ],
          })
        ).success
      ).toBe(false);
    }
  );

  it("rejects reserved keys nested inside a field value", () => {
    const value = JSON.parse('{"nested":{"__proto__":1}}') as Record<string, unknown>;

    expect(
      pushRequestSchema.safeParse(
        pushRequest({ operations: [operation({ fieldPatches: { content: value } })] })
      ).success
    ).toBe(false);
  });

  it("rejects too many field patches", () => {
    const fieldPatches = Object.fromEntries(
      Array.from({ length: 65 }, (_, index) => [`field${index}`, index])
    );

    expect(
      pushRequestSchema.safeParse(
        pushRequest({ operations: [operation({ fieldPatches })] })
      ).success
    ).toBe(false);
  });

  it("rejects unknown keys", () => {
    expect(pushRequestSchema.safeParse({ ...pushRequest(), extra: true }).success).toBe(
      false
    );
  });
});

describe("pullRequestSchema", () => {
  it("accepts a first pull with a null cursor", () => {
    expect(
      pullRequestSchema.parse({
        protocolVersion: 1,
        workspaceId: WORKSPACE,
        cursor: null,
        limit: 50,
      })
    ).toMatchObject({ cursor: null, limit: 50 });
  });

  it("accepts an opaque cursor", () => {
    expect(
      pullRequestSchema.safeParse({
        protocolVersion: 1,
        workspaceId: WORKSPACE,
        cursor: CURSOR,
        limit: 1,
      }).success
    ).toBe(true);
  });

  it.each(["", "not a cursor!", "cursor+with/slash", "a".repeat(257)])(
    "rejects malformed cursor %j",
    (value) => {
      expect(
        pullRequestSchema.safeParse({
          protocolVersion: 1,
          workspaceId: WORKSPACE,
          cursor: value,
          limit: 50,
        }).success
      ).toBe(false);
    }
  );

  it.each([0, -1, 1.5, MAX_SYNC_BATCH_OPERATIONS + 1])(
    "rejects malformed limit %s",
    (value) => {
      expect(
        pullRequestSchema.safeParse({
          protocolVersion: 1,
          workspaceId: WORKSPACE,
          cursor: null,
          limit: value,
        }).success
      ).toBe(false);
    }
  );
});

describe("response schemas", () => {
  it("accepts applied operations, conflicts, and rejections", () => {
    const parsed = pushResponseSchema.parse({
      protocolVersion: 1,
      workspaceId: WORKSPACE,
      applied: [
        {
          opId: OP,
          canonicalRevision: 12,
          entityRevision: 4,
          fieldRevisions: { title: 4 },
          replayed: false,
          appliedAt: NOW,
        },
      ],
      conflicts: [conflict],
      rejected: [
        {
          opId: OP,
          code: "tombstoned_entity",
          message: "The entity was deleted.",
        },
      ],
    });

    expect(parsed.conflicts[0]?.localValue).toBe("local");
    expect(parsed.conflicts[0]?.remoteValue).toBe("remote");
    expect(parsed.applied[0]?.canonicalRevision).toBe(12);
  });

  it("accepts a pull page with a next cursor", () => {
    expect(
      pullResponseSchema.parse({
        protocolVersion: 1,
        workspaceId: WORKSPACE,
        operations: [appliedOperation()],
        nextCursor: CURSOR,
      })
    ).toMatchObject({ nextCursor: CURSOR });
  });

  it("accepts a final pull page with a null cursor", () => {
    expect(
      pullResponseSchema.parse({
        protocolVersion: 1,
        workspaceId: WORKSPACE,
        operations: [],
        nextCursor: null,
      }).nextCursor
    ).toBeNull();
  });

  it("rejects an unknown rejection code", () => {
    expect(
      pushResponseSchema.safeParse({
        protocolVersion: 1,
        workspaceId: WORKSPACE,
        applied: [],
        conflicts: [],
        rejected: [{ opId: OP, code: "made_up", message: "No." }],
      }).success
    ).toBe(false);
  });

  it("rejects a malformed applied canonical revision", () => {
    expect(
      pushResponseSchema.safeParse({
        protocolVersion: 1,
        workspaceId: WORKSPACE,
        applied: [
          {
            opId: OP,
            canonicalRevision: 0,
            entityRevision: 4,
            fieldRevisions: { title: 4 },
            replayed: false,
            appliedAt: NOW,
          },
        ],
        conflicts: [],
        rejected: [],
      }).success
    ).toBe(false);
  });
});

describe("deterministic serialization", () => {
  it("serializes request object keys in a stable order", () => {
    const first = {
      protocolVersion: 1,
      workspaceId: WORKSPACE,
      operations: [operation({ fieldPatches: { title: "Rencana", content: "Isi" } })],
    };
    const second = {
      operations: [
        {
          createdAt: NOW,
          localSequence: 2,
          deviceId: DEVICE,
          payloadHash: HASH,
          fieldPatches: { content: "Isi", title: "Rencana" },
          baseWorkspaceRevision: 7,
          baseEntityRevision: 3,
          operation: "update",
          entityId: ENTITY,
          entityType: "note",
          opId: OP,
        },
      ],
      workspaceId: WORKSPACE,
      protocolVersion: 1,
    };

    expect(serializePushRequest(pushRequestSchema.parse(first))).toBe(
      serializePushRequest(pushRequestSchema.parse(second))
    );
  });

  it("preserves operation array order", () => {
    const first = pushRequestSchema.parse(pushRequest());
    const second = pushRequestSchema.parse(
      pushRequest({
        operations: [
          operation(),
          operation({ opId: "66666666-6666-4666-8666-666666666666" }),
        ],
      })
    );

    expect(serializePushRequest(first)).not.toBe(serializePushRequest(second));
  });

  it("serializes pull requests deterministically", () => {
    const first = pullRequestSchema.parse({
      protocolVersion: 1,
      workspaceId: WORKSPACE,
      cursor: CURSOR,
      limit: 50,
    });
    const second = pullRequestSchema.parse({
      limit: 50,
      cursor: CURSOR,
      workspaceId: WORKSPACE,
      protocolVersion: 1,
    });

    expect(serializePullRequest(first)).toBe(serializePullRequest(second));
  });
});
