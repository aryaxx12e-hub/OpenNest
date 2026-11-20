"use client";

import { useRef, useState, type ReactNode } from "react";

import { limits, type FolderId } from "@opennest/core";
import { useTranslations } from "@opennest/localization";
import { Button, cn, type ButtonSize, type ButtonVariant } from "@opennest/ui";

import { useAppData } from "@/lib/data/app-data-provider";
import { errorKey } from "@/lib/errors";
import { uploadAccept, uploadMimeType } from "@/lib/files";

export interface UploadButtonProps {
  folderId: FolderId | null;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  containerClassName?: string;
  icon?: ReactNode;
}

export function UploadButton({
  folderId,
  label,
  variant = "primary",
  size = "md",
  className,
  containerClassName,
  icon,
}: UploadButtonProps) {
  const t = useTranslations();
  const { services, workspace, invalidate } = useAppData();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleFiles(files: FileList) {
    const selected = Array.from(files);

    if (selected.length === 0) {
      return;
    }

    setBusy(true);
    setError(null);
    setSuccess(null);

    let uploaded = 0;
    let failure: string | null = null;

    for (const file of selected) {
      if (file.size > limits.maxFileSizeBytes) {
        failure = "errors.fileTooLarge";
        break;
      }

      const mimeType = uploadMimeType(file);

      if (!(limits.allowedMimeTypes as readonly string[]).includes(mimeType)) {
        failure = "errors.unsupportedFile";
        break;
      }

      try {
        const data = new Uint8Array(await file.arrayBuffer());
        await services.file.upload({
          workspaceId: workspace.id,
          folderId,
          name: file.name,
          mimeType,
          data,
        });
        uploaded += 1;
      } catch (caught) {
        failure = errorKey(caught);
        break;
      }
    }

    setBusy(false);

    if (inputRef.current !== null) {
      inputRef.current.value = "";
    }

    if (uploaded > 0) {
      invalidate();
    }

    if (failure !== null) {
      setError(failure);
    } else {
      setSuccess("upload.success");
    }
  }

  return (
    <div className={cn("flex flex-col items-end gap-1", containerClassName)}>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={uploadAccept}
        multiple
        tabIndex={-1}
        onChange={(event) => {
          if (event.target.files !== null) {
            void handleFiles(event.target.files);
          }
        }}
      />
      <Button
        variant={variant}
        size={size}
        className={className}
        loading={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? null : icon}
        {busy ? t("upload.uploading") : (label ?? t("library.upload"))}
      </Button>
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
    </div>
  );
}
