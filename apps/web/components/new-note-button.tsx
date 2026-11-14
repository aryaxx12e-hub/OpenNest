"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { FolderId } from "@opennest/core";
import { useTranslations } from "@opennest/localization";
import { Button } from "@opennest/ui";

import { useAppData } from "@/lib/data/app-data-provider";
import { errorKey } from "@/lib/errors";

export function NewNoteButton({ folderId = null }: { folderId?: FolderId | null }) {
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
      router.push(`/notes/${note.id}`);
    } catch (caught) {
      setError(errorKey(caught));
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button onClick={() => void create()} loading={busy}>
        {t("notes.newNote")}
      </Button>
      {error === null ? null : (
        <span role="alert" className="text-sm text-red-700 dark:text-red-300">
          {t(error)}
        </span>
      )}
    </span>
  );
}
