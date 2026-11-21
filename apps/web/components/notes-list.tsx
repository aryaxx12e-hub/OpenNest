"use client";

import Link from "next/link";

import { useLocale, useTranslations } from "@opennest/localization";
import { Button, Card, NoteIcon, Skeleton } from "@opennest/ui";

import { EmptyState } from "@/components/empty-state";
import { NewNoteButton } from "@/components/new-note-button";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { useAppData } from "@/lib/data/app-data-provider";
import { useAsyncData } from "@/lib/data/hooks";
import { formatDateTime } from "@/lib/format";
import { noteExcerpt } from "@/lib/notes";
import { noteHref } from "@/lib/routes";

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
      <PageContainer className="space-y-4">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </PageContainer>
    );
  }

  if (state.error !== null) {
    return (
      <PageContainer>
        <div role="alert" className="space-y-3">
          <h1 className="text-xl font-semibold">{t("errors.unexpected")}</h1>
          <Button onClick={state.reload}>{t("common.retry")}</Button>
        </div>
      </PageContainer>
    );
  }

  const notes = state.data?.items ?? [];

  return (
    <PageContainer>
      <PageHeader
        title={t("notes.title")}
        description={t("notes.subtitle")}
        actions={<NewNoteButton />}
      />

      {notes.length === 0 ? (
        <EmptyState
          icon={<NoteIcon className="size-6" />}
          title={t("notes.emptyTitle")}
          description={t("notes.emptyBody")}
          action={<NewNoteButton />}
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="border-border flex items-baseline justify-between gap-2 border-b px-4 py-3">
            <h2 className="text-sm font-semibold">{t("notes.back")}</h2>
            <span className="text-muted text-xs">{notes.length}</span>
          </div>
          <ul className="divide-border divide-y">
            {notes.map((note) => {
              const excerpt = noteExcerpt(note.content);

              return (
                <li key={note.id}>
                  <Link
                    href={noteHref(note.id)}
                    className="hover:bg-border/30 block px-4 py-4"
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
        </Card>
      )}
    </PageContainer>
  );
}
