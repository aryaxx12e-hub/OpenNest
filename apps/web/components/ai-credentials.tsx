"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import type { AiProviderConfig } from "@opennest/ai";
import {
  CredentialVaultError,
  type VaultEntryMetadata,
} from "@opennest/credential-vault";
import { useTranslations } from "@opennest/localization";
import { Badge, Button, Card, ConfirmDialog, Input, Label, Select } from "@opennest/ui";

import type { AiRuntime } from "@/lib/ai/runtime";
import { CredentialRuntimeError } from "@/lib/credentials/errors";
import type { CredentialRuntime } from "@/lib/credentials/runtime";
import type { SessionCredentialMetadata } from "@/lib/credentials/session-store";

export interface AiCredentialsProps {
  ai: AiRuntime;
  credentials: CredentialRuntime;
  refreshToken?: number;
}

const MIN_PASSPHRASE = 12;

function credentialErrorKey(error: unknown): string {
  if (error instanceof CredentialVaultError) {
    switch (error.code) {
      case "authentication_failed":
        return "ai.credentials.errors.wrongPassphrase";
      case "rate_limited":
        return "ai.credentials.errors.rateLimited";
      case "invalid_passphrase":
        return "ai.credentials.errors.passphraseTooShort";
      case "vault_locked":
      case "vault_session_expired":
        return "ai.credentials.errors.vaultLocked";
      case "vault_missing":
        return "ai.credentials.errors.vaultMissing";
      case "invalid_secret":
        return "ai.credentials.errors.secret";
      case "invalid_account_label":
      case "invalid_provider_id":
        return "ai.credentials.errors.required";
      default:
        return "ai.credentials.errors.generic";
    }
  }

  if (error instanceof CredentialRuntimeError) {
    switch (error.code) {
      case "vault_locked":
        return "ai.credentials.errors.vaultLocked";
      case "invalid_secret":
        return "ai.credentials.errors.secret";
      case "invalid_account_label":
      case "invalid_provider_id":
        return "ai.credentials.errors.required";
      default:
        return "ai.credentials.errors.generic";
    }
  }

  return "ai.credentials.errors.generic";
}

export function AiCredentials({ ai, credentials, refreshToken = 0 }: AiCredentialsProps) {
  const t = useTranslations();
  const [providers, setProviders] = useState<AiProviderConfig[]>([]);
  const [sessionCredentials, setSessionCredentials] = useState<
    SessionCredentialMetadata[]
  >([]);
  const [vaultExists, setVaultExists] = useState(false);
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [vaultEntries, setVaultEntries] = useState<VaultEntryMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deleteVaultOpen, setDeleteVaultOpen] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);

  const [sessionProvider, setSessionProvider] = useState("");
  const [sessionLabel, setSessionLabel] = useState("");
  const [sessionSecret, setSessionSecret] = useState("");

  const [setupPassphrase, setSetupPassphrase] = useState("");
  const [setupConfirmation, setSetupConfirmation] = useState("");
  const [setupAcknowledged, setSetupAcknowledged] = useState(false);

  const [unlockPassphrase, setUnlockPassphrase] = useState("");

  const [currentPassphrase, setCurrentPassphrase] = useState("");
  const [newPassphrase, setNewPassphrase] = useState("");
  const [newConfirmation, setNewConfirmation] = useState("");

  const [entryProvider, setEntryProvider] = useState("");
  const [entryLabel, setEntryLabel] = useState("");
  const [entrySecret, setEntrySecret] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editSecret, setEditSecret] = useState("");

  const load = useCallback(async (): Promise<{
    providers: AiProviderConfig[];
    session: SessionCredentialMetadata[];
    vaultExists: boolean;
    vaultUnlocked: boolean;
    vaultEntries: VaultEntryMetadata[];
  }> => {
    const [nextProviders, hasVault] = await Promise.all([
      ai.listProviders(),
      credentials.vault.hasVault(),
    ]);
    const sortedProviders = [...nextProviders].sort((left, right) =>
      left.label.localeCompare(right.label)
    );
    const vaultSession = credentials.getVaultSession();
    const entries =
      vaultSession === null ? [] : await credentials.vault.list(vaultSession);

    return {
      providers: sortedProviders,
      session: [...credentials.session.list()],
      vaultExists: hasVault,
      vaultUnlocked: vaultSession !== null,
      vaultEntries: [...entries],
    };
  }, [ai, credentials]);

  const apply = useCallback((snapshot: Awaited<ReturnType<typeof load>>) => {
    setProviders(snapshot.providers);
    setSessionCredentials(snapshot.session);
    setVaultExists(snapshot.vaultExists);
    setVaultUnlocked(snapshot.vaultUnlocked);
    setVaultEntries(snapshot.vaultEntries);
    setSessionProvider((current) =>
      snapshot.providers.some((provider) => provider.id === current)
        ? current
        : (snapshot.providers[0]?.id ?? "")
    );
    setEntryProvider((current) =>
      snapshot.providers.some((provider) => provider.id === current)
        ? current
        : (snapshot.providers[0]?.id ?? "")
    );
    setLoading(false);
  }, []);

  const reload = useCallback(async () => {
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
          setError("ai.credentials.errors.generic");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apply, load, refreshToken]);

  async function run(
    action: string,
    operation: () => Promise<void>,
    successKey: string | null = null
  ): Promise<boolean> {
    if (busy !== null) {
      return false;
    }

    setBusy(action);
    setError(null);
    setSuccess(null);

    try {
      await operation();
      await reload();

      if (successKey !== null) {
        setSuccess(successKey);
      }

      return true;
    } catch (caught) {
      setError(credentialErrorKey(caught));
      return false;
    } finally {
      setBusy(null);
    }
  }

  function providerLabel(providerId: string): string {
    return providers.find((provider) => provider.id === providerId)?.label ?? providerId;
  }

  function providerIsLinked(providerId: string): boolean {
    return providers.some((provider) => provider.id === providerId);
  }

  async function addSessionCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (
      sessionProvider.length === 0 ||
      sessionLabel.trim().length === 0 ||
      sessionSecret.length === 0
    ) {
      setError("ai.credentials.errors.required");
      return;
    }

    const ok = await run(
      "session-add",
      async () => {
        await credentials.createSessionCredential({
          providerId: sessionProvider,
          accountLabel: sessionLabel.trim(),
          secret: sessionSecret,
        });
      },
      "ai.credentials.saved"
    );

    if (ok) {
      setSessionLabel("");
      setSessionSecret("");
    }
  }

  function removeSessionCredential(id: string) {
    void run("session-remove", async () => {
      credentials.session.remove(id);
    });
  }

  async function setupVault(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (setupPassphrase.length < MIN_PASSPHRASE) {
      setError("ai.credentials.errors.passphraseTooShort");
      return;
    }

    if (setupPassphrase !== setupConfirmation) {
      setError("ai.credentials.errors.passphraseMismatch");
      return;
    }

    if (!setupAcknowledged) {
      setError("ai.credentials.errors.setupAck");
      return;
    }

    const ok = await run(
      "vault-setup",
      async () => {
        await credentials.setupVault(setupPassphrase);
      },
      "ai.credentials.unlocked"
    );

    if (ok) {
      setSetupPassphrase("");
      setSetupConfirmation("");
      setSetupAcknowledged(false);
    }
  }

  async function unlockVault(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (unlockPassphrase.length === 0) {
      setError("ai.credentials.errors.required");
      return;
    }

    const ok = await run(
      "vault-unlock",
      async () => {
        await credentials.unlockVault(unlockPassphrase);
      },
      "ai.credentials.unlocked"
    );

    if (ok) {
      setUnlockPassphrase("");
    }
  }

  function lockVault() {
    void run("vault-lock", async () => {
      credentials.lockVault();
    });
  }

  async function changeVaultPassphrase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (currentPassphrase.length === 0) {
      setError("ai.credentials.errors.required");
      return;
    }

    if (newPassphrase.length < MIN_PASSPHRASE) {
      setError("ai.credentials.errors.passphraseTooShort");
      return;
    }

    if (newPassphrase !== newConfirmation) {
      setError("ai.credentials.errors.passphraseMismatch");
      return;
    }

    const vaultSession = credentials.getVaultSession();

    if (vaultSession === null) {
      setError("ai.credentials.errors.vaultLocked");
      return;
    }

    const ok = await run(
      "vault-change",
      async () => {
        await credentials.vault.changePassphrase(
          vaultSession,
          currentPassphrase,
          newPassphrase
        );
      },
      "ai.credentials.changeSuccess"
    );

    if (ok) {
      setCurrentPassphrase("");
      setNewPassphrase("");
      setNewConfirmation("");
    }
  }

  function rotateVault() {
    const vaultSession = credentials.getVaultSession();

    if (vaultSession === null) {
      setRotateOpen(false);
      setError("ai.credentials.errors.vaultLocked");
      return;
    }

    void (async () => {
      const ok = await run(
        "vault-rotate",
        async () => {
          await credentials.vault.rotate(vaultSession);
        },
        "ai.credentials.rotateSuccess"
      );

      if (ok) {
        setRotateOpen(false);
      }
    })();
  }

  function deleteVault() {
    void (async () => {
      const ok = await run(
        "vault-delete",
        async () => {
          await credentials.vault.delete();
          credentials.lockVault();
        },
        "ai.credentials.deleted"
      );

      if (ok) {
        setDeleteVaultOpen(false);
      }
    })();
  }

  async function addVaultEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const vaultSession = credentials.getVaultSession();

    if (vaultSession === null) {
      setError("ai.credentials.errors.vaultLocked");
      return;
    }

    if (
      entryProvider.length === 0 ||
      entryLabel.trim().length === 0 ||
      entrySecret.length === 0
    ) {
      setError("ai.credentials.errors.required");
      return;
    }

    const ok = await run(
      "entry-add",
      async () => {
        await credentials.vault.create(vaultSession, {
          providerId: entryProvider,
          accountLabel: entryLabel.trim(),
          secret: entrySecret,
        });
      },
      "ai.credentials.entrySaved"
    );

    if (ok) {
      setEntryLabel("");
      setEntrySecret("");
    }
  }

  function startEditing(entry: VaultEntryMetadata) {
    setEditingId(entry.id);
    setEditLabel(entry.accountLabel);
    setEditSecret("");
    setError(null);
    setSuccess(null);
  }

  async function updateVaultEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (editingId === null) {
      return;
    }

    const vaultSession = credentials.getVaultSession();

    if (vaultSession === null) {
      setError("ai.credentials.errors.vaultLocked");
      return;
    }

    if (editLabel.trim().length === 0) {
      setError("ai.credentials.errors.required");
      return;
    }

    const ok = await run(
      "entry-update",
      async () => {
        await credentials.vault.update(vaultSession, editingId, {
          accountLabel: editLabel.trim(),
          ...(editSecret.length === 0 ? {} : { secret: editSecret }),
        });
      },
      "ai.credentials.entrySaved"
    );

    if (ok) {
      setEditingId(null);
      setEditLabel("");
      setEditSecret("");
    }
  }

  function removeVaultEntry(entryId: string) {
    const vaultSession = credentials.getVaultSession();

    if (vaultSession === null) {
      setError("ai.credentials.errors.vaultLocked");
      return;
    }

    void run(
      "entry-remove",
      async () => {
        await credentials.vault.remove(vaultSession, entryId);
      },
      "ai.credentials.entryRemoved"
    );
  }

  if (loading) {
    return (
      <Card className="space-y-2">
        <h2 className="text-lg font-semibold">{t("ai.credentials.title")}</h2>
        <p className="text-muted text-sm">{t("ai.credentials.loading")}</p>
      </Card>
    );
  }

  return (
    <Card className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t("ai.credentials.title")}</h2>
        <p className="text-muted text-sm leading-6">{t("ai.credentials.description")}</p>
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

      <section className="space-y-3">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">{t("ai.credentials.sessionTitle")}</h3>
          <p className="text-muted text-sm leading-6">
            {t("ai.credentials.sessionDescription")}
          </p>
        </div>

        {providers.length === 0 ? (
          <p className="text-muted text-sm">{t("ai.credentials.noProviders")}</p>
        ) : (
          <form className="space-y-3" onSubmit={addSessionCredential} noValidate>
            <div className="space-y-1">
              <Label htmlFor="ai-session-provider">{t("ai.credentials.provider")}</Label>
              <Select
                id="ai-session-provider"
                data-testid="session-provider"
                value={sessionProvider}
                disabled={busy !== null}
                onChange={(event) => {
                  setSessionProvider(event.target.value);
                  setError(null);
                }}
              >
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ai-session-label">{t("ai.credentials.accountLabel")}</Label>
              <Input
                id="ai-session-label"
                data-testid="session-label"
                value={sessionLabel}
                maxLength={120}
                disabled={busy !== null}
                onChange={(event) => {
                  setSessionLabel(event.target.value);
                  setError(null);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ai-session-secret">{t("ai.credentials.secret")}</Label>
              <Input
                id="ai-session-secret"
                data-testid="session-secret"
                type="password"
                autoComplete="new-password"
                value={sessionSecret}
                disabled={busy !== null}
                onChange={(event) => {
                  setSessionSecret(event.target.value);
                  setError(null);
                }}
              />
              <p className="text-muted text-xs">{t("ai.credentials.secretHint")}</p>
            </div>
            <Button type="submit" loading={busy === "session-add"}>
              {t("ai.credentials.save")}
            </Button>
          </form>
        )}

        {sessionCredentials.length === 0 ? (
          <p className="text-muted text-sm">{t("ai.credentials.sessionEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {sessionCredentials.map((credential) => (
              <li
                key={credential.id}
                className="border-border flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3"
              >
                <div className="space-y-1">
                  <p className="font-medium">{credential.accountLabel}</p>
                  <p className="text-muted text-xs">
                    {providerLabel(credential.providerId)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid={`remove-session-${credential.id}`}
                  disabled={busy !== null}
                  onClick={() => removeSessionCredential(credential.id)}
                >
                  {t("ai.credentials.remove")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="border-border space-y-3 border-t pt-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <h3 className="text-base font-semibold">{t("ai.credentials.vaultTitle")}</h3>
            <p className="text-muted text-sm leading-6">
              {t("ai.credentials.vaultDescription")}
            </p>
          </div>
          {vaultExists ? (
            <Badge tone={vaultUnlocked ? "success" : "warning"}>
              {vaultUnlocked ? t("ai.credentials.unlocked") : t("ai.credentials.locked")}
            </Badge>
          ) : null}
        </div>

        {!vaultExists ? (
          <form className="space-y-3" onSubmit={setupVault} noValidate>
            <div className="border-border bg-border/20 space-y-2 rounded-xl border p-3">
              <h4 className="text-sm font-semibold">{t("ai.credentials.setupTitle")}</h4>
              <p className="text-muted text-xs leading-5">
                {t("ai.credentials.setupWarning")}
              </p>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  data-testid="vault-setup-ack"
                  checked={setupAcknowledged}
                  disabled={busy !== null}
                  onChange={(event) => {
                    setSetupAcknowledged(event.target.checked);
                    setError(null);
                  }}
                  className="accent-primary mt-1 size-4"
                />
                <span>{t("ai.credentials.setupAck")}</span>
              </label>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ai-vault-setup-passphrase">
                {t("ai.credentials.setupPassphrase")}
              </Label>
              <Input
                id="ai-vault-setup-passphrase"
                data-testid="vault-setup-passphrase"
                type="password"
                autoComplete="new-password"
                value={setupPassphrase}
                disabled={busy !== null}
                onChange={(event) => {
                  setSetupPassphrase(event.target.value);
                  setError(null);
                }}
              />
              <p className="text-muted text-xs">{t("ai.credentials.passphraseHint")}</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ai-vault-setup-confirm">
                {t("ai.credentials.setupConfirm")}
              </Label>
              <Input
                id="ai-vault-setup-confirm"
                data-testid="vault-setup-confirm"
                type="password"
                autoComplete="new-password"
                value={setupConfirmation}
                disabled={busy !== null}
                onChange={(event) => {
                  setSetupConfirmation(event.target.value);
                  setError(null);
                }}
              />
            </div>
            <Button type="submit" loading={busy === "vault-setup"}>
              {t("ai.credentials.setupAction")}
            </Button>
          </form>
        ) : null}

        {vaultExists && !vaultUnlocked ? (
          <form className="space-y-3" onSubmit={unlockVault} noValidate>
            <p className="text-muted text-sm">{t("ai.credentials.locked")}</p>
            <div className="space-y-1">
              <Label htmlFor="ai-vault-unlock-passphrase">
                {t("ai.credentials.unlockPassphrase")}
              </Label>
              <Input
                id="ai-vault-unlock-passphrase"
                data-testid="vault-unlock-passphrase"
                type="password"
                autoComplete="current-password"
                value={unlockPassphrase}
                disabled={busy !== null}
                onChange={(event) => {
                  setUnlockPassphrase(event.target.value);
                  setError(null);
                }}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={busy === "vault-unlock"}>
                {t("ai.credentials.unlockAction")}
              </Button>
              <Button
                variant="danger"
                disabled={busy !== null}
                onClick={() => setDeleteVaultOpen(true)}
              >
                {t("ai.credentials.deleteAction")}
              </Button>
            </div>
          </form>
        ) : null}

        {vaultUnlocked ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={busy !== null} onClick={lockVault}>
                {t("ai.credentials.lockAction")}
              </Button>
              <Button
                variant="secondary"
                disabled={busy !== null}
                onClick={() => setRotateOpen(true)}
              >
                {t("ai.credentials.rotateAction")}
              </Button>
              <Button
                variant="danger"
                disabled={busy !== null}
                onClick={() => setDeleteVaultOpen(true)}
              >
                {t("ai.credentials.deleteAction")}
              </Button>
            </div>

            <details className="border-border rounded-xl border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                {t("ai.credentials.changeTitle")}
              </summary>
              <form
                className="mt-3 space-y-3"
                onSubmit={changeVaultPassphrase}
                noValidate
              >
                <div className="space-y-1">
                  <Label htmlFor="ai-vault-current">
                    {t("ai.credentials.currentPassphrase")}
                  </Label>
                  <Input
                    id="ai-vault-current"
                    type="password"
                    autoComplete="current-password"
                    value={currentPassphrase}
                    disabled={busy !== null}
                    onChange={(event) => {
                      setCurrentPassphrase(event.target.value);
                      setError(null);
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ai-vault-new">
                    {t("ai.credentials.newPassphrase")}
                  </Label>
                  <Input
                    id="ai-vault-new"
                    type="password"
                    autoComplete="new-password"
                    value={newPassphrase}
                    disabled={busy !== null}
                    onChange={(event) => {
                      setNewPassphrase(event.target.value);
                      setError(null);
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ai-vault-confirm">
                    {t("ai.credentials.confirmPassphrase")}
                  </Label>
                  <Input
                    id="ai-vault-confirm"
                    type="password"
                    autoComplete="new-password"
                    value={newConfirmation}
                    disabled={busy !== null}
                    onChange={(event) => {
                      setNewConfirmation(event.target.value);
                      setError(null);
                    }}
                  />
                </div>
                <Button type="submit" loading={busy === "vault-change"}>
                  {t("ai.credentials.changeAction")}
                </Button>
              </form>
            </details>

            <div className="space-y-3">
              <h4 className="text-sm font-semibold">
                {t("ai.credentials.entriesTitle")}
              </h4>

              {providers.length === 0 ? (
                <p className="text-muted text-sm">{t("ai.credentials.noProviders")}</p>
              ) : (
                <form className="space-y-3" onSubmit={addVaultEntry} noValidate>
                  <div className="space-y-1">
                    <Label htmlFor="ai-entry-provider">
                      {t("ai.credentials.provider")}
                    </Label>
                    <Select
                      id="ai-entry-provider"
                      data-testid="vault-entry-provider"
                      value={entryProvider}
                      disabled={busy !== null}
                      onChange={(event) => {
                        setEntryProvider(event.target.value);
                        setError(null);
                      }}
                    >
                      {providers.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="ai-entry-label">
                      {t("ai.credentials.accountLabel")}
                    </Label>
                    <Input
                      id="ai-entry-label"
                      data-testid="vault-entry-label"
                      value={entryLabel}
                      maxLength={120}
                      disabled={busy !== null}
                      onChange={(event) => {
                        setEntryLabel(event.target.value);
                        setError(null);
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="ai-entry-secret">{t("ai.credentials.secret")}</Label>
                    <Input
                      id="ai-entry-secret"
                      data-testid="vault-entry-secret"
                      type="password"
                      autoComplete="new-password"
                      value={entrySecret}
                      disabled={busy !== null}
                      onChange={(event) => {
                        setEntrySecret(event.target.value);
                        setError(null);
                      }}
                    />
                  </div>
                  <Button type="submit" loading={busy === "entry-add"}>
                    {t("ai.credentials.addEntry")}
                  </Button>
                </form>
              )}

              {vaultEntries.length === 0 ? (
                <p className="text-muted text-sm">{t("ai.credentials.entriesEmpty")}</p>
              ) : (
                <ul className="space-y-2">
                  {vaultEntries.map((entry) => (
                    <li
                      key={entry.id}
                      data-testid={`vault-entry-${entry.id}`}
                      className="border-border space-y-3 rounded-xl border p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="space-y-1">
                          <p className="font-medium">{entry.accountLabel}</p>
                          <p className="text-muted text-xs">
                            {providerLabel(entry.providerId)}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {providerIsLinked(entry.providerId) ? null : (
                            <Badge tone="warning">{t("ai.credentials.unlinked")}</Badge>
                          )}
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy !== null}
                            onClick={() => startEditing(entry)}
                          >
                            {t("ai.credentials.editEntry")}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy !== null}
                            onClick={() => removeVaultEntry(entry.id)}
                          >
                            {t("ai.credentials.removeEntry")}
                          </Button>
                        </div>
                      </div>

                      {editingId === entry.id ? (
                        <form
                          className="space-y-3"
                          onSubmit={updateVaultEntry}
                          noValidate
                        >
                          <div className="space-y-1">
                            <Label htmlFor="ai-edit-label">
                              {t("ai.credentials.accountLabel")}
                            </Label>
                            <Input
                              id="ai-edit-label"
                              data-testid="vault-edit-label"
                              value={editLabel}
                              maxLength={120}
                              disabled={busy !== null}
                              onChange={(event) => {
                                setEditLabel(event.target.value);
                                setError(null);
                              }}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="ai-edit-secret">
                              {t("ai.credentials.secret")}
                            </Label>
                            <Input
                              id="ai-edit-secret"
                              data-testid="vault-edit-secret"
                              type="password"
                              autoComplete="new-password"
                              value={editSecret}
                              placeholder={t("ai.credentials.optional")}
                              disabled={busy !== null}
                              onChange={(event) => {
                                setEditSecret(event.target.value);
                                setError(null);
                              }}
                            />
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button type="submit" loading={busy === "entry-update"}>
                              {t("ai.credentials.updateEntry")}
                            </Button>
                            <Button
                              variant="secondary"
                              disabled={busy !== null}
                              onClick={() => {
                                setEditingId(null);
                                setEditLabel("");
                                setEditSecret("");
                              }}
                            >
                              {t("common.cancel")}
                            </Button>
                          </div>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </section>

      <ConfirmDialog
        open={deleteVaultOpen}
        title={t("ai.credentials.deleteTitle")}
        description={t("ai.credentials.deleteDescription")}
        confirmLabel={t("ai.credentials.deleteConfirm")}
        cancelLabel={t("common.cancel")}
        busy={busy === "vault-delete"}
        destructive
        onConfirm={deleteVault}
        onClose={() => {
          if (busy !== "vault-delete") {
            setDeleteVaultOpen(false);
          }
        }}
      />

      <ConfirmDialog
        open={rotateOpen}
        title={t("ai.credentials.rotateConfirmTitle")}
        description={t("ai.credentials.rotateConfirmDescription")}
        confirmLabel={t("ai.credentials.rotateAction")}
        cancelLabel={t("common.cancel")}
        busy={busy === "vault-rotate"}
        onConfirm={rotateVault}
        onClose={() => {
          if (busy !== "vault-rotate") {
            setRotateOpen(false);
          }
        }}
      />
    </Card>
  );
}
