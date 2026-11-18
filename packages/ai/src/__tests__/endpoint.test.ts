import { describe, expect, it } from "vitest";

import { endpointOrigin, isLoopbackEndpoint, validateEndpoint } from "../endpoint";
import { hashPayload, joinEndpoint, validateAiRequest } from "../payload";
import type { AiProviderConfig, AiRequest } from "../types";

const PROVIDER: AiProviderConfig = {
  id: "openai",
  label: "OpenAI",
  kind: "remote",
  adapter: "openai-compatible",
  endpoint: "https://api.openai.com/v1",
  models: ["gpt-4.1-mini"],
  capabilities: ["chat"],
  auth: "bearer",
  dataPolicyUrl: "https://openai.com/policies/privacy-policy",
  maxContextTokens: 128_000,
  maxOutputTokens: 4_096,
  createdAt: 1,
  updatedAt: 1,
};

function request(overrides: Partial<AiRequest> = {}): AiRequest {
  return {
    model: "gpt-4.1-mini",
    messages: [{ role: "user", content: "Hello" }],
    stream: false,
    ...overrides,
  };
}

describe("AI endpoint policy", () => {
  it("accepts loopback local and HTTPS remote endpoints", () => {
    expect(validateEndpoint("http://localhost:11434/v1", "local")).toBe(
      "http://localhost:11434/v1"
    );
    expect(validateEndpoint("http://127.0.0.1:1234/v1/", "local")).toBe(
      "http://127.0.0.1:1234/v1"
    );
    expect(validateEndpoint("http://[::1]:8080/v1", "local")).toBe(
      "http://[::1]:8080/v1"
    );
    expect(validateEndpoint("https://api.openai.com/v1", "remote")).toBe(
      "https://api.openai.com/v1"
    );
    expect(validateEndpoint("https://gateway.example.com/v1", "custom")).toBe(
      "https://gateway.example.com/v1"
    );
    expect(isLoopbackEndpoint("http://localhost:11434/v1")).toBe(true);
    expect(endpointOrigin("http://localhost:11434/v1")).toBe("http://localhost:11434");
  });

  it("rejects remote HTTP, non-loopback local HTTP, userinfo, query, fragment, and wildcards", () => {
    expect(() => validateEndpoint("http://api.openai.com/v1", "remote")).toThrow(
      expect.objectContaining({ code: "invalid_endpoint" })
    );
    expect(() => validateEndpoint("http://192.168.1.10:11434/v1", "local")).toThrow(
      expect.objectContaining({ code: "invalid_endpoint" })
    );
    expect(() =>
      validateEndpoint("https://user:pass@api.openai.com/v1", "remote")
    ).toThrow(expect.objectContaining({ code: "invalid_endpoint" }));
    expect(() => validateEndpoint("https://api.openai.com/v1?x=1", "remote")).toThrow(
      expect.objectContaining({ code: "invalid_endpoint" })
    );
    expect(() =>
      validateEndpoint("https://api.openai.com/v1#fragment", "remote")
    ).toThrow(expect.objectContaining({ code: "invalid_endpoint" }));
    expect(() => validateEndpoint("https://*.openai.com/v1", "remote")).toThrow(
      expect.objectContaining({ code: "invalid_endpoint" })
    );
    expect(() => validateEndpoint("ftp://api.openai.com/v1", "remote")).toThrow(
      expect.objectContaining({ code: "invalid_endpoint" })
    );
    expect(() => validateEndpoint("https:///v1", "remote")).toThrow(
      expect.objectContaining({ code: "invalid_endpoint" })
    );
  });

  it("rejects MCP providers in D4B", () => {
    expect(() => validateEndpoint("https://api.openai.com/v1", "mcp")).toThrow(
      expect.objectContaining({ code: "unsupported_provider_kind" })
    );
  });
});

describe("AI payload helpers", () => {
  it("joins a base endpoint and a path without duplicate slashes", () => {
    expect(joinEndpoint("https://api.openai.com/v1/", "/chat/completions")).toBe(
      "https://api.openai.com/v1/chat/completions"
    );
    expect(joinEndpoint("http://localhost:11434/v1", "embeddings")).toBe(
      "http://localhost:11434/v1/embeddings"
    );
  });

  it("hashes the exact payload body with SHA-256", async () => {
    await expect(hashPayload("hello")).resolves.toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
  });

  it("validates messages, model membership, temperature, and output limits", () => {
    expect(validateAiRequest(request(), PROVIDER)).toEqual(request());
    expect(() => validateAiRequest(request({ model: "missing" }), PROVIDER)).toThrow(
      expect.objectContaining({ code: "model_not_allowed" })
    );
    expect(() => validateAiRequest(request({ messages: [] }), PROVIDER)).toThrow(
      expect.objectContaining({ code: "invalid_request" })
    );
    expect(() =>
      validateAiRequest(
        request({ messages: [{ role: "tool" as never, content: "x" }] }),
        PROVIDER
      )
    ).toThrow(expect.objectContaining({ code: "invalid_message" }));
    expect(() => validateAiRequest(request({ temperature: 3 }), PROVIDER)).toThrow(
      expect.objectContaining({ code: "invalid_temperature" })
    );
    expect(() => validateAiRequest(request({ maxTokens: 5_000 }), PROVIDER)).toThrow(
      expect.objectContaining({ code: "invalid_max_tokens" })
    );
  });
});
