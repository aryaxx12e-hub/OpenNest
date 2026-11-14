"use client";

import { useId, useState } from "react";

import type { FolderId } from "@opennest/core";
import { useTranslations } from "@opennest/localization";
import { Button, Dialog, Input, Label } from "@opennest/ui";

import { useAppData } from "@/lib/data/app-data-provider";
import { errorKey } from "@/lib/errors";

export interface CreateFolderDialogProps {
  open: boolean;
  parentId: FolderId | null;
  onClose: () => void;
}

export function CreateFolderDialog({ open, parentId, onClose }: CreateFolderDialogProps) {
  const t = useTranslations();
  const { services, workspace, invalidate } = useAppData();
  const formId = useId();
  const inputId = useId();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (busy) {
      return;
    }
    setName("");
    setError(null);
    onClose();
  }

  async function submit() {
    if (name.trim().length === 0) {
      setError("errors.folderNameRequired");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await services.folder.create({
        workspaceId: workspace.id,
        parentId,
        name,
      });
      invalidate();
      setName("");
      onClose();
    } catch (caught) {
      setError(errorKey(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      title={t("library.createFolderTitle")}
      description={t("library.createFolderDescription")}
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={formId} loading={busy}>
            {t("library.createFolder")}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Label htmlFor={inputId}>{t("library.nameLabel")}</Label>
        <Input
          id={inputId}
          value={name}
          autoFocus
          maxLength={255}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
        {error === null ? null : (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {t(error)}
          </p>
        )}
      </form>
    </Dialog>
  );
}
