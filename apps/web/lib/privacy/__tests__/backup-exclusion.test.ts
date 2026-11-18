import { describe, expect, it } from "vitest";

import {
  type AiProviderInput,
  type AiTransport,
  type AiTransportRequest,
  type AiTransportResponse,
} from "@opennest/ai";
import { createMemoryCredentialVaultStore } from "@opennest/credential-vault";
import { createKeyring, createMemoryKeyringStore } from "@opennest/crypto";
import { createMemoryStorage, type IsoDate } from "@opennest/core";
import {
  createMemoryPrivacyStore,
  createSequenceIds,
  dataInventory,
  flowMatrix,
} from "@opennest/privacy";

import { createAiRuntime, type AiRuntime } from "@/lib/ai/runtime";
import { createMemoryAiStore } from "@/lib/ai/store";
import { createPlainDraftStore } from "@/lib/autosave/draft-store";
import {
  createCredentialRuntime,
  type CredentialRuntime,
} from "@/lib/credentials/runtime";
import { createAppServices } from "@/lib/data/services";

import { createPrivacyRuntime, type PrivacyRuntime } from "../runtime";

const NOW = Date.parse("2026-11-17T08:00:00.000Z");
const AT = "2026-11-17T08:00:00.000Z" as IsoDate;
const SESSION_SECRET = "sk-session-secret-value";
const VAULT_SECRET = "sk-vault-secret-value";
const VAULT_PASSPHRASE = "correct horse battery staple";
const WORKSPACE_PASSPHRASE = "another long workspace passphrase";

const PROVIDER_INPUT: AiProviderInput = {
  label: "Unique Provider Label",
  kind: "remote",
  adapter: "openai-compatible",
  endpoint: "https://api.openai.com/v1",
  models: ["gpt-4.1-mini"],
  capabilities: ["chat"],
  auth: "bearer",
  dataPolicyUrl: null,
  maxContextTokens: 128_000,
  maxOutputTokens: 4_096,
};

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

interface Environment {
  ai: AiRuntime;
  credentials: CredentialRuntime;
  privacy: PrivacyRuntime;
  cleanup: () => Promise<void>;
}

async function setupEnvironment(enabled = true): Promise<Environment> {
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
  await settings.setEnabled(enabled);
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

  return {
    ai,
    credentials,
    privacy,
    cleanup: async () => {
      await ai.dispose();
      await credentials.dispose();
      await privacy.dispose();
    },
  };
}

async function seedAiData(environment: Environment) {
  const provider = await environment.ai.createProvider(PROVIDER_INPUT);
  const credential = await environment.credentials.createSessionCredential({
    providerId: provider.id,
    accountLabel: "Work key",
    secret: SESSION_SECRET,
  });
  await environment.credentials.setupVault(VAULT_PASSPHRASE);
  const vaultSession = environment.credentials.getVaultSession();

  if (vaultSession === null) {
    throw new Error("Expected an unlocked vault");
  }

  await environment.credentials.vault.create(vaultSession, {
    providerId: provider.id,
    accountLabel: "Vault key",
    secret: VAULT_SECRET,
  });
  const prepared = await environment.ai.prepare({
    providerId: provider.id,
    model: "gpt-4.1-mini",
    messages: [{ role: "user", content: `Summarize ${SESSION_SECRET}` }],
    dataClasses: ["D1"],
    purpose: "Run the selected AI request",
    credential: { kind: "session", id: credential.id, providerId: provider.id },
    stream: false,
  });
  await environment.ai.approveAndSend(prepared);
  const consent = (await environment.privacy.consents.list())[0];

  if (consent === undefined) {
    throw new Error("Expected a consent");
  }

  return { provider, credential, consent };
}

describe("AI data inventory and flow", () => {
  it("lists AI data with D1/D3/D4 classes and backup exclusion", () => {
    const expected = new Map([
      ["ai-provider-config", { dataClass: "D1", storage: "indexeddb" }],
      ["ai-credentials-session", { dataClass: "D3", storage: "memory" }],
      ["ai-credential-vault", { dataClass: "D3", storage: "indexeddb" }],
      ["ai-consents", { dataClass: "D4", storage: "indexeddb" }],
    ]);

    for (const [id, entry] of expected) {
      const found = dataInventory.find((candidate) => candidate.id === id);
      expect(found).toMatchObject({ ...entry, includedInBackup: false });
    }

    expect(flowMatrix.find((flow) => flow.id === "ai-provider")).toMatchObject({
      destination: "Z2",
      dataClasses: ["D1", "D2"],
      consent: "explicit",
      available: true,
    });
  });
});

describe("AI data backup exclusion", () => {
  it("keeps session and vault secrets, provider config, and consents out of v1 and v2 backups", async () => {
    const environment = await setupEnvironment();
    const { provider, credential, consent } = await seedAiData(environment);

    try {
      const plaintext = await environment.privacy.data.exportAll({ format: "v1" });
      const encrypted = await environment.privacy.data.exportAll({
        format: "v2",
        keySource: { kind: "passphrase", passphrase: VAULT_PASSPHRASE },
      });

      for (const text of [plaintext.text, encrypted.text]) {
        expect(text).not.toContain(SESSION_SECRET);
        expect(text).not.toContain(VAULT_SECRET);
        expect(text).not.toContain(VAULT_PASSPHRASE);
        expect(text).not.toContain(PROVIDER_INPUT.label);
        expect(text).not.toContain(provider.id);
        expect(text).not.toContain(credential.id);
        expect(text).not.toContain(consent.id);
        expect(text).not.toContain(consent.payloadHash);
      }

      for (const snapshot of [plaintext.snapshot, encrypted.snapshot]) {
        expect(Object.keys(snapshot)).not.toEqual(
          expect.arrayContaining(["aiProviders", "consents", "credentials", "vault"])
        );
      }
    } finally {
      await environment.cleanup();
    }
  });

  it("does not restore AI credentials or provider access from a backup", async () => {
    const source = await setupEnvironment();
    const { provider } = await seedAiData(source);
    const built = await source.privacy.data.exportAll({ format: "v1" });

    const target = await setupEnvironment(false);

    try {
      expect(await source.ai.listProviders()).toHaveLength(1);
      await target.privacy.data.restore(built.snapshot);
      expect(await target.ai.listProviders()).toEqual([]);
      expect(await target.privacy.consents.list()).toEqual([]);
      expect(await target.credentials.vault.hasVault()).toBe(false);
      expect(await target.ai.listProviders()).not.toContainEqual(provider);
    } finally {
      await target.cleanup();
      await source.cleanup();
    }
  });

  it("keeps extension metadata and isolated storage out of v1 and v2 backups", async () => {
    const environment = await setupEnvironment();

    try {
      const plaintext = await environment.privacy.data.exportAll({ format: "v1" });
      const encrypted = await environment.privacy.data.exportAll({
        format: "v2",
        keySource: { kind: "passphrase", passphrase: VAULT_PASSPHRASE },
      });

      for (const snapshot of [plaintext.snapshot, encrypted.snapshot]) {
        expect(Object.keys(snapshot)).not.toEqual(
          expect.arrayContaining(["extensions", "extensionStorage"])
        );
      }

      expect(dataInventory.find((entry) => entry.id === "extensions")).toMatchObject({
        includedInBackup: false,
      });
      expect(
        dataInventory.find((entry) => entry.id === "extension-storage")
      ).toMatchObject({ includedInBackup: false });
    } finally {
      await environment.cleanup();
    }
  });

  it("keeps workspace recovery and vault passphrases independent", async () => {
    const keyring = createKeyring({
      store: createMemoryKeyringStore(),
      workspaceId: "workspace-1",
      now: () => NOW,
    });
    const credentials = await createCredentialRuntime({
      store: createMemoryCredentialVaultStore(),
      now: () => NOW,
      generateId: createSequenceIds("credential"),
    });

    try {
      await credentials.setupVault(VAULT_PASSPHRASE);
      credentials.lockVault();
      const workspace = await keyring.setup({
        passphrase: WORKSPACE_PASSPHRASE,
      });

      const recovered = await keyring.unlockWithRecoveryKey(workspace.recoveryKey);
      expect(recovered.workspaceId).toBe("workspace-1");
      expect(credentials.getVaultSession()).toBeNull();
      await expect(credentials.unlockVault(WORKSPACE_PASSPHRASE)).rejects.toMatchObject({
        code: "authentication_failed",
      });
      await expect(keyring.unlock(VAULT_PASSPHRASE)).rejects.toMatchObject({
        code: "authentication_failed",
      });
      await expect(credentials.unlockVault(VAULT_PASSPHRASE)).resolves.toBeUndefined();
    } finally {
      await credentials.dispose();
    }
  });
});
