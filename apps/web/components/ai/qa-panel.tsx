"use client";

import { useEffect, useId, useRef, useState } from "react";

import { AiError } from "@opennest/ai";
import { useTranslations } from "@opennest/localization";
import { Badge, Button, Card, Label, Textarea } from "@opennest/ui";

import type { Qa, QaAnswer, QaPrepared } from "@/lib/ai/qa";
import { QaError as QaFailure } from "@/lib/ai/qa";
import type { Passage } from "@/lib/ai/retrieval/types";

import { CitationList } from "./citation-list";
import { QaConsentDialog } from "./consent-dialog";

export interface QaPanelProps {
  qa: Qa;
  providerId: string;
  model: string;
  credential: Parameters<Qa["prepare"]>[0]["credential"];
  passages: readonly Passage[];
}

type Busy = "prepare" | "send" | null;

function errorKey(error: unknown): string {
  if (error instanceof QaFailure) {
    switch (error.code) {
      case "disabled":
        return "ai.qa.errors.disabled";
      case "no_provider":
        return "ai.qa.errors.noProvider";
      case "invalid_question":
        return "ai.qa.errors.questionRequired";
      case "invalid_passages":
        return "ai.qa.errors.sourcesRequired";
      case "invalid_data_class":
        return "ai.qa.errors.dataClass";
      case "request_too_large":
        return "ai.qa.errors.tooLarge";
      case "response_too_large":
        return "ai.qa.errors.tooLarge";
      case "consent_expired":
        return "ai.qa.errors.expired";
      case "payload_changed":
        return "ai.qa.errors.payloadChanged";
    }
  }

  if (error instanceof AiError && error.code === "aborted") {
    return "ai.qa.errors.aborted";
  }

  return "ai.qa.errors.generic";
}

export function QaPanel({ qa, providerId, model, credential, passages }: QaPanelProps) {
  const t = useTranslations();
  const questionId = useId();
  const mounted = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [prepared, setPrepared] = useState<QaPrepared | null>(null);
  const [answer, setAnswer] = useState<QaAnswer | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const ask = async () => {
    if (question.trim().length === 0) {
      setError(t("ai.qa.errors.questionRequired"));
      return;
    }

    if (passages.length === 0) {
      setError(t("ai.qa.errors.sourcesRequired"));
      return;
    }

    setBusy("prepare");
    setError(null);
    setCancelled(false);
    setAnswer(null);

    try {
      const next = await qa.prepare({
        providerId,
        model,
        question,
        passages,
        credential,
      });

      if (mounted.current) {
        setPrepared(next);
      }
    } catch (failure) {
      if (mounted.current) {
        setError(t(errorKey(failure)));
      }
    } finally {
      if (mounted.current) {
        setBusy(null);
      }
    }
  };

  const approve = async () => {
    if (prepared === null) {
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy("send");
    setError(null);
    setCancelled(false);

    try {
      const result = await qa.send(prepared, { signal: controller.signal });

      if (mounted.current) {
        setAnswer(result);
        setPrepared(null);
      }
    } catch (failure) {
      if (mounted.current) {
        setError(t(errorKey(failure)));

        if (failure instanceof QaFailure && failure.code === "consent_expired") {
          setPrepared(null);
        }
      }
    } finally {
      if (mounted.current) {
        setBusy(null);
      }

      abortRef.current = null;
    }
  };

  const cancel = () => {
    if (busy === "send") {
      abortRef.current?.abort();
      setCancelled(true);
      return;
    }

    setPrepared(null);
  };

  return (
    <Card className="space-y-4" data-testid="qa-panel">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t("ai.qa.title")}</h2>
        <p className="text-muted text-sm leading-6">{t("ai.qa.description")}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={questionId}>{t("ai.qa.question")}</Label>
        <Textarea
          id={questionId}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={t("ai.qa.placeholder")}
          rows={3}
          disabled={busy !== null}
          data-testid="qa-question"
        />
        <p className="text-muted text-xs">
          {passages.length === 0
            ? t("ai.qa.noSources")
            : `${passages.length} ${t("ai.qa.sourcesSelected")}`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => void ask()}
          loading={busy === "prepare"}
          disabled={busy !== null || passages.length === 0}
          data-testid="qa-ask"
        >
          {busy === "prepare" ? t("ai.qa.preparing") : t("ai.qa.ask")}
        </Button>
        {cancelled ? (
          <Badge tone="neutral" data-testid="qa-cancelled">
            {t("ai.qa.cancelled")}
          </Badge>
        ) : null}
      </div>

      {error === null ? null : (
        <p
          role="alert"
          className="rounded-control border border-amber-700/30 bg-amber-700/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"
          data-testid="qa-error"
        >
          {error}
        </p>
      )}

      {answer === null ? null : (
        <div className="space-y-3" aria-live="polite" data-testid="qa-answer">
          {answer.unsupported ? (
            <div className="rounded-control space-y-1 border border-amber-700/30 bg-amber-700/10 px-3 py-2">
              <p className="text-sm font-medium">{t("ai.qa.unsupportedTitle")}</p>
              <p className="text-muted text-xs leading-5">{t("ai.qa.unsupportedBody")}</p>
            </div>
          ) : null}
          <div className="space-y-1">
            <h3 className="text-sm font-medium">{t("ai.qa.answerTitle")}</h3>
            <p className="text-sm leading-6 whitespace-pre-wrap">
              {answer.text.length > 0 ? answer.text : t("ai.qa.unsupportedAnswer")}
            </p>
          </div>
          <CitationList citations={answer.citations} />
        </div>
      )}

      <QaConsentDialog
        open={prepared !== null}
        prepared={prepared}
        busy={busy === "send"}
        onApprove={() => void approve()}
        onCancel={cancel}
      />
    </Card>
  );
}
