"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ChangeEvent } from "react";

import {
  EXTENSION_MAX_PACKAGE_BYTES,
  ExtensionError,
  type ExtensionCapability,
  type ExtensionRegistry,
  type InstallPreview,
  type StoredExtension,
} from "@opennest/extensions";
import { useTranslations } from "@opennest/localization";
import {
  ArchiveIcon,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Input,
  Label,
  Skeleton,
} from "@opennest/ui";

import { ExtensionInstallDialog } from "@/components/extension-install-dialog";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { useAppData } from "@/lib/data/app-data-provider";
import { extensionCapabilityKey, extensionErrorKey } from "@/lib/extensions/messages";

export interface ExtensionsViewRuntime {
  readonly registry: Pick<ExtensionRegistry, "list" | "prepareInstall" | "install">;
  readonly setEnabled: (id: string, enabled: boolean) => Promise<StoredExtension>;
  readonly uninstall: (id: string) => Promise<void>;
  readonly setSafeMode: (enabled: boolean) => Promise<void>;
  readonly getSafeMode: () => Promise<boolean>;
}

export function ExtensionsViewRoute() {
  const { extensions } = useAppData();

  return <ExtensionsView extensions={extensions} />;
}

export interface ExtensionsViewProps {
  readonly extensions: ExtensionsViewRuntime;
}

export function ExtensionsView({ extensions }: ExtensionsViewProps) {
  const t = useTranslations();
  const [records, setRecords] = useState<readonly StoredExtension[]>([]);
  const [safeMode, setSafeMode] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [safeModeBusy, setSafeModeBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [preview, setPreview] = useState<InstallPreview | null>(null);
  const [installing, setInstalling] = useState(false);
  const [pendingUninstall, setPendingUninstall] = useState<StoredExtension | null>(null);

  const load = useCallback(async () => {
    const [nextRecords, nextSafeMode] = await Promise.all([
      extensions.registry.list(),
      extensions.getSafeMode(),
    ]);

    setRecords(nextRecords);
    setSafeMode(nextSafeMode);
    setLoaded(true);
    setLoadError(null);
  }, [extensions]);

  useEffect(() => {
    let active = true;

    Promise.all([extensions.registry.list(), extensions.getSafeMode()])
      .then(([nextRecords, nextSafeMode]) => {
        if (active) {
          setRecords(nextRecords);
          setSafeMode(nextSafeMode);
          setLoaded(true);
          setLoadError(null);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(extensionErrorKey(error));
          setLoaded(true);
        }
      });

    return () => {
      active = false;
    };
  }, [extensions]);

  async function run(action: () => Promise<void>, success: string | null = null) {
    setActionError(null);
    setNotice(null);

    try {
      await action();
      await load();

      if (success !== null) {
        setNotice(success);
      }
    } catch (error) {
      setActionError(extensionErrorKey(error));
    }
  }

  async function toggle(record: StoredExtension, enabled: boolean) {
    setBusyId(record.id);
    await run(() => extensions.setEnabled(record.id, enabled).then(() => undefined));
    setBusyId(null);
  }

  async function uninstall(record: StoredExtension) {
    setBusyId(record.id);
    await run(() => extensions.uninstall(record.id), "extensions.notices.uninstalled");
    setBusyId(null);
    setPendingUninstall(null);
  }

  async function toggleSafeMode() {
    setSafeModeBusy(true);
    const next = !safeMode;
    await run(
      () => extensions.setSafeMode(next),
      next ? "extensions.notices.safeModeOn" : "extensions.notices.safeModeOff"
    );
    setSafeModeBusy(false);
  }

  async function prepareFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (file === undefined) {
      return;
    }

    setPreparing(true);
    setActionError(null);
    setNotice(null);

    try {
      if (file.size > EXTENSION_MAX_PACKAGE_BYTES) {
        throw new ExtensionError(
          "package_too_large",
          "The extension package is too large."
        );
      }

      const text = await file.text();
      setPreview(await extensions.registry.prepareInstall(text));
    } catch (error) {
      setActionError(extensionErrorKey(error));
    } finally {
      setPreparing(false);
    }
  }

  async function install(accepted: readonly ExtensionCapability[]) {
    if (preview === null) {
      return;
    }

    setInstalling(true);
    setActionError(null);
    setNotice(null);

    try {
      await extensions.registry.install(preview, accepted);
      setPreview(null);
      await load();
      setNotice("extensions.notices.installed");
    } catch (error) {
      setActionError(extensionErrorKey(error));
    } finally {
      setInstalling(false);
    }
  }

  if (!loaded && loadError === null) {
    return (
      <PageContainer className="space-y-4">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-40 w-full" />
      </PageContainer>
    );
  }

  if (loadError !== null) {
    return (
      <PageContainer>
        <div role="alert" className="space-y-3">
          <h1 className="text-xl font-semibold">{t("extensions.loadError")}</h1>
          <Button onClick={() => void load()}>{t("common.retry")}</Button>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader title={t("extensions.title")} description={t("extensions.subtitle")} />

      {notice === null ? null : (
        <p role="status" className="text-muted text-sm">
          {t(notice)}
        </p>
      )}
      {actionError === null ? null : (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {t(actionError)}
        </p>
      )}

      <Card className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t("extensions.install.title")}</h2>
          <p className="text-muted text-sm leading-6">{t("extensions.install.help")}</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="extension-package">{t("extensions.install.fileLabel")}</Label>
          <Input
            id="extension-package"
            type="file"
            accept=".json,.opennest-extension.json,application/json"
            disabled={preparing || installing}
            onChange={(event) => void prepareFile(event)}
          />
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{t("extensions.safeMode.title")}</h2>
            <p className="text-muted text-sm leading-6">
              {t("extensions.safeMode.description")}
            </p>
          </div>
          <Button
            variant="secondary"
            loading={safeModeBusy}
            onClick={() => void toggleSafeMode()}
          >
            {safeMode
              ? t("extensions.safeMode.disable")
              : t("extensions.safeMode.enable")}
          </Button>
        </div>
        <p role="status" className="text-sm font-medium">
          {safeMode ? t("extensions.safeMode.on") : t("extensions.safeMode.off")}
        </p>
      </Card>

      {records.length === 0 ? (
        <EmptyState
          icon={<ArchiveIcon className="size-6" />}
          title={t("extensions.empty.title")}
          description={t("extensions.empty.description")}
        />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {records.map((record) => (
            <li key={record.id}>
              <Card className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <h2 className="text-base font-semibold break-words">
                      {record.manifest.name}
                    </h2>
                    <p className="text-muted text-xs">
                      {t("extensions.card.version")} {record.manifest.version}
                    </p>
                    <p className="text-muted text-xs">
                      {t("extensions.card.publisher")} {record.manifest.publisher}
                    </p>
                  </div>
                  <Badge tone={record.enabled ? "success" : "neutral"}>
                    {record.enabled
                      ? t("extensions.card.enabled")
                      : t("extensions.card.disabled")}
                  </Badge>
                </div>

                <p className="text-muted text-sm break-words">
                  {record.manifest.description}
                </p>

                <div className="flex flex-wrap gap-2">
                  {record.manifest.capabilities.map((capability) => (
                    <Badge key={capability} tone="primary">
                      {t(extensionCapabilityKey(capability))}
                    </Badge>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={record.enabled}
                      disabled={busyId === record.id}
                      onChange={(event) => void toggle(record, event.target.checked)}
                    />
                    {t("extensions.card.enable")}
                  </label>
                  <Link
                    href={`/extensions/${encodeURIComponent(record.id)}`}
                    className="text-primary inline-flex min-h-11 items-center text-sm font-medium underline"
                  >
                    {t("extensions.card.open")}
                  </Link>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busyId === record.id}
                    onClick={() => setPendingUninstall(record)}
                  >
                    {t("extensions.card.uninstall")}
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingUninstall !== null}
        title={t("extensions.uninstall.title")}
        description={t("extensions.uninstall.description")}
        confirmLabel={t("extensions.uninstall.confirm")}
        cancelLabel={t("common.cancel")}
        busy={busyId !== null}
        destructive
        onConfirm={() => {
          if (pendingUninstall !== null) {
            void uninstall(pendingUninstall);
          }
        }}
        onClose={() => setPendingUninstall(null)}
      />

      {preview === null ? null : (
        <ExtensionInstallDialog
          open
          preview={preview}
          busy={installing}
          onConfirm={(accepted) => void install(accepted)}
          onClose={() => setPreview(null)}
        />
      )}
    </PageContainer>
  );
}
