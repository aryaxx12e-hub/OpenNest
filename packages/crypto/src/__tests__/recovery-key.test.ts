import { describe, expect, it } from "vitest";

import { decodeRecoveryKey, encodeRecoveryKey } from "../index";

const BYTES = Uint8Array.from({ length: 32 }, (_, index) => index);
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe("recovery key encoding", () => {
  it("round-trips 32 bytes with the ONRK1 prefix", () => {
    const encoded = encodeRecoveryKey(BYTES);

    expect(encoded).toMatch(/^ONRK1-/);
    expect(decodeRecoveryKey(encoded)).toEqual(BYTES);
  });

  it("accepts lowercase, spaces, and omitted grouping hyphens", () => {
    const encoded = encodeRecoveryKey(BYTES);
    const messy = encoded.toLowerCase().replace(/-/g, " ");

    expect(decodeRecoveryKey(messy)).toEqual(BYTES);
    expect(decodeRecoveryKey(encoded.replace(/-/g, ""))).toEqual(BYTES);
  });

  it("rejects a checksum typo", () => {
    const encoded = encodeRecoveryKey(BYTES);
    const last = encoded.at(-1);
    const replacement = CROCKFORD[(CROCKFORD.indexOf(last ?? "") + 1) % CROCKFORD.length];
    const typo = `${encoded.slice(0, -1)}${replacement}`;

    expect(codeOf(() => decodeRecoveryKey(typo))).toBe("invalid_recovery_key");
  });

  it("rejects truncation, a wrong prefix, and a wrong payload length", () => {
    const encoded = encodeRecoveryKey(BYTES);

    expect(codeOf(() => decodeRecoveryKey(encoded.slice(0, -1)))).toBe(
      "invalid_recovery_key"
    );
    expect(codeOf(() => decodeRecoveryKey(encoded.replace("ONRK1", "ONBK1")))).toBe(
      "invalid_recovery_key"
    );
    expect(codeOf(() => encodeRecoveryKey(new Uint8Array(31)))).toBe(
      "invalid_recovery_key"
    );
  });
});
