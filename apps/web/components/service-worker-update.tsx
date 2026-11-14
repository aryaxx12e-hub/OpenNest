"use client";

import { useEffect, useRef, useState } from "react";

import { useTranslations } from "@opennest/localization";
import { Button } from "@opennest/ui";

import {
  browserPwaContainer,
  startPwa,
  type PwaContainer,
  type PwaHandle,
} from "@/lib/pwa";

function reloadPage() {
  window.location.reload();
}

export interface ServiceWorkerUpdateProps {
  enabled?: boolean;
  container?: PwaContainer | null;
  reload?: () => void;
}

export function ServiceWorkerUpdate({
  enabled = process.env.NODE_ENV === "production",
  container,
  reload = reloadPage,
}: ServiceWorkerUpdateProps) {
  const t = useTranslations();
  const handleRef = useRef<PwaHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const target = container === undefined ? browserPwaContainer() : container;

    if (target === null) {
      return;
    }

    let active = true;

    void startPwa(target, {
      onUpdateReady: () => {
        if (active) {
          setReady(true);
        }
      },
      onControllerChange: () => {
        if (active) {
          reload();
        }
      },
    })
      .then((handle) => {
        if (!active) {
          handle.dispose();
          return;
        }

        handleRef.current = handle;
      })
      .catch(() => undefined);

    return () => {
      active = false;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [container, enabled, reload]);

  if (!ready) {
    return null;
  }

  return (
    <div className="border-border bg-surface border-b px-4 py-3 sm:px-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div role="status" aria-live="polite" className="min-w-0">
          <p className="text-sm font-semibold">{t("pwa.updateTitle")}</p>
          <p className="text-muted mt-0.5 text-xs leading-5">
            {t("pwa.updateDescription")}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" size="sm" onClick={() => setReady(false)}>
            {t("pwa.updateLater")}
          </Button>
          <Button
            size="sm"
            loading={updating}
            onClick={() => {
              const handle = handleRef.current;

              if (handle !== null) {
                setUpdating(true);
                handle.requestUpdate();
              }
            }}
          >
            {t("pwa.updateAction")}
          </Button>
        </div>
      </div>
    </div>
  );
}
