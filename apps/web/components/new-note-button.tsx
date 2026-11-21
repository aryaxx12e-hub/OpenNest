"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import type { FolderId } from "@opennest/core";
import { useTranslations } from "@opennest/localization";
import { Button, cn, type ButtonSize, type ButtonVariant } from "@opennest/ui";

import { useAppData } from "@/lib/data/app-data-provider";
import { errorKey } from "@/lib/errors";
import { noteHref } from "@/lib/routes";

export interface NewNoteButtonProps {
  folderId?: FolderId | null;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  containerClassName?: string;
  icon?: ReactNode;
}

export function NewNoteButton({
  folderId = null,
  label,
  variant,
  size,
  className,
  containerClassName,
  icon,
}: NewNoteButtonProps) {
  const t = useTranslations();
  const router = useRouter();
  const { services, workspace, invalidate } = useAppData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);

    try {
      const note = await services.note.create({
        workspaceId: workspace.id,
        folderId,
        title: t("notes.untitled"),
        content: "",
      });
      invalidate();
      router.push(noteHref(note.id));
    } catch (caught) {
      setError(errorKey(caught));
      setBusy(false);
    }
  }

  return (
    <span className={cn("inline-flex flex-col items-start gap-1", containerClassName)}>
      <Button
        variant={variant}
        size={size}
        className={className}
        onClick={() => void create()}
        loading={busy}
      >
        {busy ? null : icon}
        {label ?? t("notes.newNote")}
      </Button>
      {error === null ? null : (
        <span role="alert" className="text-sm text-red-700 dark:text-red-300">
          {t(error)}
        </span>
      )}
    </span>
  );
}
