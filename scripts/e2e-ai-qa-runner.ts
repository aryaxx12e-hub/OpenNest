import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type {
  AiCompletion,
  AiPreparedPayload,
  AiProviderConfig,
  AiRequest,
} from "@opennest/ai";

import { createQa, type QaAi } from "../apps/web/lib/ai/qa";
import type { AiPreparedRequest } from "../apps/web/lib/ai/runtime";
import type { Passage } from "../apps/web/lib/ai/retrieval/types";

const PROVIDER: AiProviderConfig = {
  id: "openai",
  label: "OpenAI",
  kind: "remote",
  adapter: "openai-compatible",
  endpoint: "http://127.0.0.1:0/v1",
  models: ["gpt-4.1-mini"],
  capabilities: ["chat"],
  auth: "bearer",
  dataPolicyUrl: null,
  maxContextTokens: 128_000,
  maxOutputTokens: 4_096,
  createdAt: 1,
  updatedAt: 1,
};
const PASSAGES: Passage[] = [
  {
    id: "note:note-1:0-21:abc",
    kind: "note",
    sourceId: "note-1",
    sourceTitle: "Shopping",
    text: "Belanja sayur dan buah.",
    start: 0,
    end: 21,
  },
];
const CREDENTIAL = {
  kind: "session" as const,
  id: "credential-1",
  providerId: PROVIDER.id,
};

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function run() {
  let answer = "Jawaban [[note:note-1:0-21:abc]]";
  let sends = 0;
  const mock = createServer((_request, response) => {
    sends += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ answer }));
  });
  const port = await listen(mock);
  const endpoint = `http://127.0.0.1:${port}/v1/chat/completions`;
  const provider = { ...PROVIDER, endpoint };

  const ai: QaAi = {
    async isEnabled() {
      return true;
    },
    async listProviders() {
      return [provider];
    },
    async prepare(input) {
      const request: AiRequest = {
        model: input.model,
        messages: input.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        stream: false,
      };
      const body = JSON.stringify(request);
      const prepared: AiPreparedPayload = {
        provider,
        request,
        endpoint,
        origin: new URL(endpoint).origin,
        body,
        payloadHash: createHash("sha256").update(body).digest("hex"),
        payloadBytes: new TextEncoder().encode(body).byteLength,
      };
      const preview: AiPreparedRequest = {
        prepared,
        provider,
        dataClasses: input.dataClasses,
        purpose: input.purpose,
        credential: input.credential,
        expiresAt: Date.now() + 300_000,
      };

      return preview;
    },
    async approveAndSend(input): Promise<AiCompletion> {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: input.prepared.body,
      });
      const body = (await response.json()) as { answer: string };

      return {
        text: body.answer,
        model: provider.models[0] ?? "gpt-4.1-mini",
        finishReason: "stop",
        usage: null,
      };
    },
  };
  const qa = createQa({ ai, enabled: true });
  const question = {
    providerId: provider.id,
    model: provider.models[0] ?? "gpt-4.1-mini",
    question: "Apa yang perlu dibeli?",
    passages: PASSAGES,
    credential: CREDENTIAL,
  };

  try {
    const prepared = await qa.prepare(question);

    assert.equal(sends, 0, "prepare must not send a request before consent");
    assert.ok(prepared.prompt.includes(PASSAGES[0]?.id ?? ""));

    const approved = await qa.send(prepared);

    assert.equal(sends, 1, "send must perform exactly one approved request");
    assert.equal(approved.unsupported, false);
    assert.deepEqual(
      approved.citations.map((citation) => citation.id),
      [PASSAGES[0]?.id]
    );

    answer = "Jawaban tanpa sumber.";
    const uncited = await qa.send(prepared);

    assert.equal(uncited.unsupported, true, "an uncited answer must be unsupported");
    assert.deepEqual(uncited.citations, []);

    answer = "Jawaban [[unknown-source]]";
    const unknown = await qa.send(prepared);

    assert.equal(unknown.unsupported, true, "unknown citations must be rejected");
    assert.deepEqual(unknown.citations, []);

    console.log(
      "PASS AI Q&A E2E: consent before send, valid citation, unsupported and unknown citations"
    );
  } finally {
    await close(mock);
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
