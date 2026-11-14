"use client";

import Link from "next/link";

import { useLocale, useTranslations } from "@opennest/localization";
import { Button, Skeleton } from "@opennest/ui";

import { EmptyState } from "@/components/empty-state";
import { NewNoteButton } from "@/components/new-note-button";
import { PageHeader } from "@/components/page-header";
import { useAppData } from "@/lib/data/app-data-provider";
import { useAsyncData } from "@/lib/data/hooks";
import { formatDateTime } from "@/lib/format";
import { noteExcerpt } from "@/lib/notes";

export function NotesList() {
  const t = useTranslations();
  const { locale } = useLocale();
  const { services, workspace } = useAppData();
  const state = useAsyncData("notes:list", async () =>
    services.note.list(
      workspace.id,
      {},
      { limit: 100, sort: "updatedAt", direction: "desc" }
    )
  );

  if (state.loading && state.data === null) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6 sm:px-6">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (state.error !== null) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
        <div role="alert" className="space-y-3">
          <h1 className="text-xl font-semibold">{t("errors.unexpected")}</h1>
          <Button onClick={state.reload}>{t("common.retry")}</Button>
        </div>
      </div>
    );
  }

  const notes = state.data?.items ?? [];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <PageHeader
        title={t("notes.title")}
        description={t("notes.subtitle")}
        actions={<NewNoteButton />}
      />

      {notes.length === 0 ? (
        <EmptyState
          title={t("notes.emptyTitle")}
          description={t("notes.emptyBody")}
          action={<NewNoteButton />}
        />
      ) : (
        <ul className="border-border bg-surface divide-border divide-y overflow-hidden rounded-xl border">
          {notes.map((note) => {
            const excerpt = noteExcerpt(note.content);

            return (
              <li key={note.id}>
                <Link
                  href={`/notes/${note.id}`}
                  className="hover:bg-border/30 block px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 truncate font-medium">{note.title}</span>
                    <span className="text-muted shrink-0 text-xs">
                      {formatDateTime(locale, note.updatedAt)}
                    </span>
                  </div>
                  <p className="text-muted mt-1 truncate text-sm">
                    {excerpt.length === 0 ? t("notes.previewEmpty") : excerpt}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
