"use client";

import { useState } from "react";

import type { ExtensionCapability, InstallPreview } from "@opennest/extensions";
import { useTranslations } from "@opennest/localization";

import { Button, Dialog } from "@opennest/ui";

import { extensionCapabilityKey } from "@/lib/extensions/messages";

export interface ExtensionInstallDialogProps {
  readonly open: boolean;
  readonly preview: InstallPreview;
  readonly busy?: boolean;
  readonly onConfirm: (accepted: readonly ExtensionCapability[]) => void;
  readonly onClose: () => void;
}

export function ExtensionInstallDialog({
  open,
  preview,
  busy = false,
  onConfirm,
  onClose,
}: ExtensionInstallDialogProps) {
  const t = useTranslations();
  const [consent, setConsent] = useState<{
    preview: InstallPreview;
    accepted: boolean;
  } | null>(null);
  const isUpdate = preview.action === "update";
  const permissions = isUpdate
    ? preview.requiredCapabilities
    : preview.manifest.capabilities;
  const accepted = consent?.preview === preview ? consent.accepted : false;
  const confirmed = !preview.requiresConsent || accepted;

  return (
    <Dialog
      open={open}
      title={
        isUpdate ? t("extensions.install.updateTitle") : t("extensions.install.title")
      }
      description={preview.manifest.name}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => onConfirm(permissions)}
            disabled={!confirmed}
            loading={busy}
          >
            {isUpdate ? t("extensions.install.update") : t("extensions.install.confirm")}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted">{t("extensions.install.version")}</dt>
          <dd className="font-medium">{preview.manifest.version}</dd>
          <dt className="text-muted">{t("extensions.install.publisher")}</dt>
          <dd className="font-medium">{preview.manifest.publisher}</dd>
        </dl>
        <p className="text-muted break-words">{preview.manifest.description}</p>

        <p
          role="note"
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {t("extensions.install.unsigned")}
        </p>

        <section className="space-y-2">
          <h3 className="font-medium">
            {isUpdate
              ? t("extensions.install.newPermissions")
              : t("extensions.install.permissions")}
          </h3>
          {permissions.length === 0 ? (
            <p className="text-muted">{t("extensions.install.noPermissions")}</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5">
              {permissions.map((capability) => (
                <li key={capability}>{t(extensionCapabilityKey(capability))}</li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-1 rounded-lg border border-neutral-200 p-3 text-neutral-700 dark:border-neutral-800 dark:text-neutral-300">
          <p>{t("extensions.install.networkNone")}</p>
          <p>{t("extensions.install.storage")}</p>
        </div>

        {preview.requiresConsent ? (
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1 size-4"
              checked={accepted}
              onChange={(event) =>
                setConsent({ preview, accepted: event.target.checked })
              }
            />
            <span>{t("extensions.install.consent")}</span>
          </label>
        ) : null}
      </div>
    </Dialog>
  );
}
