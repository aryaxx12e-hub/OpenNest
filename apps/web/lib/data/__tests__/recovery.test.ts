import { describe, expect, it } from "vitest";

import { recoveryTip } from "../recovery";

describe("recoveryTip", () => {
  it.each([
    ["backup.errors.wrongKey", "wrongKey"],
    ["backup.errors.checksumMismatch", "damaged"],
    ["backup.errors.invalidEncryption", "damaged"],
    ["backup.errors.invalidSummary", "damaged"],
    ["backup.errors.invalidBlob", "damaged"],
    ["backup.errors.invalidFormat", "format"],
    ["backup.errors.invalidJson", "format"],
    ["backup.errors.unsupportedVersion", "format"],
    ["backup.draftClearFailed", "drafts"],
    ["privacy.errors.storage_failed", "storage"],
    ["privacy.errors.draft_clear_failed", "storage"],
    ["backup.errors.exportFailed", "generic"],
    ["privacy.errors.unknown_grant", "generic"],
  ])("maps %s to %s", (key, tip) => {
    expect(recoveryTip(key)).toBe(tip);
  });

  it("returns null when there is no error", () => {
    expect(recoveryTip(null)).toBeNull();
  });
});
