"use client";

import { useId, useState, type FormEvent } from "react";

import {
  AI_PROVIDER_PRESETS,
  AiError,
  isLoopbackEndpoint,
  validateProviderInput,
  type AiProviderConfig,
  type AiProviderInput,
  type AiProviderKind,
  type AiProviderPreset,
} from "@opennest/ai";
import { useTranslations } from "@opennest/localization";
import { Button, Dialog, Input, Label, Select, Textarea } from "@opennest/ui";

export interface AiProviderDialogProps {
  open: boolean;
  provider: AiProviderConfig | null;
  onSave: (input: AiProviderInput) => Promise<void>;
  onClose: () => void;
}

interface FormState {
  preset: AiProviderPreset["id"];
  label: string;
  kind: AiProviderKind;
  endpoint: string;
  models: string;
  auth: AiProviderConfig["auth"];
  dataPolicyUrl: string;
  maxContextTokens: string;
  maxOutputTokens: string;
  capabilities: AiProviderConfig["capabilities"];
}

function defaultPreset(): AiProviderPreset {
  const preset = AI_PROVIDER_PRESETS[0];

  if (preset === undefined) {
    throw new Error("AI provider presets are not configured.");
  }

  return preset;
}

function stateFromPreset(preset: AiProviderPreset): FormState {
  return {
    preset: preset.id,
    label: preset.config.label,
    kind: preset.config.kind,
    endpoint: preset.config.endpoint,
    models: preset.config.models.join(", "),
    auth: preset.config.auth,
    dataPolicyUrl: preset.config.dataPolicyUrl ?? "",
    maxContextTokens:
      preset.config.maxContextTokens === null
        ? ""
        : String(preset.config.maxContextTokens),
    maxOutputTokens:
      preset.config.maxOutputTokens === null ? "" : String(preset.config.maxOutputTokens),
    capabilities: preset.config.capabilities,
  };
}

function stateFromProvider(provider: AiProviderConfig): FormState {
  return {
    preset: "custom",
    label: provider.label,
    kind: provider.kind,
    endpoint: provider.endpoint,
    models: provider.models.join(", "),
    auth: provider.auth,
    dataPolicyUrl: provider.dataPolicyUrl ?? "",
    maxContextTokens:
      provider.maxContextTokens === null ? "" : String(provider.maxContextTokens),
    maxOutputTokens:
      provider.maxOutputTokens === null ? "" : String(provider.maxOutputTokens),
    capabilities: provider.capabilities,
  };
}

function parseModels(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((model) => model.trim())
    .filter((model) => model.length > 0);
}

function parseLimit(value: string): number | null {
  if (value.trim().length === 0) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function providerErrorKey(
  error: unknown,
  kind: AiProviderKind,
  endpoint: string
): string {
  if (error instanceof AiError) {
    switch (error.code) {
      case "invalid_label":
        return "ai.providers.errors.label";
      case "invalid_models":
      case "duplicate_model":
        return "ai.providers.errors.models";
      case "invalid_token_limit":
        return "ai.providers.errors.tokens";
      case "invalid_data_policy_url":
        return "ai.providers.errors.dataPolicy";
      case "invalid_endpoint":
        if (kind === "local") {
          return "ai.providers.errors.localHost";
        }

        if (endpoint.trim().toLowerCase().startsWith("http://")) {
          return "ai.providers.errors.remoteHttp";
        }

        return "ai.providers.errors.endpoint";
      case "storage_failed":
        return "ai.providers.saveError";
      default:
        return "ai.providers.errors.generic";
    }
  }

  return "ai.providers.errors.generic";
}

export function AiProviderDialog({
  open,
  provider,
  onSave,
  onClose,
}: AiProviderDialogProps) {
  const t = useTranslations();
  const ids = useId();
  const [form, setForm] = useState<FormState>(() =>
    provider === null ? stateFromPreset(defaultPreset()) : stateFromProvider(provider)
  );
  const [warningAcknowledged, setWarningAcknowledged] = useState(provider !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const warningVisible = form.kind === "local" || isLoopbackEndpoint(form.endpoint);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
  }

  function choosePreset(id: string) {
    const preset = AI_PROVIDER_PRESETS.find((candidate) => candidate.id === id);

    if (preset === undefined) {
      return;
    }

    setForm(stateFromPreset(preset));
    setWarningAcknowledged(false);
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (busy) {
      return;
    }

    if (warningVisible && !warningAcknowledged) {
      setError("ai.providers.errors.localWarning");
      return;
    }

    const input: AiProviderInput = {
      label: form.label,
      kind: form.kind,
      adapter: "openai-compatible",
      endpoint: form.endpoint.trim(),
      models: parseModels(form.models),
      capabilities: form.capabilities,
      auth: form.auth,
      dataPolicyUrl:
        form.dataPolicyUrl.trim().length === 0 ? null : form.dataPolicyUrl.trim(),
      maxContextTokens: parseLimit(form.maxContextTokens),
      maxOutputTokens: parseLimit(form.maxOutputTokens),
    };

    setBusy(true);
    setError(null);

    try {
      validateProviderInput(input);
      await onSave(input);
    } catch (caught) {
      setError(providerErrorKey(caught, form.kind, form.endpoint));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      title={provider === null ? t("ai.providers.add") : t("ai.providers.edit")}
      description={t("ai.providers.description")}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={`${ids}-form`} loading={busy}>
            {busy ? t("ai.providers.saving") : t("ai.providers.save")}
          </Button>
        </>
      }
    >
      <form id={`${ids}-form`} className="space-y-3" onSubmit={submit} noValidate>
        <div className="space-y-1">
          <Label htmlFor={`${ids}-preset`}>{t("ai.providers.preset")}</Label>
          <Select
            id={`${ids}-preset`}
            data-testid="provider-preset"
            value={form.preset}
            disabled={busy}
            onChange={(event) => choosePreset(event.target.value)}
          >
            {AI_PROVIDER_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor={`${ids}-label`}>{t("ai.providers.label")}</Label>
          <Input
            id={`${ids}-label`}
            data-testid="provider-label"
            value={form.label}
            maxLength={120}
            disabled={busy}
            onChange={(event) => update("label", event.target.value)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`${ids}-kind`}>{t("ai.providers.kind")}</Label>
            <Select
              id={`${ids}-kind`}
              data-testid="provider-kind"
              value={form.kind}
              disabled={busy}
              onChange={(event) => {
                update("kind", event.target.value as AiProviderKind);
                setWarningAcknowledged(false);
              }}
            >
              <option value="remote">{t("ai.providers.remote")}</option>
              <option value="local">{t("ai.providers.local")}</option>
              <option value="custom">{t("ai.providers.custom")}</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${ids}-auth`}>{t("ai.providers.auth")}</Label>
            <Select
              id={`${ids}-auth`}
              value={form.auth}
              disabled={busy}
              onChange={(event) =>
                update("auth", event.target.value as AiProviderConfig["auth"])
              }
            >
              <option value="none">{t("ai.providers.authNone")}</option>
              <option value="bearer">{t("ai.providers.authBearer")}</option>
              <option value="x-api-key">{t("ai.providers.authApiKey")}</option>
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor={`${ids}-endpoint`}>{t("ai.providers.endpoint")}</Label>
          <Input
            id={`${ids}-endpoint`}
            data-testid="provider-endpoint"
            type="url"
            value={form.endpoint}
            disabled={busy}
            onChange={(event) => {
              update("endpoint", event.target.value);
              setWarningAcknowledged(false);
            }}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor={`${ids}-models`}>{t("ai.providers.modelsLabel")}</Label>
          <Textarea
            id={`${ids}-models`}
            data-testid="provider-models"
            rows={2}
            value={form.models}
            disabled={busy}
            onChange={(event) => update("models", event.target.value)}
          />
          <p className="text-muted text-xs">{t("ai.providers.modelsHint")}</p>
        </div>

        <div className="space-y-1">
          <Label htmlFor={`${ids}-data-policy`}>{t("ai.providers.dataPolicyUrl")}</Label>
          <Input
            id={`${ids}-data-policy`}
            data-testid="provider-data-policy"
            type="url"
            value={form.dataPolicyUrl}
            placeholder={t("ai.providers.optional")}
            disabled={busy}
            onChange={(event) => update("dataPolicyUrl", event.target.value)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`${ids}-context`}>{t("ai.providers.maxContext")}</Label>
            <Input
              id={`${ids}-context`}
              type="number"
              min={1}
              value={form.maxContextTokens}
              placeholder={t("ai.providers.optional")}
              disabled={busy}
              onChange={(event) => update("maxContextTokens", event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${ids}-output`}>{t("ai.providers.maxOutput")}</Label>
            <Input
              id={`${ids}-output`}
              type="number"
              min={1}
              value={form.maxOutputTokens}
              placeholder={t("ai.providers.optional")}
              disabled={busy}
              onChange={(event) => update("maxOutputTokens", event.target.value)}
            />
          </div>
        </div>

        {warningVisible ? (
          <div className="border-border bg-border/20 rounded-control space-y-2 border p-3">
            <p className="text-sm font-medium">{t("ai.providers.localWarningTitle")}</p>
            <p className="text-muted text-xs leading-5">
              {t("ai.providers.localWarningBody")}
            </p>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                data-testid="provider-local-warning"
                checked={warningAcknowledged}
                disabled={busy}
                onChange={(event) => {
                  setWarningAcknowledged(event.target.checked);
                  setError(null);
                }}
                className="accent-primary mt-1 size-4"
              />
              <span>{t("ai.providers.localWarningAck")}</span>
            </label>
          </div>
        ) : null}

        {error === null ? null : (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {t(error)}
          </p>
        )}
      </form>
    </Dialog>
  );
}
