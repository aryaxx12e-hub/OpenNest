import { useState, type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type AiProviderConfig,
  type AiTransport,
  type AiTransportRequest,
  type AiTransportResponse,
} from "@opennest/ai";
import { createMemoryCredentialVaultStore } from "@opennest/credential-vault";
import { createMemoryStorage, type IsoDate } from "@opennest/core";
import { LocaleProvider } from "@opennest/localization";
import {
  createMemoryPrivacyStore,
  createSequenceIds,
  type ConsentRecord,
} from "@opennest/privacy";

import { createAiRuntime, type AiRuntime } from "@/lib/ai/runtime";
import { createMemoryAiStore } from "@/lib/ai/store";
import {
  createCredentialRuntime,
  type CredentialRuntime,
} from "@/lib/credentials/runtime";
import { createPlainDraftStore } from "@/lib/autosave/draft-store";
import { createAppServices } from "@/lib/data/services";
import { createPrivacyRuntime, type PrivacyRuntime } from "@/lib/privacy/runtime";

import { PrivacyConsents } from "../privacy-consents";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse("2026-11-17T08:00:00.000Z");
const AT = "2026-11-17T08:00:00.000Z" as IsoDate;
const SECRET = "sk-super-secret-value";

const PROVIDER_INPUT = {
  label: "OpenAI Cloud",
  kind: "remote",
  adapter: "openai-compatible",
  endpoint: "https://api.openai.com/v1",
  models: ["gpt-4.1-mini"],
  capabilities: ["chat"],
  auth: "bearer",
  dataPolicyUrl: null,
  maxContextTokens: 128_000,
  maxOutputTokens: 4_096,
} as const;

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let cleanup: (() => Promise<void>) | undefined;

function consentFixture(overrides: Partial<ConsentRecord> = {}): ConsentRecord {
  return {
    id: "consent-1",
    sessionId: "session-1",
    principalId: "built-in:local",
    providerId: "provider-1",
    model: "gpt-4.1-mini",
    endpointOrigin: "https://api.openai.com",
    payloadHash: "a".repeat(64),
    payloadBytes: 128,
    dataClasses: ["D1", "D2"],
    purpose: `Private purpose ${SECRET}`,
    createdAt: NOW - 60_000,
    expiresAt: NOW + 60_000,
    usedAt: NOW,
    revokedAt: null,
    ...overrides,
  };
}

function providerFixture(): AiProviderConfig {
  return {
    ...PROVIDER_INPUT,
    capabilities: [...PROVIDER_INPUT.capabilities],
    models: [...PROVIDER_INPUT.models],
    id: "provider-1",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function jsonResponse(): AiTransportResponse {
  return {
    status: 200,
    headers: new Headers(),
    body: null,
    text: async () =>
      JSON.stringify({
        model: "gpt-4.1-mini",
        choices: [{ message: { content: "Hello" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
  };
}

class FakeTransport implements AiTransport {
  readonly requests: AiTransportRequest[] = [];

  async send(request: AiTransportRequest): Promise<AiTransportResponse> {
    this.requests.push(request);
    return jsonResponse();
  }
}

async function setupRuntime(): Promise<{
  ai: AiRuntime;
  credentials: CredentialRuntime;
  privacy: PrivacyRuntime;
}> {
  const storage = createMemoryStorage();
  const { services, workspace } = await createAppServices(storage, {
    defaultWorkspaceName: "My Library",
    clock: () => AT,
    hash: async (value) => value.join(":"),
    generateBlobKey: () => "22222222-2222-4222-8222-222222222222",
  });
  const privacy = await createPrivacyRuntime({
    storage,
    services,
    workspace,
    drafts: createPlainDraftStore(window.localStorage),
    openPrivacyStore: async () => createMemoryPrivacyStore(),
    now: () => NOW,
    generateId: createSequenceIds("privacy"),
  });
  const settings = createMemoryAiStore();
  await settings.setEnabled(true);
  const ai = createAiRuntime({
    privacy,
    settings,
    transport: new FakeTransport(),
    now: () => NOW,
  });
  const credentials = await createCredentialRuntime({
    store: createMemoryCredentialVaultStore(),
    now: () => NOW,
    generateId: createSequenceIds("credential"),
  });

  cleanup = async () => {
    await ai.dispose();
    await credentials.dispose();
    await privacy.dispose();
  };

  return { ai, credentials, privacy };
}

function render(element: ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root!.render(<LocaleProvider>{element}</LocaleProvider>);
  });
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`No button named ${text}`);
  }

  return button;
}

async function waitForText(host: HTMLElement, text: string) {
  for (let index = 0; index < 500; index += 1) {
    if (host.textContent?.includes(text) === true) {
      return;
    }

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }

  throw new Error(`Timed out waiting for ${text}`);
}

beforeEach(() => {
  window.localStorage.clear();
  document.body.replaceChildren();
});

afterEach(async () => {
  act(() => root?.unmount());
  container?.remove();
  document.body.replaceChildren();
  root = undefined;
  container = undefined;
  await cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
});

describe("PrivacyConsents", () => {
  it("lists provider, model, origin, classes, timestamps, and status without payload or secret", () => {
    render(
      <PrivacyConsents
        consents={[consentFixture()]}
        providers={[providerFixture()]}
        now={NOW}
        onRevoke={() => Promise.resolve()}
      />
    );

    expect(container!.textContent).toContain("OpenAI Cloud");
    expect(container!.textContent).toContain("gpt-4.1-mini");
    expect(container!.textContent).toContain("https://api.openai.com");
    expect(container!.textContent).toContain("D1, D2");
    expect(container!.textContent).toContain("Used");
    expect(container!.textContent).not.toContain(SECRET);
    expect(container!.textContent).not.toContain("a".repeat(64));
    expect(container!.textContent).not.toContain("Private purpose");
    expect(container!.textContent).not.toContain("128");
  });

  it("revokes the consent and its linked grants", async () => {
    const { ai, credentials, privacy } = await setupRuntime();
    const provider = await ai.createProvider(PROVIDER_INPUT);
    const session = await credentials.createSessionCredential({
      providerId: provider.id,
      accountLabel: "Work key",
      secret: SECRET,
    });
    const prepared = await ai.prepare({
      providerId: provider.id,
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: "Hello" }],
      dataClasses: ["D1"],
      purpose: "Run the selected AI request",
      credential: { kind: "session", id: session.id, providerId: provider.id },
      stream: false,
    });
    await ai.approveAndSend(prepared);

    const consents = await privacy.consents.list();
    const consent = consents[0];

    if (consent === undefined) {
      throw new Error("Expected a consent");
    }

    const linked = (await privacy.grants.list()).filter(
      (grant) => grant.auditRef === consent.id && grant.status === "active"
    );

    expect(linked.length).toBeGreaterThan(0);

    function Harness() {
      const [rows, setRows] = useState(consents);
      const [busyId, setBusyId] = useState<string | null>(null);

      return (
        <PrivacyConsents
          consents={rows}
          providers={[provider]}
          busyId={busyId}
          now={NOW}
          onRevoke={async (id) => {
            setBusyId(id);
            await privacy.revokeConsent(id);
            setRows(await privacy.consents.list());
            setBusyId(null);
          }}
        />
      );
    }

    render(<Harness />);
    act(() => buttonByText(container!, "Revoke").click());
    await waitForText(container!, "Revoked");

    const revoked = (await privacy.consents.list())[0];
    expect(revoked?.id).toBe(consent.id);
    expect(revoked?.revokedAt).not.toBeNull();
    expect(
      (await privacy.grants.list()).filter(
        (grant) => grant.auditRef === consent.id && grant.status === "active"
      )
    ).toEqual([]);
  });
});
