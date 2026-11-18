import { describe, expect, it } from "vitest";

import {
  EXTENSION_MAX_MESSAGE_BYTES,
  hostToWorkerSchema,
  isExtensionMessageWithinLimit,
  sandboxInitSchema,
  shellReadySchema,
  workerToHostSchema,
} from "../protocol";

const TREE = {
  type: "stack" as const,
  children: [
    { type: "heading" as const, text: "Summary" },
    { type: "text" as const, text: "Three notes" },
  ],
};

describe("worker to host protocol", () => {
  it("accepts readiness, requests, and valid UI trees", () => {
    expect(workerToHostSchema.safeParse({ type: "worker:ready" }).success).toBe(true);
    expect(workerToHostSchema.safeParse({ type: "worker:heartbeat" }).success).toBe(true);
    expect(
      workerToHostSchema.safeParse({
        type: "worker:request",
        id: "1",
        method: "workspace.summary",
        params: {},
      }).success
    ).toBe(true);
    expect(workerToHostSchema.safeParse({ type: "worker:ui", tree: TREE }).success).toBe(
      true
    );
  });

  it("rejects extra properties, unknown methods, and unsafe UI nodes", () => {
    expect(
      workerToHostSchema.safeParse({
        type: "worker:request",
        id: "1",
        method: "x",
        params: {},
        extra: true,
      }).success
    ).toBe(false);
    expect(
      workerToHostSchema.safeParse({
        type: "worker:request",
        id: "1",
        method: "workspace.delete",
        params: {},
      }).success
    ).toBe(false);
    expect(
      workerToHostSchema.safeParse({ type: "worker:ui", tree: { type: "html" } }).success
    ).toBe(false);
  });

  it("accepts worker failures", () => {
    expect(
      workerToHostSchema.safeParse({
        type: "worker:error",
        code: "worker_error",
        message: "Extension failed",
      }).success
    ).toBe(true);
  });
});

describe("host to worker protocol", () => {
  it("accepts start, terminate, action, and responses", () => {
    expect(
      hostToWorkerSchema.safeParse({
        type: "host:start",
        code: "self.onmessage = () => {}",
      }).success
    ).toBe(true);
    expect(hostToWorkerSchema.safeParse({ type: "host:terminate" }).success).toBe(true);
    expect(
      hostToWorkerSchema.safeParse({ type: "host:action", actionId: "refresh" }).success
    ).toBe(true);
    expect(
      hostToWorkerSchema.safeParse({
        type: "worker:response",
        id: "1",
        ok: true,
        result: { notes: 1 },
      }).success
    ).toBe(true);
    expect(
      hostToWorkerSchema.safeParse({
        type: "worker:response",
        id: "1",
        ok: false,
        error: { code: "timeout", message: "Request timed out" },
      }).success
    ).toBe(true);
  });

  it("rejects malformed host messages", () => {
    expect(hostToWorkerSchema.safeParse({ type: "host:start", code: 1 }).success).toBe(
      false
    );
    expect(
      hostToWorkerSchema.safeParse({ type: "host:action", actionId: "" }).success
    ).toBe(false);
    expect(
      hostToWorkerSchema.safeParse({
        type: "worker:response",
        id: "1",
        ok: false,
        error: { code: "unknown_code", message: "No" },
      }).success
    ).toBe(false);
  });
});

describe("sandbox window protocol", () => {
  it("accepts only the ready and init messages", () => {
    expect(shellReadySchema.safeParse({ type: "shell:ready" }).success).toBe(true);
    expect(
      sandboxInitSchema.safeParse({
        type: "opennest:init",
        hostOrigin: "https://app.test",
      }).success
    ).toBe(true);
    expect(
      sandboxInitSchema.safeParse({
        type: "opennest:init",
        hostOrigin: "https://app.test",
        port: null,
      }).success
    ).toBe(false);
  });
});

describe("message size limit", () => {
  it("measures UTF-8 JSON and rejects oversized messages", () => {
    expect(EXTENSION_MAX_MESSAGE_BYTES).toBe(65_536);
    expect(isExtensionMessageWithinLimit({ type: "worker:ready" })).toBe(true);
    expect(
      isExtensionMessageWithinLimit({
        type: "worker:ui",
        tree: { type: "text", text: "x".repeat(EXTENSION_MAX_MESSAGE_BYTES) },
      })
    ).toBe(false);
    expect(isExtensionMessageWithinLimit(undefined)).toBe(false);
  });
});
