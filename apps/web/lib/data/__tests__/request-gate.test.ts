import { describe, expect, it } from "vitest";

import { createRequestGate } from "../request-gate";

describe("createRequestGate", () => {
  it("rejects an older request once a newer one begins", () => {
    const gate = createRequestGate();
    const first = gate.begin();

    expect(gate.isCurrent(first)).toBe(true);

    const second = gate.begin();

    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });
});
