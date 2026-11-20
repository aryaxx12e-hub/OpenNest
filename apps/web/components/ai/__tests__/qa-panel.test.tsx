import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AiPreparedPayload, AiProviderConfig } from "@opennest/ai";
import { LocaleProvider } from "@opennest/localization";

import type { AiPreparedRequest } from "@/lib/ai/runtime";
import { createQa, QaError, type Qa, type QaAnswer, type QaPrepared } from "@/lib/ai/qa";
import type { Passage } from "@/lib/ai/retrieval/types";

import { QaPanel } from "../qa-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROVIDER: AiProviderConfig = {
  id: "openai",
  label: "OpenAI",
  kind: "remote",
  adapter: "openai-compatible",
  endpoint: "https://api.openai.com/v1",
  models: ["gpt-4.1-mini"],
  capabilities: ["chat"],
  auth: "bearer",
  dataPolicyUrl: null,
  maxContextTokens: 128_000,
  maxOutputTokens: 4_096,
  createdAt: 1,
  updatedAt: 1,
};

const PASSAGE: Passage = {
  id: "note:note-1:0-18:abc",
  kind: "note",
  sourceId: "note-1",
  sourceTitle: "Belanja",
  text: "Belanja sayur dan buah.",
  start: 0,
  end: 21,
};

const REQUEST: AiPreparedRequest = {
  prepared: {
    provider: PROVIDER,
    request: {
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: "Apa yang perlu dibeli?" }],
      stream: false,
    },
    endpoint: PROVIDER.endpoint,
    origin: "https://api.openai.com",
    body: "{}",
    payloadHash: "a".repeat(64),
    payloadBytes: 2,
  } satisfies AiPreparedPayload,
  provider: PROVIDER,
  dataClasses: ["D2"],
  purpose: "Document Q&A",
  credential: null,
  expiresAt: Date.now() + 5 * 60 * 1000,
};

const PREPARED: QaPrepared = {
  request: REQUEST,
  question: "Apa yang perlu dibeli?",
  prompt: "Question: Apa yang perlu dibeli?",
  passages: [PASSAGE],
  payloadHash: REQUEST.prepared.payloadHash,
  payloadBytes: REQUEST.prepared.payloadBytes,
  expiresAt: REQUEST.expiresAt,
};

const ANSWER: QaAnswer = {
  text: "Sayur dan buah.",
  citations: [PASSAGE],
  unsupported: false,
};

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function fakeQa(overrides: Partial<Qa> = {}): Qa {
  return {
    prepare: vi.fn(async () => PREPARED),
    send: vi.fn(async () => ANSWER),
    ...overrides,
  };
}

function render(qa: Qa) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root!.render(
      <LocaleProvider>
        <QaPanel
          qa={qa}
          providerId={PROVIDER.id}
          model={PROVIDER.models[0]!}
          credential={null}
          passages={[PASSAGE]}
        />
      </LocaleProvider>
    );
  });
}

function buttonByText(text: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(text)
  );

  expect(button).toBeDefined();
  return button as HTMLButtonElement;
}

async function waitFor(check: () => boolean, label: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) {
      return;
    }

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  throw new Error(`Timed out waiting for ${label}`);
}

async function ask(question: string) {
  const textarea = document.body.querySelector('[data-testid="qa-question"]');
  expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value"
  )?.set;

  act(() => {
    setValue?.call(textarea, question);
    textarea!.dispatchEvent(new Event("input", { bubbles: true }));
  });

  act(() => {
    (document.body.querySelector('[data-testid="qa-ask"]') as HTMLButtonElement).click();
  });
  await waitFor(
    () => document.body.querySelector('[data-testid="qa-consent"]') !== null,
    "consent dialog"
  );
}

beforeEach(() => {
  container = undefined;
  root = undefined;
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
});

describe("QaPanel", () => {
  it("requires approval before sending and links the answer citation", async () => {
    const qa = fakeQa();
    render(qa);
    await ask("Apa yang perlu dibeli?");

    expect(qa.send).not.toHaveBeenCalled();
    expect(
      document.body.querySelector('[data-testid="qa-consent-prompt"]')?.textContent
    ).toContain("Question: Apa yang perlu dibeli?");

    act(() => {
      buttonByText("Approve and send").click();
    });
    await waitFor(
      () => document.body.querySelector('[data-testid="qa-answer"]') !== null,
      "answer"
    );

    expect(qa.prepare).toHaveBeenCalledWith({
      providerId: PROVIDER.id,
      model: "gpt-4.1-mini",
      question: "Apa yang perlu dibeli?",
      passages: [PASSAGE],
      credential: null,
    });
    expect(qa.send).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('a[href="/notes/note-1"]')?.textContent).toContain(
      "Belanja"
    );
  });

  it("shows the unsupported state when no citation is returned", async () => {
    const qa = fakeQa({
      send: vi.fn(async () => ({
        text: "Tidak ada jawaban.",
        citations: [],
        unsupported: true,
      })),
    });
    render(qa);
    await ask("Apa yang perlu dibeli?");

    act(() => {
      buttonByText("Approve and send").click();
    });
    await waitFor(
      () => document.body.querySelector('[data-testid="qa-answer"]') !== null,
      "unsupported answer"
    );

    expect(document.body.textContent).toContain("Not supported by the selected sources");
    expect(document.body.querySelector('[data-testid="qa-citations"]')).toBeNull();
  });

  it("shows the feature-off error without sending", async () => {
    const qa = fakeQa({
      prepare: vi.fn(async () => {
        throw new QaError("disabled");
      }),
    });
    render(qa);

    const textarea = document.body.querySelector('[data-testid="qa-question"]');
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set;

    act(() => {
      setValue?.call(textarea, "Apa yang perlu dibeli?");
      textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      (
        document.body.querySelector('[data-testid="qa-ask"]') as HTMLButtonElement
      ).click();
    });
    await waitFor(
      () => document.body.querySelector('[data-testid="qa-error"]') !== null,
      "error"
    );

    expect(document.body.textContent).toContain("Document Q&A is off");
    expect(qa.send).not.toHaveBeenCalled();
  });

  it("passes selected passages to the real Q&A controller", async () => {
    const ai = {
      isEnabled: vi.fn(async () => true),
      listProviders: vi.fn(async () => [PROVIDER]),
      prepare: vi.fn(async () => REQUEST),
      approveAndSend: vi.fn(async () => ({
        text: "Sayur dan buah [[note:note-1:0-18:abc]].",
        model: "gpt-4.1-mini",
        finishReason: "stop",
        usage: null,
      })),
    };
    const qa = createQa({ ai, enabled: true });

    render(qa);
    await ask("Apa yang perlu dibeli?");
    act(() => {
      buttonByText("Approve and send").click();
    });
    await waitFor(
      () => document.body.querySelector('[data-testid="qa-answer"]') !== null,
      "real answer"
    );

    expect(ai.prepare).toHaveBeenCalledTimes(1);
    expect(ai.approveAndSend).toHaveBeenCalledTimes(1);
  });
});
