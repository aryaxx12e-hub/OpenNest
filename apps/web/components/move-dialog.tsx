"use client";

import { useId, useState } from "react";

import type { Folder, FolderId } from "@opennest/core";
import { useTranslations } from "@opennest/localization";
import { Button, Dialog, Label, Select } from "@opennest/ui";

import { errorKey } from "@/lib/errors";
import { folderOptions } from "@/lib/folders";

export interface MoveDialogProps {
  title: string;
  description: string;
  folders: readonly Folder[];
  initialFolderId: FolderId | null;
  excluded?: ReadonlySet<string>;
  rootLabel: string;
  onSubmit: (folderId: FolderId | null) => Promise<void>;
  onClose: () => void;
}

export function MoveDialog({
  title,
  description,
  folders,
  initialFolderId,
  excluded,
  rootLabel,
  onSubmit,
  onClose,
}: MoveDialogProps) {
  const t = useTranslations();
  const formId = useId();
  const selectId = useId();
  const [value, setValue] = useState(initialFolderId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = folderOptions(folders, excluded);

  function close() {
    if (!busy) {
      onClose();
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);

    try {
      await onSubmit(value === "" ? null : (value as FolderId));
      onClose();
    } catch (caught) {
      setError(errorKey(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title={title}
      description={description}
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={formId} loading={busy}>
            {t("common.move")}
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
        <Label htmlFor={selectId}>{t("library.folders")}</Label>
        <Select
          id={selectId}
          value={value}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
        >
          <option value="">{rootLabel}</option>
          {options.map((option) => (
            <option key={option.folder.id} value={option.folder.id}>
              {`${"\u00A0".repeat(option.depth * 2)}${option.folder.name}`}
            </option>
          ))}
        </Select>
        {error === null ? null : (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {t(error)}
          </p>
        )}
      </form>
    </Dialog>
  );
}
