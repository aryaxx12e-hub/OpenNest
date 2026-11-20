"use client";

import { useState } from "react";

import { useTranslations } from "@opennest/localization";
import { Button, ConfirmDialog, Skeleton } from "@opennest/ui";

import { BackupExportDialog } from "@/components/backup-export-dialog";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { PrivacyAudit } from "@/components/privacy-audit";
import { PrivacyConsents } from "@/components/privacy-consents";
import { PrivacyGrants } from "@/components/privacy-grants";
import { PrivacyInventory } from "@/components/privacy-inventory";
import { PrivacyOverview } from "@/components/privacy-overview";
import { StorageDiagnostics } from "@/components/storage-diagnostics";
import { useEncryption } from "@/lib/crypto/encryption-gate";
import { useAppData } from "@/lib/data/app-data-provider";
import { recordBackupExported } from "@/lib/data/backup-reminder";
import { useAsyncData } from "@/lib/data/hooks";
import { dataControlErrorKey } from "@/lib/privacy/errors";
import {
  readStorageStatus,
  requestPersistentStorage,
} from "@/lib/privacy/storage-status";

type Action = "delete" | "persist" | null;

export function PrivacyCenter() {
  const t = useTranslations();
  const { ai, privacy, invalidate, refreshWorkspace } = useAppData();
  const encryption = useEncryption();
  const [exportOpen, setExportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const state = useAsyncData("privacy-center", async () => {
    const [overview, grants, audit, consents, providers, storage] = await Promise.all([
      privacy.data.overview(),
      privacy.grants.list(),
      privacy.audit.list(),
      privacy.consents.list(),
      ai.listProviders(),
      readStorageStatus(),
    ]);

    return {
      overview,
      grants,
      audit,
      consents,
      providers,
      storage,
      now: Date.now(),
    };
  });

  async function deleteAll() {
    setAction("delete");
    setActionError(null);
    setActionSuccess(null);

    try {
      await privacy.data.deleteAll();

      if (encryption.record === null) {
        await refreshWorkspace();
      } else {
        await encryption.resetEncryption();
      }

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

  async function requestPersist() {
    setAction("persist");
    setActionError(null);
    setActionSuccess(null);

    try {
      const result = await requestPersistentStorage();

      if (result === "granted") {
        setActionSuccess("privacy.storage.requestGranted");
        state.reload();
      } else if (result === "denied") {
        setActionSuccess("privacy.storage.requestDenied");
        state.reload();
      } else {
        setActionError("privacy.storage.requestError");
      }
    } catch {
      setActionError("privacy.storage.requestError");
    } finally {
      setAction(null);
    }
  }

  async function revokeConsent(id: string) {
    setRevokingId(id);
    setActionError(null);
    setActionSuccess(null);

    try {
      await privacy.revokeConsent(id);
      invalidate();
      state.reload();
      setActionSuccess("privacy.consents.revoked");
    } catch (caught) {
      setActionError(dataControlErrorKey(caught));
    } finally {
      setRevokingId(null);
    }
  }

  if (state.loading && state.data === null) {
    return (
      <PageContainer className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </PageContainer>
    );
  }

  if (state.error !== null || state.data === null) {
    return (
      <PageContainer>
        <div role="alert" className="space-y-3">
          <h1 className="text-xl font-semibold">{t("privacy.loadError")}</h1>
          <Button onClick={state.reload}>{t("common.retry")}</Button>
        </div>
      </PageContainer>
    );
  }

  const { overview, grants, audit, consents, providers, storage, now } = state.data;

  return (
    <PageContainer className="space-y-4">
      <PageHeader
        title={t("privacy.title")}
        description={t("privacy.subtitle")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setExportOpen(true)}>
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
      <StorageDiagnostics
        status={storage}
        busy={action === "persist"}
        onRequestPersist={() => void requestPersist()}
      />
      <PrivacyInventory
        inventory={privacy.data.inventory()}
        flows={privacy.data.flows()}
      />
      <PrivacyGrants grants={grants} />
      <PrivacyConsents
        consents={consents}
        providers={providers}
        busyId={revokingId}
        now={now}
        onRevoke={revokeConsent}
      />
      <PrivacyAudit entries={audit} />

      {exportOpen ? (
        <BackupExportDialog
          open
          summary={{
            files: overview.files,
            notes: overview.notes,
            folders: overview.folders,
            tags: overview.tags,
          }}
          encryptionActive={encryption.record !== null}
          onExport={(options) => privacy.data.exportAll(options)}
          onExported={() => {
            recordBackupExported();
            setActionSuccess("backup.exportSuccess");
            state.reload();
          }}
          onClose={() => setExportOpen(false)}
        />
      ) : null}

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
    </PageContainer>
  );
}
