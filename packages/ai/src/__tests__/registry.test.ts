import { describe, expect, it } from "vitest";

import { createMemoryAiProviderStore } from "../memory-store";
import { AI_PROVIDER_PRESETS } from "../presets";
import {
  createAiProviderRegistry,
  validateProviderInput,
  type CreateAiProviderRegistryOptions,
} from "../registry";
import type { AiProviderInput } from "../types";

const NOW = Date.parse("2026-11-17T08:00:00.000Z");

function localInput(overrides: Partial<AiProviderInput> = {}): AiProviderInput {
  return {
    label: "Ollama",
    kind: "local",
    adapter: "openai-compatible",
    endpoint: "http://localhost:11434/v1/",
    models: ["llama3.2"],
    capabilities: ["chat"],
    auth: "none",
    dataPolicyUrl: null,
    maxContextTokens: null,
    maxOutputTokens: null,
    ...overrides,
  };
}

async function setup(overrides: Partial<CreateAiProviderRegistryOptions> = {}) {
  let tick = 0;
  let nextId = 0;
  const registry = createAiProviderRegistry({
    store: createMemoryAiProviderStore(),
    now: () => NOW + tick++,
    generateId: () => `provider-${++nextId}`,
    ...overrides,
  });

  return registry;
}

describe("AI provider registry", () => {
  it("creates, lists, updates, and removes a provider", async () => {
    const registry = await setup();
    const created = await registry.create(localInput());

    expect(created).toMatchObject({
      id: "provider-1",
      label: "Ollama",
      endpoint: "http://localhost:11434/v1",
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(await registry.list()).toEqual([created]);
    expect(await registry.get(created.id)).toEqual(created);

    const updated = await registry.update(
      created.id,
      localInput({ label: "Ollama Local", models: ["llama3.2:latest"] })
    );

    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).toBeGreaterThan(created.updatedAt);
    expect(updated.label).toBe("Ollama Local");
    expect(updated.models).toEqual(["llama3.2:latest"]);

    await registry.remove(created.id);
    expect(await registry.get(created.id)).toBeNull();
    expect(await registry.list()).toEqual([]);
  });

  it("rejects duplicate and empty model lists", async () => {
    const registry = await setup();

    await expect(
      registry.create(localInput({ models: ["llama3.2", "llama3.2"] }))
    ).rejects.toMatchObject({ code: "duplicate_model" });
    await expect(registry.create(localInput({ models: [] }))).rejects.toMatchObject({
      code: "invalid_models",
    });
  });

  it("rejects tools and MCP providers in D4B", async () => {
    const registry = await setup();

    await expect(
      registry.create(localInput({ capabilities: ["chat", "tools"] }))
    ).rejects.toMatchObject({ code: "unsupported_capability" });
    await expect(registry.create(localInput({ kind: "mcp" }))).rejects.toMatchObject({
      code: "unsupported_provider_kind",
    });
  });

  it("rejects invalid endpoints, data policy URLs, token limits, auth, and unknown fields", async () => {
    const registry = await setup();

    await expect(
      registry.create(localInput({ endpoint: "http://192.168.1.10:11434/v1" }))
    ).rejects.toMatchObject({ code: "invalid_endpoint" });
    await expect(
      registry.create(localInput({ dataPolicyUrl: "http://example.com/privacy" }))
    ).rejects.toMatchObject({ code: "invalid_data_policy_url" });
    await expect(
      registry.create(localInput({ maxContextTokens: 4_096, maxOutputTokens: 8_192 }))
    ).rejects.toMatchObject({ code: "invalid_token_limit" });
    await expect(
      registry.create(localInput({ auth: "basic" as never }))
    ).rejects.toMatchObject({ code: "invalid_auth" });
    await expect(
      registry.create(localInput({ adapter: "other" as never }))
    ).rejects.toMatchObject({ code: "invalid_adapter" });
    await expect(
      registry.create(
        localInput({ apiKey: "should-not-be-here" } as unknown as AiProviderInput)
      )
    ).rejects.toMatchObject({ code: "invalid_provider" });
  });

  it("ships presets without credentials and all presets validate", () => {
    expect(AI_PROVIDER_PRESETS.map((preset) => preset.id)).toEqual([
      "openai-compatible",
      "ollama",
      "lm-studio",
      "custom",
    ]);

    for (const preset of AI_PROVIDER_PRESETS) {
      expect(JSON.stringify(preset)).not.toMatch(/apiKey|secret|credential/i);
      expect(() => validateProviderInput(preset.config)).not.toThrow();
    }
  });
});
