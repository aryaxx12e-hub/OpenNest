"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

import { cn } from "./cn";

export interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  className?: string;
}

export function Dialog({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  className,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;

    if (dialog === null) {
      return;
    }

    if (open && !dialog.open && typeof dialog.showModal === "function") {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          dialogRef.current?.close();
        }
      }}
      className={cn(
        "bg-surface text-foreground border-border rounded-panel m-auto w-[min(calc(100vw-2rem),32rem)] border p-0 shadow-xl backdrop:bg-black/40",
        className
      )}
    >
      <div className="space-y-4 p-5">
        <div className="space-y-1">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          {description === undefined ? null : (
            <p id={descriptionId} className="text-muted text-sm leading-6">
              {description}
            </p>
          )}
        </div>
        {children}
        {footer === undefined ? null : (
          <div className="flex flex-wrap justify-end gap-2">{footer}</div>
        )}
      </div>
    </dialog>
  );
}
