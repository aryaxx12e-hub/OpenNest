import { describe, expect, it } from "vitest";

import { CAPABILITY_CATALOG, isCapability, parseCapability } from "../capabilities";

describe("capability catalog", () => {
  it("contains every workspace capability from ADR 0009", () => {
    const capabilities = CAPABILITY_CATALOG.map((entry) => entry.capability);

    expect(capabilities).toEqual(
      expect.arrayContaining([
        "workspace.read.metadata",
        "workspace.read.content",
        "workspace.write",
        "workspace.export",
        "workspace.delete",
        "sync.push",
        "sync.pull",
      ])
    );
  });

  it("parses exact workspace capabilities", () => {
    expect(parseCapability("workspace.read.content")).toEqual({
      family: "workspace",
      capability: "workspace.read.content",
    });
    expect(isCapability("workspace.write")).toBe(true);
  });

  it("parses qualified external capabilities without accepting wildcards", () => {
    expect(parseCapability("network.connect:https://example.com")).toEqual({
      family: "network",
      capability: "network.connect:https://example.com",
      qualifier: "https://example.com",
    });
    expect(parseCapability("credential.use:openai")).toEqual({
      family: "credential",
      capability: "credential.use:openai",
      qualifier: "openai",
    });
    expect(() => parseCapability("network.connect:")).toThrow();
    expect(() => parseCapability("ai.invoke:*")).toThrow();
  });

  it("rejects unknown capabilities", () => {
    expect(isCapability("workspace.read.everything")).toBe(false);
    expect(() => parseCapability("workspace.read.everything")).toThrow();
  });
});
