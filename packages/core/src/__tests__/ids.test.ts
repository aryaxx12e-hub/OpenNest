import { describe, expect, it, vi } from "vitest";

import { NoRandomSourceError } from "../errors";
import { createIdGenerator } from "../ids";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function bytesCrypto(fill: (index: number) => number): {
  getRandomValues: <T extends ArrayBufferView>(array: T) => T;
} {
  return {
    getRandomValues<T extends ArrayBufferView>(array: T): T {
      const view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let index = 0; index < view.length; index += 1) {
        view[index] = fill(index);
      }
      return array;
    },
  };
}

describe("createIdGenerator", () => {
  it("prefers randomUUID when the platform provides it", () => {
    const randomUUID = vi.fn(() => "fixed-uuid");
    const generate = createIdGenerator({
      randomUUID,
      getRandomValues: bytesCrypto(() => 0).getRandomValues,
    });

    expect(generate()).toBe("fixed-uuid");
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("falls back to getRandomValues and produces a valid v4 uuid", () => {
    const generate = createIdGenerator(bytesCrypto((index) => index * 7 + 3));

    expect(generate()).toMatch(UUID_V4);
  });

  it("fallback pins version and variant bits even when every byte is 0x00 or 0xff", () => {
    expect(createIdGenerator(bytesCrypto(() => 0))()).toMatch(UUID_V4);
    expect(createIdGenerator(bytesCrypto(() => 0xff))()).toMatch(UUID_V4);
  });

  it("fallback asks for exactly 16 random bytes", () => {
    const source = bytesCrypto(() => 1);
    const calls: ArrayBufferView[] = [];
    const getRandomValues = <T extends ArrayBufferView>(array: T): T => {
      calls.push(array);
      return source.getRandomValues(array);
    };
    const generate = createIdGenerator({ getRandomValues });

    generate();

    expect(calls).toHaveLength(1);
    const argument = calls[0] as Uint8Array;
    expect(argument).toBeInstanceOf(Uint8Array);
    expect(argument.length).toBe(16);
  });

  it("generates distinct ids", () => {
    let state = 0x9e3779b9;
    const generate = createIdGenerator({
      getRandomValues<T extends ArrayBufferView>(array: T): T {
        const view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
        for (let index = 0; index < view.length; index += 1) {
          state = (Math.imul(state, 1103515245) + 12345) >>> 0;
          view[index] = (state >>> 16) & 0xff;
        }
        return array;
      },
    });

    const ids = new Set(Array.from({ length: 500 }, () => generate()));

    expect(ids.size).toBe(500);
  });

  it("produces lowercase hex only", () => {
    const generate = createIdGenerator(bytesCrypto((index) => index * 13));

    expect(generate()).toBe(generate().toLowerCase());
  });

  it("throws a typed no_random_source error when the platform offers no crypto", () => {
    expect(() => createIdGenerator({})).toThrow(NoRandomSourceError);
    expect(() => createIdGenerator({})).toThrow(
      expect.objectContaining({ code: "no_random_source" })
    );
  });

  it("keeps randomUUID bound to its source", () => {
    const source = {
      prefix: "host-",
      randomUUID(this: { prefix: string }) {
        if (this.prefix !== "host-") {
          throw new TypeError('Value of "this" must be of type source');
        }

        return `${this.prefix}uuid`;
      },
    };

    expect(createIdGenerator(source)()).toBe("host-uuid");
  });

  it("keeps getRandomValues bound to its source", () => {
    const source = {
      calls: 0,
      getRandomValues<T extends ArrayBufferView>(this: { calls: number }, array: T): T {
        if (typeof this.calls !== "number") {
          throw new TypeError('Value of "this" must be of type source');
        }

        this.calls += 1;
        new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(7);

        return array;
      },
    };

    expect(createIdGenerator(source)()).toMatch(UUID_V4);
    expect(source.calls).toBe(1);
  });

  it("works with the platform crypto object as given", () => {
    const generate = createIdGenerator(globalThis.crypto);

    expect(generate()).toMatch(UUID_V4);
  });
});
