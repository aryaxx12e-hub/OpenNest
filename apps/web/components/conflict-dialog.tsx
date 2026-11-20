"use client";

import { useState } from "react";

import type { SyncConflictRow } from "@opennest/sync";
import { useTranslations } from "@opennest/localization";
import { Button, Dialog } from "@opennest/ui";

import { errorKey } from "@/lib/errors";

export interface ConflictDialogProps {
  conflict: SyncConflictRow;
  onResolve: (choice: "local" | "remote", value: unknown) => Promise<void>;
  onClose: () => void;
}

function displayValue(value: unknown, emptyLabel: string): string {
  if (value === null || value === undefined || value === "") {
    return emptyLabel;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value) ?? emptyLabel;
  } catch {
    return emptyLabel;
  }
}

export function ConflictDialog({ conflict, onResolve, onClose }: ConflictDialogProps) {
  const t = useTranslations();
  const [busyChoice, setBusyChoice] = useState<"local" | "remote" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = busyChoice !== null;

  function close() {
    if (!busy) {
      onClose();
    }
  }

  async function resolve(choice: "local" | "remote", value: unknown) {
    setBusyChoice(choice);
    setError(null);

    try {
      await onResolve(choice, value);
      onClose();
    } catch (caught) {
      setError(errorKey(caught));
    } finally {
      setBusyChoice(null);
    }
  }

  return (
    <Dialog
      open
      title={t("sync.conflict.title")}
      description={t("sync.conflict.description")}
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="secondary"
            loading={busyChoice === "local"}
            disabled={busy}
            onClick={() => void resolve("local", conflict.localValue)}
          >
            {t("sync.conflict.keepLocal")}
          </Button>
          <Button
            loading={busyChoice === "remote"}
            disabled={busy}
            onClick={() => void resolve("remote", conflict.remoteValue)}
          >
            {t("sync.conflict.keepRemote")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-muted text-sm">
          {t(`sync.entity.${conflict.entityType}`)} {t("sync.conflict.field")}:{" "}
          <code className="text-foreground bg-border/40 rounded px-1.5 py-0.5 text-xs">
            {conflict.fieldPath}
          </code>
        </p>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="border-border bg-background space-y-2 rounded-control border p-3">
            <dt className="text-muted text-xs font-medium">{t("sync.conflict.local")}</dt>
            <dd className="text-sm break-words whitespace-pre-wrap">
              {displayValue(conflict.localValue, t("sync.conflict.empty"))}
            </dd>
          </div>
          <div className="border-border bg-background space-y-2 rounded-control border p-3">
            <dt className="text-muted text-xs font-medium">
              {t("sync.conflict.remote")}
            </dt>
            <dd className="text-sm break-words whitespace-pre-wrap">
              {displayValue(conflict.remoteValue, t("sync.conflict.empty"))}
            </dd>
          </div>
        </dl>
        {error === null ? null : (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {t(error)}
          </p>
        )}
      </div>
    </Dialog>
  );
}
