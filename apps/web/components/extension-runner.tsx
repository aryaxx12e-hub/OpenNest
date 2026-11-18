"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  type ExtensionRegistry,
  type ExtensionUiNode,
  type StoredExtension,
} from "@opennest/extensions";
import { useTranslations } from "@opennest/localization";
import { Badge, Button, Card, Skeleton } from "@opennest/ui";

import { ExtensionUiSurface } from "@/components/extension-ui";
import { PageHeader } from "@/components/page-header";
import { useAppData } from "@/lib/data/app-data-provider";
import type { ExtensionSession, ExtensionSessionStatus } from "@/lib/extensions/session";
import type { ExtensionRuntimeHandlers } from "@/lib/extensions/runtime";
import { extensionErrorKey } from "@/lib/extensions/messages";

export interface ExtensionRunnerRuntime {
  readonly registry: Pick<ExtensionRegistry, "get">;
  readonly start: (
    id: string,
    handlers?: ExtensionRuntimeHandlers
  ) => Promise<ExtensionSession>;
  readonly stop: (id?: string) => Promise<void>;
  readonly action: (actionId: string) => Promise<void>;
}

export function ExtensionRunnerRoute({ extensionId }: { readonly extensionId: string }) {
  const { extensions } = useAppData();

  return <ExtensionRunner extensionId={extensionId} extensions={extensions} />;
}

export interface ExtensionRunnerProps {
  readonly extensionId: string;
  readonly extensions: ExtensionRunnerRuntime;
}

export function ExtensionRunner({ extensionId, extensions }: ExtensionRunnerProps) {
  const t = useTranslations();
  const [extension, setExtension] = useState<StoredExtension | null>(null);
  const [status, setStatus] = useState<ExtensionSessionStatus>("starting");
  const [tree, setTree] = useState<ExtensionUiNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    let active = true;

    function fail(errorValue: unknown) {
      if (active) {
        setStatus("error");
        setError(extensionErrorKey(errorValue));
      }
    }

    async function begin() {
      try {
        const found = await extensions.registry.get(extensionId);

        if (!active) {
          return;
        }

        if (found === null) {
          setStatus("error");
          setError("extensions.errors.notFound");
          return;
        }

        setExtension(found);

        if (!found.enabled) {
          setStatus("error");
          setError("extensions.errors.disabled");
          return;
        }

        const session = await extensions.start(extensionId, {
          onUi: (nextTree) => {
            if (active) {
              setTree(nextTree);
            }
          },
          onStatus: (event) => {
            if (active) {
              setStatus(event.status);

              if (event.status === "error") {
                setError(extensionErrorKey(event.code));
              }
            }
          },
        });

        if (active) {
          setStatus(session.status);
        }
      } catch (caught) {
        fail(caught);
      }
    }

    void begin();

    return () => {
      active = false;
      void extensions.stop(extensionId).catch(() => undefined);
    };
  }, [extensionId, extensions]);

  async function stop() {
    setStopping(true);
    setActionError(null);

    try {
      await extensions.stop(extensionId);
      setStatus("stopped");
    } catch (caught) {
      setActionError(extensionErrorKey(caught));
    } finally {
      setStopping(false);
    }
  }

  async function action(actionId: string) {
    setActionBusy(true);
    setActionError(null);

    try {
      await extensions.action(actionId);
    } catch (caught) {
      setActionError(extensionErrorKey(caught));
    } finally {
      setActionBusy(false);
    }
  }

  if (extension === null && error === null) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6">
      <PageHeader
        title={extension?.manifest.name ?? t("extensions.runner.title")}
        description={extension?.manifest.description}
        actions={
          <Button
            variant="secondary"
            loading={stopping}
            disabled={status === "stopped" || status === "error"}
            onClick={() => void stop()}
          >
            {t("extensions.runner.stop")}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={status === "running" ? "success" : "neutral"}>
          {t(`extensions.runner.statuses.${status}`)}
        </Badge>
        {extension === null ? null : (
          <p className="text-muted text-xs">
            {t("extensions.card.version")} {extension.manifest.version}
          </p>
        )}
      </div>

      {error === null ? null : (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {t(error)}
        </p>
      )}
      {actionError === null ? null : (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {t(actionError)}
        </p>
      )}

      <Card>
        <section aria-label={t("extensions.runner.output")} className="min-h-24">
          {tree === null ? (
            <p className="text-muted text-sm">{t("extensions.runner.empty")}</p>
          ) : (
            <ExtensionUiSurface
              tree={tree}
              disabled={actionBusy || status !== "running"}
              onAction={(actionId) => void action(actionId)}
            />
          )}
        </section>
      </Card>

      <Link
        href="/extensions"
        className="text-primary inline-flex min-h-11 items-center text-sm font-medium underline"
      >
        {t("extensions.runner.back")}
      </Link>
    </div>
  );
}
