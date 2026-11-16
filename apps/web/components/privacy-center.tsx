"use client";

import { useState } from "react";

import { useTranslations } from "@opennest/localization";
import { Button, ConfirmDialog, Skeleton } from "@opennest/ui";

import { PageHeader } from "@/components/page-header";
import { PrivacyAudit } from "@/components/privacy-audit";
import { PrivacyGrants } from "@/components/privacy-grants";
import { PrivacyInventory } from "@/components/privacy-inventory";
import { PrivacyOverview } from "@/components/privacy-overview";
import { useAppData } from "@/lib/data/app-data-provider";
import { downloadTextFile } from "@/lib/data/backup";
import { useAsyncData } from "@/lib/data/hooks";
import { dataControlErrorKey } from "@/lib/privacy/errors";

type Action = "export" | "delete" | null;

export function PrivacyCenter() {
  const t = useTranslations();
  const { privacy, invalidate, refreshWorkspace } = useAppData();
  const [exportOpen, setExportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const state = useAsyncData("privacy-center", async () => {
    const [overview, grants, audit] = await Promise.all([
      privacy.data.overview(),
      privacy.grants.list(),
      privacy.audit.list(),
    ]);

    return { overview, grants, audit };
  });

  async function exportAll() {
    setAction("export");
    setActionError(null);
    setActionSuccess(null);

    try {
      const built = await privacy.data.exportAll();
      downloadTextFile(built.fileName, built.text);
      setExportOpen(false);
      setActionSuccess("privacy.export.success");
      state.reload();
    } catch (caught) {
      setExportOpen(false);
      setActionError(dataControlErrorKey(caught));
    } finally {
      setAction(null);
    }
  }

  async function deleteAll() {
    setAction("delete");
    setActionError(null);
    setActionSuccess(null);

    try {
      await privacy.data.deleteAll();
      await refreshWorkspace();
      invalidate();
      state.reload();
      setDeleteOpen(false);
      setActionSuccess("privacy.delete.success");
    } catch (caught) {
      setDeleteOpen(false);
      setActionError(dataControlErrorKey(caught));
    } finally {
      setAction(null);
    }
  }

  if (state.loading && state.data === null) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (state.error !== null || state.data === null) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
        <div role="alert" className="space-y-3">
          <h1 className="text-xl font-semibold">{t("privacy.loadError")}</h1>
          <Button onClick={state.reload}>{t("common.retry")}</Button>
        </div>
      </div>
    );
  }

  const { overview, grants, audit } = state.data;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6">
      <PageHeader
        title={t("privacy.title")}
        description={t("privacy.subtitle")}
        actions={
          <>
            <Button
              variant="secondary"
              loading={action === "export"}
              onClick={() => setExportOpen(true)}
            >
              {t("privacy.export.action")}
            </Button>
            <Button
              variant="danger"
              loading={action === "delete"}
              onClick={() => setDeleteOpen(true)}
            >
              {t("privacy.delete.action")}
            </Button>
          </>
        }
      />

      {actionSuccess === null ? null : (
        <p role="status" className="text-muted text-sm">
          {t(actionSuccess)}
        </p>
      )}
      {actionError === null ? null : (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {t(actionError)}
        </p>
      )}

      <PrivacyOverview overview={overview} />
      <PrivacyInventory
        inventory={privacy.data.inventory()}
        flows={privacy.data.flows()}
      />
      <PrivacyGrants grants={grants} />
      <PrivacyAudit entries={audit} />

      <ConfirmDialog
        open={exportOpen}
        title={t("privacy.export.title")}
        description={t("privacy.export.description")}
        confirmLabel={t("privacy.export.confirm")}
        cancelLabel={t("common.cancel")}
        busy={action === "export"}
        onConfirm={() => void exportAll()}
        onClose={() => setExportOpen(false)}
      >
        <p className="text-muted text-xs leading-5">{t("privacy.export.exclusion")}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteOpen}
        title={t("privacy.delete.title")}
        description={t("privacy.delete.description")}
        confirmLabel={t("privacy.delete.confirm")}
        cancelLabel={t("common.cancel")}
        busy={action === "delete"}
        destructive
        onConfirm={() => void deleteAll()}
        onClose={() => setDeleteOpen(false)}
      >
        <p className="text-muted text-xs leading-5">
          {t("privacy.delete.externalNotice")}
        </p>
      </ConfirmDialog>
    </div>
  );
}
