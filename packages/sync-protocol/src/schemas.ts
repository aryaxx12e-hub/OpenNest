import { isoDateSchema, workspaceIdSchema } from "@opennest/validation";
import { z } from "zod";

export const SYNC_PROTOCOL_VERSION = 1;
export const MAX_SYNC_BATCH_OPERATIONS = 100;
export const MAX_SYNC_PULL_OPERATIONS = 100;
export const MAX_SYNC_PAYLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_SYNC_FIELD_PATCHES = 64;
export const MAX_SYNC_FIELD_PATH_LENGTH = 128;
export const MAX_SYNC_CURSOR_LENGTH = 256;

const RESERVED_FIELD_PATHS = new Set(["__proto__", "prototype", "constructor"]);

const protocolVersionSchema = z.literal(SYNC_PROTOCOL_VERSION);

const uuidSchema = z.uuid({ version: "v4" }).transform((value) => value.toLowerCase());

const revisionSchema = z
  .number({ error: "Revision must be a number." })
  .int({ error: "Revision must be a whole number." })
  .min(0, { error: "Revision must not be negative." })
  .max(Number.MAX_SAFE_INTEGER, { error: "Revision is too large." });

const canonicalRevisionSchema = z
  .number({ error: "Canonical revision must be a number." })
  .int({ error: "Canonical revision must be a whole number." })
  .min(1, { error: "Canonical revision must be at least 1." })
  .max(Number.MAX_SAFE_INTEGER, { error: "Canonical revision is too large." });

const localSequenceSchema = z
  .number({ error: "Local sequence must be a number." })
  .int({ error: "Local sequence must be a whole number." })
  .min(1, { error: "Local sequence must be at least 1." })
  .max(Number.MAX_SAFE_INTEGER, { error: "Local sequence is too large." });

const limitSchema = z
  .number({ error: "Limit must be a number." })
  .int({ error: "Limit must be a whole number." })
  .min(1, { error: "Limit must be at least 1." })
  .max(MAX_SYNC_PULL_OPERATIONS, {
    error: `Limit must be at most ${MAX_SYNC_PULL_OPERATIONS}.`,
  });

const payloadHashSchema = z
  .string({ error: "Payload hash must be 64 lowercase hex characters." })
  .regex(/^[0-9a-f]{64}$/, {
    error: "Payload hash must be 64 lowercase hex characters.",
  });

const fieldPathSchema = z
  .string({ error: "Field path must be a string." })
  .min(1, { error: "Field path must not be empty." })
  .max(MAX_SYNC_FIELD_PATH_LENGTH, {
    error: `Field path must be at most ${MAX_SYNC_FIELD_PATH_LENGTH} characters long.`,
  })
  .regex(/^[A-Za-z][A-Za-z0-9_.]*$/, {
    error:
      "Field path must start with a letter and contain only letters, digits, dots, or underscores.",
  })
  .refine((value) => !RESERVED_FIELD_PATHS.has(value), {
    message: "Field path is reserved.",
  });

function assertSafeJsonValue(value: unknown, depth: number): void {
  if (depth > 64) {
    throw new TypeError("Field value is nested too deeply.");
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertSafeJsonValue(item, depth + 1);
    }
    return;
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (RESERVED_FIELD_PATHS.has(key)) {
      throw new TypeError("Field value contains a reserved key.");
    }
    assertSafeJsonValue((value as Record<string, unknown>)[key], depth + 1);
  }
}

const jsonValueSchema = z.unknown().transform((value, ctx) => {
  try {
    assertSafeJsonValue(value, 0);
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "Field value is not safe JSON.",
    });
    return z.NEVER;
  }

  const parsed = z.json().safeParse(value);

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      ctx.addIssue({
        code: "custom",
        message: issue.message,
        path: issue.path,
      });
    }
    return z.NEVER;
  }

  return parsed.data;
});

const fieldPatchesSchema = z.unknown().transform((value, ctx) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    ctx.addIssue({ code: "custom", message: "Field patches must be an object." });
    return z.NEVER;
  }

  const source = value as Record<string, unknown>;
  const keys = Object.getOwnPropertyNames(source);

  if (keys.length > MAX_SYNC_FIELD_PATCHES) {
    ctx.addIssue({
      code: "custom",
      message: `An operation may contain at most ${MAX_SYNC_FIELD_PATCHES} field patches.`,
    });
  }

  const result: Record<string, unknown> = {};

  for (const key of keys) {
    const parsedKey = fieldPathSchema.safeParse(key);

    if (!parsedKey.success) {
      for (const issue of parsedKey.error.issues) {
        ctx.addIssue({ ...issue, path: [key] });
      }
      continue;
    }

    const parsedValue = jsonValueSchema.safeParse(source[key]);

    if (!parsedValue.success) {
      for (const issue of parsedValue.error.issues) {
        ctx.addIssue({ ...issue, path: [key] });
      }
      continue;
    }

    result[key] = parsedValue.data;
  }

  return result;
});

const entityTypeSchema = z.enum(["workspace", "folder", "file", "note", "tag"], {
  error: "Unknown entity type.",
});

const operationTypeSchema = z.enum(["create", "update", "delete", "restore"], {
  error: "Unknown operation type.",
});

export const syncOperationSchema = z.strictObject({
  opId: uuidSchema,
  entityType: entityTypeSchema,
  entityId: uuidSchema,
  operation: operationTypeSchema,
  baseEntityRevision: revisionSchema,
  baseWorkspaceRevision: revisionSchema,
  fieldPatches: fieldPatchesSchema,
  payloadHash: payloadHashSchema,
  deviceId: uuidSchema,
  localSequence: localSequenceSchema,
  createdAt: isoDateSchema,
});

export const syncCursorSchema = z
  .string({ error: "Cursor must be a string." })
  .min(1, { error: "Cursor must not be empty." })
  .max(MAX_SYNC_CURSOR_LENGTH, {
    error: `Cursor must be at most ${MAX_SYNC_CURSOR_LENGTH} characters long.`,
  })
  .regex(/^[A-Za-z0-9_-]+$/, { error: "Cursor is not valid." })
  .brand<"SyncCursor">();

function canonicalizeValue(value: unknown, depth: number): unknown {
  if (depth > 64) {
    throw new TypeError("Sync payload is nested too deeply.");
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Sync payload contains a non-finite number.");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const target: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      target[key] = canonicalizeValue(source[key], depth + 1);
    }
    return target;
  }
  throw new TypeError("Sync payload contains a non-JSON value.");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalizeValue(value, 0));
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export const pushRequestSchema = z
  .strictObject({
    protocolVersion: protocolVersionSchema,
    workspaceId: workspaceIdSchema,
    operations: z
      .array(syncOperationSchema)
      .min(1, { error: "A push batch must contain at least one operation." })
      .max(MAX_SYNC_BATCH_OPERATIONS, {
        error: `A push batch may contain at most ${MAX_SYNC_BATCH_OPERATIONS} operations.`,
      }),
  })
  .superRefine((value, ctx) => {
    let bytes: number;
    try {
      bytes = utf8ByteLength(serializePushRequest(value));
    } catch {
      ctx.addIssue({ code: "custom", message: "Push request is not serializable." });
      return;
    }
    if (bytes > MAX_SYNC_PAYLOAD_BYTES) {
      ctx.addIssue({
        code: "custom",
        message: `A push request may be at most ${MAX_SYNC_PAYLOAD_BYTES} bytes.`,
      });
    }
  });

export const pullRequestSchema = z.strictObject({
  protocolVersion: protocolVersionSchema,
  workspaceId: workspaceIdSchema,
  cursor: syncCursorSchema.nullable(),
  limit: limitSchema,
});

export const syncAppliedOperationSchema = syncOperationSchema.extend({
  canonicalRevision: canonicalRevisionSchema,
});

export const syncConflictSchema = z.strictObject({
  conflictId: uuidSchema,
  entityType: entityTypeSchema,
  entityId: uuidSchema,
  fieldPath: fieldPathSchema,
  localOpId: uuidSchema,
  remoteOpId: uuidSchema,
  localFieldRevision: revisionSchema.min(1),
  remoteFieldRevision: revisionSchema.min(1),
  localValue: z.json(),
  remoteValue: z.json(),
  localDeviceId: uuidSchema,
  remoteDeviceId: uuidSchema,
  createdAt: isoDateSchema,
});

export const syncRejectionCodeSchema = z.enum(
  [
    "invalid_operation",
    "invalid_payload_hash",
    "payload_too_large",
    "tombstoned_entity",
    "stale_base_revision",
    "workspace_mismatch",
    "forbidden",
    "conflict",
    "invalid_sync_state",
  ],
  { error: "Unknown sync rejection code." }
);

export const pushAppliedResultSchema = z.strictObject({
  opId: uuidSchema,
  canonicalRevision: canonicalRevisionSchema,
  entityRevision: revisionSchema.min(1),
  fieldRevisions: z.record(fieldPathSchema, revisionSchema.min(1)),
  replayed: z.boolean(),
  appliedAt: isoDateSchema,
});

export const pushResponseSchema = z
  .strictObject({
    protocolVersion: protocolVersionSchema,
    workspaceId: workspaceIdSchema,
    applied: z.array(pushAppliedResultSchema).max(MAX_SYNC_BATCH_OPERATIONS),
    conflicts: z.array(syncConflictSchema).max(MAX_SYNC_BATCH_OPERATIONS * 4),
    rejected: z.array(
      z.strictObject({
        opId: uuidSchema,
        code: syncRejectionCodeSchema,
        message: z.string().min(1).max(500),
      })
    ),
  })
  .superRefine((value, ctx) => {
    let bytes: number;
    try {
      bytes = utf8ByteLength(canonicalJson(value));
    } catch {
      ctx.addIssue({ code: "custom", message: "Push response is not serializable." });
      return;
    }
    if (bytes > MAX_SYNC_PAYLOAD_BYTES) {
      ctx.addIssue({
        code: "custom",
        message: `A push response may be at most ${MAX_SYNC_PAYLOAD_BYTES} bytes.`,
      });
    }
  });

export const pullResponseSchema = z
  .strictObject({
    protocolVersion: protocolVersionSchema,
    workspaceId: workspaceIdSchema,
    operations: z.array(syncAppliedOperationSchema).max(MAX_SYNC_PULL_OPERATIONS),
    nextCursor: syncCursorSchema.nullable(),
  })
  .superRefine((value, ctx) => {
    let bytes: number;
    try {
      bytes = utf8ByteLength(canonicalJson(value));
    } catch {
      ctx.addIssue({ code: "custom", message: "Pull response is not serializable." });
      return;
    }
    if (bytes > MAX_SYNC_PAYLOAD_BYTES) {
      ctx.addIssue({
        code: "custom",
        message: `A pull response may be at most ${MAX_SYNC_PAYLOAD_BYTES} bytes.`,
      });
    }
  });

export function serializePushRequest(value: z.output<typeof pushRequestSchema>): string {
  return canonicalJson(value);
}

export function serializePullRequest(value: z.output<typeof pullRequestSchema>): string {
  return canonicalJson(value);
}
