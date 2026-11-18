"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { AiProviderConfig, AiProviderInput } from "@opennest/ai";
import { useTranslations } from "@opennest/localization";
import { Badge, Button, Card, ConfirmDialog } from "@opennest/ui";

import { AiCredentials } from "@/components/ai-credentials";
import { AiProviderDialog } from "@/components/ai-provider-dialog";
import type { AiRuntime } from "@/lib/ai/runtime";
import type { CredentialRuntime } from "@/lib/credentials/runtime";

export interface AiSettingsProps {
  ai: AiRuntime;
  credentials: CredentialRuntime;
}

type Busy = "toggle" | "delete" | null;

function kindKey(provider: AiProviderConfig): string {
  switch (provider.kind) {
    case "local":
      return "ai.providers.local";
    case "remote":
      return "ai.providers.remote";
    default:
      return "ai.providers.custom";
  }
}

export function AiSettings({ ai, credentials }: AiSettingsProps) {
  const t = useTranslations();
  const [enabled, setEnabled] = useState(false);
  const [providers, setProviders] = useState<AiProviderConfig[]>([]);
  const [dialog, setDialog] = useState<{ provider: AiProviderConfig | null } | null>(
    null
  );
  const [deleteTarget, setDeleteTarget] = useState<AiProviderConfig | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const reloadVersion = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    const version = ++reloadVersion.current;
    const [nextEnabled, nextProviders] = await Promise.all([
      ai.isEnabled(),
      ai.listProviders(),
    ]);

    if (!mounted.current || version !== reloadVersion.current) {
      return;
    }

    setEnabled(nextEnabled);
    setProviders(
      [...nextProviders].sort((left, right) => left.label.localeCompare(right.label))
    );
  }, [ai]);

  useEffect(() => {
    void reload().catch(() => setError("ai.providers.errors.generic"));
  }, [reload]);

  async function toggle(next: boolean) {
    if (busy !== null) {
      return;
    }

    setBusy("toggle");
    setError(null);
    setSuccess(null);
    reloadVersion.current += 1;

    try {
      await ai.setEnabled(next);
      if (mounted.current) {
        setEnabled(next);
      }

      setSuccess(next ? "ai.providers.toggleOn" : "ai.providers.toggleOff");
    } catch {
      setError("ai.providers.toggleError");
    } finally {
      setBusy(null);
    }
  }

  async function saveProvider(input: AiProviderInput) {
    if (dialog === null) {
      return;
    }

    if (dialog.provider === null) {
      await ai.createProvider(input);
    } else {
      await ai.updateProvider(dialog.provider.id, input);
    }

    await reload();
    setRefreshToken((current) => current + 1);
    setDialog(null);
    setSuccess("ai.providers.created");
    setError(null);
  }

  async function deleteProvider() {
    if (deleteTarget === null || busy !== null) {
      return;
    }

    setBusy("delete");
    setError(null);
    setSuccess(null);

    try {
      await ai.removeProvider(deleteTarget.id);
      credentials.session.removeProvider(deleteTarget.id);
      await reload();
      setRefreshToken((current) => current + 1);
      setDeleteTarget(null);
      setSuccess("ai.providers.deleted");
    } catch {
      setError("ai.providers.saveError");
    } finally {
      setBusy(null);
    }
  }

  const consoleDisabled = !enabled;

  return (
    <section className="space-y-4">
      <Card className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{t("ai.providers.title")}</h2>
            <p className="text-muted text-sm leading-6">
              {t("ai.providers.description")}
            </p>
          </div>
          <Badge tone={enabled ? "success" : "neutral"}>
            {enabled ? t("ai.providers.toggleOn") : t("ai.providers.toggleOff")}
          </Badge>
        </div>

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            role="switch"
            data-testid="ai-enabled"
            aria-label={t("ai.providers.toggleLabel")}
            className="accent-primary mt-1 size-4"
            checked={enabled}
            disabled={busy === "toggle"}
            onChange={(event) => void toggle(event.target.checked)}
          />
          <span className="space-y-1">
            <span className="block font-medium">{t("ai.providers.toggleLabel")}</span>
            <span className="text-muted block text-xs leading-5">
              {t("ai.providers.toggleDescription")}
            </span>
          </span>
        </label>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setError(null);
              setSuccess(null);
              setDialog({ provider: null });
            }}
          >
            {t("ai.providers.add")}
          </Button>
          <Link
            href="/ai"
            aria-disabled={consoleDisabled ? true : undefined}
            tabIndex={consoleDisabled ? -1 : undefined}
            title={consoleDisabled ? t("ai.providers.consoleDisabled") : undefined}
            onClick={(event) => {
              if (consoleDisabled) {
                event.preventDefault();
              }
            }}
            className={
              consoleDisabled
                ? "text-muted pointer-events-none inline-flex min-h-11 items-center text-sm font-medium underline-offset-4"
                : "text-primary inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
            }
          >
            {t("ai.providers.console")}
          </Link>
        </div>

        {error === null ? null : (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {t(error)}
          </p>
        )}
        {success === null ? null : (
          <p role="status" className="text-muted text-sm">
            {t(success)}
          </p>
        )}

        {providers.length === 0 ? (
          <p className="text-muted text-sm">{t("ai.providers.empty")}</p>
        ) : (
          <ul className="space-y-2">
            {providers.map((provider) => (
              <li
                key={provider.id}
                data-testid={`provider-row-${provider.id}`}
                className="border-border flex flex-wrap items-start justify-between gap-3 rounded-xl border p-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{provider.label}</span>
                    <Badge tone="neutral">{t(kindKey(provider))}</Badge>
                  </div>
                  <p className="text-muted text-xs break-all">{provider.endpoint}</p>
                  <p className="text-muted text-xs">{provider.models.join(", ")}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    data-testid={`edit-provider-${provider.id}`}
                    onClick={() => {
                      setError(null);
                      setSuccess(null);
                      setDialog({ provider });
                    }}
                  >
                    {t("ai.providers.edit")}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    data-testid={`delete-provider-${provider.id}`}
                    onClick={() => {
                      setError(null);
                      setSuccess(null);
                      setDeleteTarget(provider);
                    }}
                  >
                    {t("ai.providers.delete")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <AiCredentials ai={ai} credentials={credentials} refreshToken={refreshToken} />

      {dialog === null ? null : (
        <AiProviderDialog
          key={dialog.provider?.id ?? "new"}
          open
          provider={dialog.provider}
          onSave={saveProvider}
          onClose={() => setDialog(null)}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("ai.providers.deleteTitle")}
        description={t("ai.providers.deleteDescription")}
        confirmLabel={t("ai.providers.deleteConfirm")}
        cancelLabel={t("common.cancel")}
        busy={busy === "delete"}
        destructive
        onConfirm={() => void deleteProvider()}
        onClose={() => {
          if (busy !== "delete") {
            setDeleteTarget(null);
          }
        }}
      />
    </section>
  );
}
