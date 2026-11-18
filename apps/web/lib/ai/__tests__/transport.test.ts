import { describe, expect, it, vi } from "vitest";

import {
  AI_MAX_REQUEST_BYTES,
  type AiCredentialHandle,
  type AiTransportRequest,
} from "@opennest/ai";

import { createBrowserAiTransport } from "../transport";

const NOW = Date.parse("2026-11-17T08:00:00.000Z");
const SECRET = "sk-browser-secret-value";
const CREDENTIAL: AiCredentialHandle = {
  kind: "session",
  id: "credential-1",
  providerId: "openai",
};

function makeRequest(overrides: Partial<AiTransportRequest> = {}): AiTransportRequest {
  return {
    url: "https://api.openai.com/v1/chat/completions",
    providerId: "openai",
    allowedOrigin: "https://api.openai.com",
    auth: "bearer",
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: '{"model":"gpt-4.1-mini"}',
    credential: CREDENTIAL,
    signal: new AbortController().signal,
    timeoutMs: 60_000,
    maxResponseBytes: 1024,
    ...overrides,
  };
}

interface FakeResponseOptions {
  status?: number;
  headers?: Headers;
  body?: ReadableStream<Uint8Array> | null;
  text?: () => Promise<string>;
  redirected?: boolean;
}

function fakeResponse(overrides: FakeResponseOptions = {}): Response {
  return {
    status: 200,
    headers: new Headers(),
    body: null,
    text: async () => "",
    redirected: false,
    ...overrides,
  } as unknown as Response;
}

function captureFetch(response: Response | (() => Promise<Response>)): {
  fetchImpl: typeof fetch;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];

  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return typeof response === "function" ? response() : response;
  }) as typeof fetch;

  return { fetchImpl, calls };
}

function headerValue(init: RequestInit, name: string): string | null {
  return new Headers(init.headers).get(name);
}

describe("browser AI transport", () => {
  it("injects the bearer secret and locks down fetch options", async () => {
    const { fetchImpl, calls } = captureFetch(
      fakeResponse({ body: null, text: async () => '{"ok":true}' })
    );
    const transport = createBrowserAiTransport({
      resolveCredential: async () => SECRET,
      fetchImpl,
      now: () => NOW,
    });

    const response = await transport.send(makeRequest());

    expect(await response.text()).toBe('{"ok":true}');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0]?.init).toMatchObject({
      method: "POST",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
      cache: "no-store",
      mode: "cors",
    });
    expect(headerValue(calls[0]?.init ?? {}, "authorization")).toBe(`Bearer ${SECRET}`);
    expect(headerValue(calls[0]?.init ?? {}, "content-type")).toBe("application/json");
  });

  it("supports only x-api-key and no-auth providers", async () => {
    const first = captureFetch(fakeResponse());
    const apiKeyTransport = createBrowserAiTransport({
      resolveCredential: async () => SECRET,
      fetchImpl: first.fetchImpl,
    });

    await apiKeyTransport.send(makeRequest({ auth: "x-api-key" }));

    expect(headerValue(first.calls[0]?.init ?? {}, "x-api-key")).toBe(SECRET);
    expect(headerValue(first.calls[0]?.init ?? {}, "authorization")).toBeNull();

    const second = captureFetch(fakeResponse());
    const noAuthTransport = createBrowserAiTransport({
      resolveCredential: async () => {
        throw new Error("should not be called");
      },
      fetchImpl: second.fetchImpl,
    });

    await noAuthTransport.send(makeRequest({ auth: "none", credential: null }));

    expect(headerValue(second.calls[0]?.init ?? {}, "authorization")).toBeNull();
    expect(headerValue(second.calls[0]?.init ?? {}, "x-api-key")).toBeNull();
  });

  it("rejects mismatched URLs, providers, credentials, and headers", async () => {
    const { fetchImpl } = captureFetch(fakeResponse());
    const transport = createBrowserAiTransport({
      resolveCredential: async () => SECRET,
      fetchImpl,
    });

    await expect(
      transport.send(makeRequest({ allowedOrigin: "https://evil.example" }))
    ).rejects.toMatchObject({ code: "origin_mismatch" });

    await expect(
      transport.send(makeRequest({ url: "http://api.openai.com/v1" }))
    ).rejects.toMatchObject({ code: "invalid_endpoint" });

    await expect(
      transport.send(makeRequest({ url: "https://api.openai.com/v1?token=secret" }))
    ).rejects.toMatchObject({ code: "invalid_endpoint" });

    await expect(
      transport.send(makeRequest({ url: "https://user:pass@api.openai.com/v1" }))
    ).rejects.toMatchObject({ code: "invalid_endpoint" });

    await expect(
      transport.send(
        makeRequest({
          credential: { ...CREDENTIAL, providerId: "anthropic" },
        })
      )
    ).rejects.toMatchObject({ code: "credential_provider_mismatch" });

    await expect(transport.send(makeRequest({ credential: null }))).rejects.toMatchObject(
      { code: "credential_missing" }
    );

    await expect(transport.send(makeRequest({ auth: "none" }))).rejects.toMatchObject({
      code: "unexpected_credential",
    });

    await expect(
      transport.send(makeRequest({ headers: { "x-custom": "value" } }))
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("fails closed on redirects", async () => {
    const { fetchImpl, calls } = captureFetch(fakeResponse({ redirected: true }));
    const transport = createBrowserAiTransport({
      resolveCredential: async () => SECRET,
      fetchImpl,
    });

    await expect(transport.send(makeRequest())).rejects.toMatchObject({
      code: "redirect_blocked",
    });
    expect(calls[0]?.init.redirect).toBe("error");
  });

  it("never includes the raw secret in errors or console output", async () => {
    const spies = [
      vi.spyOn(console, "log"),
      vi.spyOn(console, "error"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "debug"),
    ];
    const fetchImpl = (async () => {
      throw new TypeError(`network failed for ${SECRET}`);
    }) as typeof fetch;
    const transport = createBrowserAiTransport({
      resolveCredential: async () => SECRET,
      fetchImpl,
    });

    let error: unknown;

    try {
      await transport.send(makeRequest());
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ code: "network_error" });
    expect(String(error)).not.toContain(SECRET);
    expect(JSON.stringify(error)).not.toContain(SECRET);

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("maps timeouts and caller aborts to safe codes", async () => {
    const timeoutFetch = (async (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true }
        );
      })) as typeof fetch;
    const timeoutTransport = createBrowserAiTransport({
      resolveCredential: async () => SECRET,
      fetchImpl: timeoutFetch,
    });

    await expect(
      timeoutTransport.send(makeRequest({ timeoutMs: 5 }))
    ).rejects.toMatchObject({ code: "timeout" });

    const controller = new AbortController();
    let started: () => void = () => undefined;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const abortFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      started();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true }
        );
      });
    }) as typeof fetch;
    const abortTransport = createBrowserAiTransport({
      resolveCredential: async () => SECRET,
      fetchImpl: abortFetch,
    });
    const pending = abortTransport.send(makeRequest({ signal: controller.signal }));

    await startedPromise;
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "aborted" });
  });

  it("enforces request and response byte limits", async () => {
    const { fetchImpl } = captureFetch(fakeResponse());
    const transport = createBrowserAiTransport({
      resolveCredential: async () => SECRET,
      fetchImpl,
    });

    await expect(
      transport.send(makeRequest({ body: "x".repeat(AI_MAX_REQUEST_BYTES + 1) }))
    ).rejects.toMatchObject({ code: "request_too_large" });

    const oversizedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4));
        controller.enqueue(new Uint8Array(4));
        controller.enqueue(new Uint8Array(4));
        controller.close();
      },
    });
    const oversizedTransport = createBrowserAiTransport({
      resolveCredential: async () => SECRET,
      fetchImpl: captureFetch(fakeResponse({ status: 200, body: oversizedBody }))
        .fetchImpl,
    });

    const response = await oversizedTransport.send(makeRequest({ maxResponseBytes: 6 }));

    await expect(response.text()).rejects.toMatchObject({
      code: "response_too_large",
    });
  });

  it("limits streamed response bodies", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4));
        controller.enqueue(new Uint8Array(4));
        controller.close();
      },
    });
    const transport = createBrowserAiTransport({
      resolveCredential: async () => SECRET,
      fetchImpl: captureFetch(fakeResponse({ status: 200, body })).fetchImpl,
    });

    const response = await transport.send(makeRequest({ maxResponseBytes: 6 }));
    const reader = response.body?.getReader();

    expect(reader).toBeDefined();
    await expect(reader?.read()).resolves.toMatchObject({ done: false });
    await expect(reader?.read()).rejects.toMatchObject({
      code: "response_too_large",
    });
  });
});
