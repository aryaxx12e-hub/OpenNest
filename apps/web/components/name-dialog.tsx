"use client";

import { useId, useState } from "react";

import { useTranslations } from "@opennest/localization";
import { Button, Dialog, Input, Label } from "@opennest/ui";

import { errorKey } from "@/lib/errors";

export interface NameDialogProps {
  title: string;
  description: string;
  label: string;
  initialValue: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}

export function NameDialog({
  title,
  description,
  label,
  initialValue,
  submitLabel,
  onSubmit,
  onClose,
}: NameDialogProps) {
  const t = useTranslations();
  const formId = useId();
  const inputId = useId();
  const [name, setName] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (!busy) {
      onClose();
    }
  }

  async function submit() {
    if (name.trim().length === 0) {
      setError("errors.nameRequired");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await onSubmit(name);
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
            {submitLabel}
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
        <Label htmlFor={inputId}>{label}</Label>
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
