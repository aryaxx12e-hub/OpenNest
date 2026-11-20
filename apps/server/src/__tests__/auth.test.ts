// @vitest-environment node

import { describe, expect, it } from "vitest";

import { roleAllows } from "../http/auth";

describe("role checks", () => {
  it("allows owners and editors to write", () => {
    expect(roleAllows("owner", "write")).toBe(true);
    expect(roleAllows("editor", "write")).toBe(true);
    expect(roleAllows("viewer", "write")).toBe(false);
  });

  it("allows every role to read", () => {
    expect(roleAllows("owner", "read")).toBe(true);
    expect(roleAllows("editor", "read")).toBe(true);
    expect(roleAllows("viewer", "read")).toBe(true);
  });

  it("reserves administration for owners", () => {
    expect(roleAllows("owner", "admin")).toBe(true);
    expect(roleAllows("editor", "admin")).toBe(false);
    expect(roleAllows("viewer", "admin")).toBe(false);
  });
});
