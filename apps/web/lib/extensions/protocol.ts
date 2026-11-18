import {
  EXTENSION_ERROR_CODES,
  EXTENSION_HOST_METHODS,
  extensionUiNodeSchema,
} from "@opennest/extensions";
import { z } from "zod";

export const EXTENSION_MAX_MESSAGE_BYTES = 64 * 1024;

const requestIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const errorCodeSchema = z.enum(EXTENSION_ERROR_CODES);
const actionIdSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
const originSchema = z.string().refine((value) => {
  try {
    const url = new URL(value);

    return (
      (url.protocol === "https:" || url.protocol === "http:") && url.origin === value
    );
  } catch {
    return false;
  }
}, "Expected a bare HTTP origin.");

const workerReadySchema = z.strictObject({
  type: z.literal("worker:ready"),
});

const workerHeartbeatSchema = z.strictObject({
  type: z.literal("worker:heartbeat"),
});

const workerRequestSchema = z.strictObject({
  type: z.literal("worker:request"),
  id: requestIdSchema,
  method: z.enum(EXTENSION_HOST_METHODS),
  params: z.record(z.string(), z.unknown()),
});

const workerUiSchema = z.strictObject({
  type: z.literal("worker:ui"),
  tree: extensionUiNodeSchema,
});

const workerErrorSchema = z.strictObject({
  type: z.literal("worker:error"),
  code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  message: z.string().min(1).max(2_000),
});

export const workerToHostSchema = z.discriminatedUnion("type", [
  workerReadySchema,
  workerHeartbeatSchema,
  workerRequestSchema,
  workerUiSchema,
  workerErrorSchema,
]);

const hostResponseSuccessSchema = z.strictObject({
  type: z.literal("worker:response"),
  id: requestIdSchema,
  ok: z.literal(true),
  result: z.unknown(),
});

const hostResponseFailureSchema = z.strictObject({
  type: z.literal("worker:response"),
  id: requestIdSchema,
  ok: z.literal(false),
  error: z.strictObject({
    code: errorCodeSchema,
    message: z.string().min(1).max(2_000),
  }),
});

const hostActionSchema = z.strictObject({
  type: z.literal("host:action"),
  actionId: actionIdSchema,
});

const hostStartSchema = z.strictObject({
  type: z.literal("host:start"),
  code: z.string().min(1).max(131_072),
});

const hostTerminateSchema = z.strictObject({
  type: z.literal("host:terminate"),
});

export const hostToWorkerSchema = z.union([
  hostResponseSuccessSchema,
  hostResponseFailureSchema,
  hostActionSchema,
  hostStartSchema,
  hostTerminateSchema,
]);

export const shellReadySchema = z.strictObject({
  type: z.literal("shell:ready"),
});

export const sandboxInitSchema = z.strictObject({
  type: z.literal("opennest:init"),
  hostOrigin: originSchema,
});

const encoder = new TextEncoder();

export function extensionMessageBytes(value: unknown): number | null {
  try {
    const json = JSON.stringify(value);

    return json === undefined ? null : encoder.encode(json).byteLength;
  } catch {
    return null;
  }
}

export function isExtensionMessageWithinLimit(value: unknown): boolean {
  const bytes = extensionMessageBytes(value);

  return bytes !== null && bytes <= EXTENSION_MAX_MESSAGE_BYTES;
}
