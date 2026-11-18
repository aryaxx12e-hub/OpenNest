import { describe, expect, it } from "vitest";

import { validateExtensionUiTree } from "../ui";

function nestedDepth(levels: number): unknown {
  if (levels === 1) {
    return { type: "text", text: "leaf" };
  }

  return { type: "stack", children: [nestedDepth(levels - 1)] };
}

describe("extension UI contract", () => {
  it("accepts every supported node type", () => {
    const tree = {
      type: "stack",
      children: [
        { type: "heading", text: "Summary" },
        { type: "text", text: "Hello from the extension" },
        { type: "list", items: ["One", "Two"] },
        { type: "status", tone: "success", text: "Ready" },
        { type: "button", id: "refresh", label: "Refresh", disabled: false },
      ],
    };

    expect(validateExtensionUiTree(tree)).toEqual(tree);
  });

  it("rejects raw HTML and unknown node types", () => {
    expect(() => validateExtensionUiTree({ type: "html", html: "<img>" })).toThrow(
      "ui_invalid"
    );
    expect(() =>
      validateExtensionUiTree({ type: "text", text: "safe", html: "<img>" })
    ).toThrow("ui_invalid");
  });

  it("rejects trees deeper than six levels", () => {
    expect(() => validateExtensionUiTree(nestedDepth(6))).not.toThrow();
    expect(() => validateExtensionUiTree(nestedDepth(7))).toThrow("ui_invalid");
  });

  it("rejects more than 200 nodes", () => {
    const children = Array.from({ length: 200 }, () => ({
      type: "text" as const,
      text: "row",
    }));

    expect(() => validateExtensionUiTree({ type: "stack", children })).toThrow(
      "ui_invalid"
    );
  });

  it("rejects oversized text", () => {
    expect(() =>
      validateExtensionUiTree({ type: "text", text: "x".repeat(2_001) })
    ).toThrow("ui_invalid");
  });

  it("rejects unsafe button identifiers", () => {
    expect(() =>
      validateExtensionUiTree({ type: "button", id: "not valid!", label: "Run" })
    ).toThrow("ui_invalid");
  });

  it("rejects invalid status tones and list items", () => {
    expect(() =>
      validateExtensionUiTree({ type: "status", tone: "danger", text: "Run" })
    ).toThrow("ui_invalid");
    expect(() => validateExtensionUiTree({ type: "list", items: ["ok", 42] })).toThrow(
      "ui_invalid"
    );
  });
});
