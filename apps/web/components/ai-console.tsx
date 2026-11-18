"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { AiError, type AiProviderConfig } from "@opennest/ai";
import type { VaultEntryMetadata } from "@opennest/credential-vault";
import { formatNumber, useLocale, useTranslations } from "@opennest/localization";
import {
  Badge,
  Button,
  Card,
  Dialog,
  Label,
  Select,
  Skeleton,
  Textarea,
} from "@opennest/ui";

import type { AiCredentialChoice, AiPreparedRequest, AiRuntime } from "@/lib/ai/runtime";
import { useAppData } from "@/lib/data/app-data-provider";
import type { CredentialRuntime } from "@/lib/credentials/runtime";
import type { SessionCredentialMetadata } from "@/lib/credentials/session-store";

export interface AiConsoleProps {
  ai: AiRuntime;
  credentials: CredentialRuntime;
}

interface CredentialOption {
  readonly value: string;
  readonly label: string;
  readonly choice: AiCredentialChoice;
}

interface ConsoleSnapshot {
  readonly enabled: boolean;
  readonly providers: AiProviderConfig[];
  readonly session: SessionCredentialMetadata[];
  readonly vault: VaultEntryMetadata[];
  readonly vaultExists: boolean;
  readonly vaultUnlocked: boolean;
}

type Busy = "prepare" | "send" | null;

function errorKey(error: unknown): string {
  if (error instanceof AiError) {
    switch (error.code) {
      case "ai_disabled":
        return "ai.console.errors.aiDisabled";
      case "credential_missing":
      case "credential_provider_mismatch":
      case "unexpected_credential":
        return "ai.console.errors.credential";
      case "network_error":
        return "ai.console.errors.network";
      case "timeout":
        return "ai.console.errors.timeout";
      case "aborted":
        return "ai.console.errors.aborted";
      case "malformed_response":
      case "response_too_large":
        return "ai.console.errors.malformed";
      case "authentication_failed":
      case "permission_denied":
      case "rate_limited":
      case "provider_error":
      case "redirect_blocked":
        return "ai.console.errors.provider";
      case "payload_changed":
        return "ai.console.errors.payloadChanged";
      default:
        return "ai.console.errors.generic";
    }
  }

  return "ai.console.errors.generic";
}

function credentialValue(choice: AiCredentialChoice): string {
  return `${choice.kind}:${choice.id}`;
}

function optionFromSession(entry: SessionCredentialMetadata): CredentialOption {
  return {
    value: credentialValue({
      kind: "session",
      id: entry.id,
      providerId: entry.providerId,
    }),
    label: entry.accountLabel,
    choice: { kind: "session", id: entry.id, providerId: entry.providerId },
  };
}

function optionFromVault(entry: VaultEntryMetadata): CredentialOption {
  return {
    value: credentialValue({ kind: "vault", id: entry.id, providerId: entry.providerId }),
    label: entry.accountLabel,
    choice: { kind: "vault", id: entry.id, providerId: entry.providerId },
  };
}

export function AiConsoleRoute() {
  const { ai, credentials } = useAppData();

  return <AiConsole ai={ai} credentials={credentials} />;
}

export function AiConsole({ ai, credentials }: AiConsoleProps) {
  const t = useTranslations();
  const { locale } = useLocale();
  const [enabled, setEnabled] = useState(false);
  const [providers, setProviders] = useState<AiProviderConfig[]>([]);
  const [session, setSession] = useState<SessionCredentialMetadata[]>([]);
  const [vault, setVault] = useState<VaultEntryMetadata[]>([]);
  const [vaultExists, setVaultExists] = useState(false);
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [credential, setCredential] = useState("");
  const [prompt, setPrompt] = useState("");
  const [stream, setStream] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [prepared, setPrepared] = useState<AiPreparedRequest | null>(null);
  const [preparedCredential, setPreparedCredential] = useState<string | null>(null);
  const [response, setResponse] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const load = useCallback(async (): Promise<ConsoleSnapshot> => {
    const [nextEnabled, nextProviders, hasVault] = await Promise.all([
      ai.isEnabled(),
      ai.listProviders(),
      credentials.vault.hasVault(),
    ]);
    const vaultSession = credentials.getVaultSession();
    const entries =
      vaultSession === null ? [] : await credentials.vault.list(vaultSession);

    return {
      enabled: nextEnabled,
      providers: [...nextProviders].sort((left, right) =>
        left.label.localeCompare(right.label)
      ),
      session: [...credentials.session.list()],
      vault: [...entries],
      vaultExists: hasVault,
      vaultUnlocked: vaultSession !== null,
    };
  }, [ai, credentials]);

  const apply = useCallback((snapshot: ConsoleSnapshot) => {
    setEnabled(snapshot.enabled);
    setProviders(snapshot.providers);
    setSession(snapshot.session);
    setVault(snapshot.vault);
    setVaultExists(snapshot.vaultExists);
    setVaultUnlocked(snapshot.vaultUnlocked);
    setLoading(false);
    setLoadError(null);
  }, []);

  const refresh = useCallback(async () => {
    apply(await load());
  }, [apply, load]);

  useEffect(() => {
    let cancelled = false;

    load()
      .then((snapshot) => {
        if (!cancelled) {
          apply(snapshot);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError("ai.console.errors.load");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apply, load]);

  const provider =
    providers.find((item) => item.id === providerId) ?? providers[0] ?? null;
  const selectedModel =
    provider !== null && provider.models.includes(model)
      ? model
      : (provider?.models[0] ?? "");
  const credentialOptions: CredentialOption[] =
    provider === null
      ? []
      : [
          ...session
            .filter((entry) => entry.providerId === provider.id)
            .map(optionFromSession),
          ...vault
            .filter((entry) => entry.providerId === provider.id)
            .map(optionFromVault),
        ];
  const credentialOption =
    credentialOptions.find((option) => option.value === credential) ??
    credentialOptions[0] ??
    null;
  const needsCredential = provider !== null && provider.auth !== "none";
  const credentialLabel =
    credentialOption?.label ?? (needsCredential ? null : t("ai.console.credentialNone"));

  async function review() {
    if (provider === null || busy !== null) {
      return;
    }

    if (prompt.trim().length === 0) {
      setError("ai.console.errors.promptRequired");
      return;
    }

    if (needsCredential && credentialOption === null) {
      setError(
        vaultExists && !vaultUnlocked
          ? "ai.console.errors.vaultLocked"
          : "ai.console.errors.credential"
      );
      return;
    }

    setBusy("prepare");
    setError(null);
    setCancelled(false);
    setResponse(null);

    try {
      const next = await ai.prepare({
        providerId: provider.id,
        model: selectedModel,
        messages: [{ role: "user", content: prompt.trim() }],
        dataClasses: ["D2"],
        purpose: "AI console request",
        credential: needsCredential ? (credentialOption?.choice ?? null) : null,
        stream,
      });

      if (!mounted.current) {
        return;
      }

      setPreparedCredential(credentialLabel);
      setPrepared(next);
    } catch (caught) {
      if (mounted.current) {
        setError(errorKey(caught));
      }
    } finally {
      if (mounted.current) {
        setBusy(null);
      }
    }
  }

  function closePrepared() {
    if (busy === "send") {
      abortRef.current?.abort();
    }

    setPrepared(null);
  }

  async function approve() {
    if (prepared === null || sending.current) {
      return;
    }

    sending.current = true;
    setBusy("send");
    setError(null);
    setCancelled(false);
    const controller = new AbortController();
    abortRef.current = controller;
    let text = "";

    try {
      if (prepared.prepared.request.stream) {
        for await (const event of ai.approveAndStream(prepared, {
          signal: controller.signal,
        })) {
          if (event.type === "delta") {
            text += event.text;

            if (mounted.current) {
              setResponse(text);
            }
          }
        }
      } else {
        const completion = await ai.approveAndSend(prepared, {
          signal: controller.signal,
        });
        text = completion.text;
      }

      if (mounted.current) {
        setResponse(text);
        setPrepared(null);
        setCancelled(false);
      }
    } catch (caught) {
      if (!mounted.current) {
        return;
      }

      setPrepared(null);

      if (caught instanceof AiError && caught.code === "aborted") {
        setCancelled(true);
        setError(null);
      } else {
        setError(errorKey(caught));
      }
    } finally {
      sending.current = false;
      abortRef.current = null;

      if (mounted.current) {
        setBusy(null);
      }
    }
  }

  async function reviewAgain() {
    setCancelled(false);
    setError(null);
    setResponse(null);

    try {
      await refresh();
    } catch {
      setLoadError("ai.console.errors.load");
    }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (loadError !== null) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <div role="alert" className="space-y-3">
          <h1 className="text-xl font-semibold">{t("ai.console.title")}</h1>
          <p className="text-muted text-sm">{t(loadError)}</p>
          <Button onClick={() => void refresh()}>{t("common.retry")}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("ai.console.title")}</h1>
        <p className="text-muted text-sm leading-6">{t("ai.console.description")}</p>
      </header>

      {!enabled ? (
        <Card className="space-y-3">
          <h2 className="text-lg font-semibold">{t("ai.console.disabledTitle")}</h2>
          <p className="text-muted text-sm leading-6">{t("ai.console.disabledBody")}</p>
          <Link
            href="/settings"
            className="text-primary inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
          >
            {t("ai.console.openSettings")}
          </Link>
        </Card>
      ) : provider === null ? (
        <Card className="space-y-3">
          <h2 className="text-lg font-semibold">{t("ai.console.noProvidersTitle")}</h2>
          <p className="text-muted text-sm leading-6">
            {t("ai.console.noProvidersBody")}
          </p>
          <Link
            href="/settings"
            className="text-primary inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
          >
            {t("ai.console.openSettings")}
          </Link>
        </Card>
      ) : (
        <Card className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ai-console-provider">{t("ai.console.provider")}</Label>
              <Select
                id="ai-console-provider"
                data-testid="ai-console-provider"
                value={provider.id}
                disabled={busy !== null}
                onChange={(event) => {
                  setProviderId(event.target.value);
                  setModel("");
                  setCredential("");
                  setError(null);
                }}
              >
                {providers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ai-console-model">{t("ai.console.model")}</Label>
              <Select
                id="ai-console-model"
                data-testid="ai-console-model"
                value={selectedModel}
                disabled={busy !== null}
                onChange={(event) => {
                  setModel(event.target.value);
                  setError(null);
                }}
              >
                {provider.models.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {needsCredential ? (
            <div className="space-y-1">
              <Label htmlFor="ai-console-credential">{t("ai.console.credential")}</Label>
              {credentialOptions.length === 0 ? (
                <p className="text-muted text-sm">{t("ai.console.noCredentialBody")}</p>
              ) : (
                <Select
                  id="ai-console-credential"
                  data-testid="ai-console-credential"
                  value={credentialOption?.value ?? ""}
                  disabled={busy !== null}
                  onChange={(event) => {
                    setCredential(event.target.value);
                    setError(null);
                  }}
                >
                  {credentialOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          ) : null}

          {vaultExists && !vaultUnlocked ? (
            <p className="text-muted text-xs leading-5">{t("ai.console.vaultLocked")}</p>
          ) : null}

          <div className="space-y-1">
            <Label htmlFor="ai-console-prompt">{t("ai.console.prompt")}</Label>
            <Textarea
              id="ai-console-prompt"
              data-testid="ai-console-prompt"
              rows={5}
              value={prompt}
              placeholder={t("ai.console.promptPlaceholder")}
              disabled={busy !== null}
              onChange={(event) => {
                setPrompt(event.target.value);
                setError(null);
              }}
            />
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              data-testid="ai-console-stream"
              checked={stream}
              disabled={busy !== null}
              onChange={(event) => setStream(event.target.checked)}
              className="accent-primary mt-1 size-4"
            />
            <span className="space-y-0.5">
              <span className="block font-medium">{t("ai.console.stream")}</span>
              <span className="text-muted block text-xs leading-5">
                {t("ai.console.streamHint")}
              </span>
            </span>
          </label>

          {error === null ? null : (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {t(error)}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              data-testid="ai-console-review"
              loading={busy === "prepare"}
              disabled={
                busy !== null ||
                selectedModel.length === 0 ||
                (needsCredential && credentialOption === null)
              }
              onClick={() => void review()}
            >
              {busy === "prepare" ? t("ai.console.preparing") : t("ai.console.review")}
            </Button>
            <span className="text-muted text-xs">{t("ai.console.reviewHint")}</span>
          </div>
        </Card>
      )}

      {response === null && !cancelled && error === null ? null : (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">
              {cancelled ? t("ai.console.cancelled") : t("ai.console.responseTitle")}
            </h2>
            {cancelled || error !== null ? (
              <Button variant="secondary" onClick={() => void reviewAgain()}>
                {t("ai.console.reviewAgain")}
              </Button>
            ) : null}
          </div>
          {error === null ? null : (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {t(error)}
            </p>
          )}
          {response === null ? null : (
            <pre
              data-testid="ai-console-response"
              className="border-border bg-border/20 overflow-x-auto rounded-xl border p-3 text-sm whitespace-pre-wrap"
            >
              {response}
            </pre>
          )}
          {cancelled ? (
            <p className="text-muted text-sm">{t("ai.console.cancelledBody")}</p>
          ) : null}
        </Card>
      )}

      <Dialog
        open={prepared !== null}
        title={t("ai.console.consentTitle")}
        description={t("ai.console.consentDescription")}
        onClose={closePrepared}
        footer={
          busy === "send" ? (
            <>
              <Button
                variant="danger"
                data-testid="ai-console-abort"
                onClick={() => abortRef.current?.abort()}
              >
                {t("ai.console.cancelRequest")}
              </Button>
              <Button loading disabled>
                {t("ai.console.sending")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={closePrepared}>
                {t("common.cancel")}
              </Button>
              <Button data-testid="ai-console-approve" onClick={() => void approve()}>
                {t("ai.console.approve")}
              </Button>
            </>
          )
        }
      >
        {prepared === null ? null : (
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-3 gap-y-2">
              <dt className="text-muted">{t("ai.console.consentProvider")}</dt>
              <dd className="font-medium">{prepared.provider.label}</dd>
              <dt className="text-muted">{t("ai.console.consentOrigin")}</dt>
              <dd className="font-mono text-xs break-all">{prepared.prepared.origin}</dd>
              <dt className="text-muted">{t("ai.console.consentModel")}</dt>
              <dd className="font-mono text-xs">{prepared.prepared.request.model}</dd>
              <dt className="text-muted">{t("ai.console.consentClasses")}</dt>
              <dd>
                <Badge tone="neutral">{prepared.dataClasses.join(", ")}</Badge>
              </dd>
              <dt className="text-muted">{t("ai.console.consentBytes")}</dt>
              <dd>
                {formatNumber(locale, prepared.prepared.payloadBytes)}{" "}
                {t("ai.console.bytesUnit")}
              </dd>
              <dt className="text-muted">{t("ai.console.consentCredential")}</dt>
              <dd>{preparedCredential ?? t("ai.console.credentialNone")}</dd>
            </dl>

            <div className="space-y-1">
              <p className="font-medium">{t("ai.console.consentRetention")}</p>
              <p className="text-muted text-xs leading-5">
                {t("ai.console.consentRetentionBody")}
              </p>
            </div>
            <p className="text-muted text-xs leading-5">
              {t("ai.console.consentNoWorkspace")}
            </p>

            <div className="space-y-1">
              <p className="font-medium">{t("ai.console.consentPrompt")}</p>
              <pre
                data-testid="ai-consent-prompt"
                className="border-border bg-border/20 max-h-56 overflow-auto rounded-xl border p-3 text-xs whitespace-pre-wrap"
              >
                {prepared.prepared.request.messages
                  .map((message) => message.content)
                  .join("\n")}
              </pre>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
