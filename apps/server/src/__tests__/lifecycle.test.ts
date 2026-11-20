// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createLifecycle } from "../lifecycle";

describe("server lifecycle", () => {
  it("closes HTTP, auth, then workspace", async () => {
    const order: string[] = [];
    const lifecycle = createLifecycle({
      http: {
        close: async () => {
          order.push("http");
        },
      },
      auth: {
        close: () => {
          order.push("auth");
        },
      },
      workspace: {
        close: async () => {
          order.push("workspace");
        },
      },
    });

    await lifecycle.close();

    expect(order).toEqual(["http", "auth", "workspace"]);
  });

  it("closes sync before auth and workspace", async () => {
    const order: string[] = [];
    const lifecycle = createLifecycle({
      http: {
        close: () => {
          order.push("http");
        },
      },
      sync: {
        close: () => {
          order.push("sync");
        },
      },
      auth: {
        close: () => {
          order.push("auth");
        },
      },
      workspace: {
        close: () => {
          order.push("workspace");
        },
      },
    });

    await lifecycle.close();

    expect(order).toEqual(["http", "sync", "auth", "workspace"]);
  });

  it("closes sync and files before auth and workspace", async () => {
    const order: string[] = [];
    const lifecycle = createLifecycle({
      http: {
        close: () => {
          order.push("http");
        },
      },
      sync: {
        close: () => {
          order.push("sync");
        },
      },
      files: {
        close: () => {
          order.push("files");
        },
      },
      auth: {
        close: () => {
          order.push("auth");
        },
      },
      workspace: {
        close: () => {
          order.push("workspace");
        },
      },
    });

    await lifecycle.close();

    expect(order).toEqual(["http", "sync", "files", "auth", "workspace"]);
  });

  it("closes collaboration before the HTTP server and databases", async () => {
    const order: string[] = [];
    const lifecycle = createLifecycle({
      collaboration: {
        close: async () => {
          order.push("collaboration");
        },
      },
      http: {
        close: () => {
          order.push("http");
        },
      },
      sync: {
        close: () => {
          order.push("sync");
        },
      },
      files: {
        close: () => {
          order.push("files");
        },
      },
      auth: {
        close: () => {
          order.push("auth");
        },
      },
      workspace: {
        close: () => {
          order.push("workspace");
        },
      },
    });

    await lifecycle.close();

    expect(order).toEqual([
      "collaboration",
      "http",
      "sync",
      "files",
      "auth",
      "workspace",
    ]);
  });

  it("is idempotent", async () => {
    let closes = 0;
    const lifecycle = createLifecycle({
      http: { close: () => undefined },
      auth: { close: () => undefined },
      workspace: {
        close: () => {
          closes += 1;
        },
      },
    });

    await Promise.all([lifecycle.close(), lifecycle.close()]);
    await lifecycle.close();

    expect(closes).toBe(1);
  });

  it("closes every resource before surfacing the first failure", async () => {
    const order: string[] = [];
    const first = new Error("http failed");
    const second = new Error("workspace failed");
    const lifecycle = createLifecycle({
      http: {
        close: () => {
          order.push("http");
          throw first;
        },
      },
      auth: {
        close: () => {
          order.push("auth");
          throw second;
        },
      },
      workspace: {
        close: () => {
          order.push("workspace");
        },
      },
    });

    await expect(lifecycle.close()).rejects.toBe(first);
    expect(order).toEqual(["http", "auth", "workspace"]);
  });
});
