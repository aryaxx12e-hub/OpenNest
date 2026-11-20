import { describe, expect, it } from "vitest";

import {
  applyDocumentState,
  applyDocumentUpdate,
  createCollaborationDocument,
  createPresenceRegistry,
  documentText,
  encodeDocumentState,
  encodeDocumentUpdate,
  readDocumentText,
} from "../index";

describe("collaboration document", () => {
  it("encodes and applies updates", () => {
    const source = createCollaborationDocument("Hello");
    const target = createCollaborationDocument();
    const update = encodeDocumentUpdate(source);

    applyDocumentUpdate(target, update);

    expect(readDocumentText(target)).toBe("Hello");
  });

  it("converges two documents after exchanging updates", () => {
    const left = createCollaborationDocument("base");
    const right = createCollaborationDocument("base");

    documentText(left).insert(4, " left");
    const leftUpdate = encodeDocumentState(left);

    documentText(right).insert(4, " right");
    const rightUpdate = encodeDocumentState(right);

    applyDocumentState(left, rightUpdate);
    applyDocumentState(right, leftUpdate);

    expect(readDocumentText(left)).toBe(readDocumentText(right));
    expect(readDocumentText(left)).toContain("left");
    expect(readDocumentText(left)).toContain("right");
  });
});

describe("presence registry", () => {
  it("keeps awareness in memory and removes it after the TTL", () => {
    let now = 1_000;
    const document = createCollaborationDocument("body");
    const presence = createPresenceRegistry({
      ttlMs: 100,
      now: () => now,
    });

    presence.add({
      connectionId: "connection-1",
      userId: "user-1",
      displayName: "Rya",
      color: "#3366ff",
    });

    expect(presence.list()).toEqual([
      {
        connectionId: "connection-1",
        userId: "user-1",
        displayName: "Rya",
        color: "#3366ff",
        joinedAt: "1970-01-01T00:00:01.000Z",
        lastSeenAt: "1970-01-01T00:00:01.000Z",
      },
    ]);
    expect(readDocumentText(document)).toBe("body");

    now = 1_101;

    expect(presence.list()).toEqual([]);
  });

  it("removes a participant on disconnect", () => {
    const presence = createPresenceRegistry();

    presence.add({
      connectionId: "connection-1",
      userId: "user-1",
      displayName: "Rya",
    });
    presence.remove("connection-1");

    expect(presence.list()).toEqual([]);
  });
});
