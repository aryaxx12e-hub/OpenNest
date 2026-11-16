"use client";

import Link from "next/link";
import { useState } from "react";

import { formatNumber, useLocale, useTranslations } from "@opennest/localization";
import { Button, Card, Skeleton } from "@opennest/ui";

import { CreateFolderDialog } from "@/components/create-folder-dialog";
import { EmptyState } from "@/components/empty-state";
import { FileRow } from "@/components/file-row";
import { FolderCard } from "@/components/folder-card";
import { NewNoteButton } from "@/components/new-note-button";
import { PageHeader } from "@/components/page-header";
import { UploadButton } from "@/components/upload-button";
import { useAppData } from "@/lib/data/app-data-provider";
import { useAsyncData } from "@/lib/data/hooks";
import { formatBytes, formatDateTime } from "@/lib/format";
import { noteExcerpt } from "@/lib/notes";

export function Dashboard() {
  const t = useTranslations();
  const { locale } = useLocale();
  const { services, workspace, privacy } = useAppData();
  const [createOpen, setCreateOpen] = useState(false);
  const state = useAsyncData("dashboard", async () => {
    const [files, notes, folders, children, overview] = await Promise.all([
      services.file.list(
        workspace.id,
        {},
        { limit: 5, sort: "updatedAt", direction: "desc" }
      ),
      services.note.list(
        workspace.id,
        {},
        { limit: 5, sort: "updatedAt", direction: "desc" }
      ),
      services.folder.list(workspace.id, { limit: 1 }),
      services.folder.children(workspace.id, null),
      privacy.data.overview(),
    ]);

    return { files, notes, folders, children, overview };
  });

  if (state.loading && state.data === null) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6">
        <Skeleton className="h-9 w-64" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (state.error !== null) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
        <div role="alert" className="space-y-3">
          <h1 className="text-xl font-semibold">{t("errors.unexpected")}</h1>
          <button
            type="button"
            className="text-primary text-sm font-medium underline"
            onClick={state.reload}
          >
            {t("common.retry")}
          </button>
        </div>
      </div>
    );
  }

  const data = state.data;

  if (data === null) {
    return null;
  }

  const stats = [
    { label: t("dashboard.files"), value: formatNumber(locale, data.files.total) },
    { label: t("dashboard.notes"), value: formatNumber(locale, data.notes.total) },
    { label: t("dashboard.folders"), value: formatNumber(locale, data.folders.total) },
    { label: t("dashboard.storage"), value: formatBytes(locale, data.overview.bytes) },
  ];
  const isEmpty =
    data.files.total === 0 &&
    data.notes.total === 0 &&
    data.folders.total === 0 &&
    data.children.length === 0;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <PageHeader
        title={t("dashboard.title")}
        description={isEmpty ? t("dashboard.emptyBody") : t("dashboard.subtitle")}
        actions={
          <>
            <NewNoteButton />
            <Button variant="secondary" onClick={() => setCreateOpen(true)}>
              {t("dashboard.newFolder")}
            </Button>
            <UploadButton folderId={null} label={t("dashboard.uploadFirst")} />
          </>
        }
      />

      <section
        aria-label={t("dashboard.title")}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        {stats.map((stat) => (
          <Card key={stat.label} className="p-4">
            <p className="text-muted text-xs font-medium tracking-wide uppercase">
              {stat.label}
            </p>
            <p className="mt-1 text-2xl font-semibold">{stat.value}</p>
          </Card>
        ))}
      </section>

      {isEmpty ? (
        <EmptyState
          title={t("dashboard.emptyTitle")}
          description={t("dashboard.emptyBody")}
          action={
            <Button variant="secondary" onClick={() => setCreateOpen(true)}>
              {t("dashboard.newFolder")}
            </Button>
          }
        />
      ) : (
        <>
          {data.children.length === 0 ? null : (
            <section aria-labelledby="dashboard-folders" className="space-y-3">
              <h2 id="dashboard-folders" className="text-sm font-semibold">
                {t("dashboard.folders")}
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.children.slice(0, 6).map((folder) => (
                  <FolderCard key={folder.id} folder={folder} />
                ))}
              </div>
            </section>
          )}

          <section aria-labelledby="dashboard-recent" className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 id="dashboard-recent" className="text-sm font-semibold">
                {t("dashboard.recentFiles")}
              </h2>
              <Link
                href="/library"
                className="text-primary text-sm font-medium underline-offset-4 hover:underline"
              >
                {t("dashboard.viewLibrary")}
              </Link>
            </div>
            {data.files.items.length === 0 ? (
              <p className="text-muted border-border rounded-xl border border-dashed p-6 text-sm">
                {t("dashboard.recentEmpty")}
              </p>
            ) : (
              <ul className="border-border bg-surface divide-border divide-y overflow-hidden rounded-xl border">
                {data.files.items.map((file) => (
                  <FileRow key={file.id} file={file} />
                ))}
              </ul>
            )}
          </section>

          {data.notes.items.length === 0 ? null : (
            <section aria-labelledby="dashboard-notes" className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 id="dashboard-notes" className="text-sm font-semibold">
                  {t("dashboard.recentNotes")}
                </h2>
                <Link
                  href="/notes"
                  className="text-primary text-sm font-medium underline-offset-4 hover:underline"
                >
                  {t("notes.back")}
                </Link>
              </div>
              <ul className="border-border bg-surface divide-border divide-y overflow-hidden rounded-xl border">
                {data.notes.items.map((note) => {
                  const excerpt = noteExcerpt(note.content);

                  return (
                    <li key={note.id}>
                      <Link
                        href={`/notes/${note.id}`}
                        className="hover:bg-border/30 flex items-start justify-between gap-3 px-4 py-3"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{note.title}</span>
                          <span className="text-muted mt-0.5 block truncate text-sm">
                            {excerpt.length === 0 ? t("notes.previewEmpty") : excerpt}
                          </span>
                        </span>
                        <span className="text-muted shrink-0 text-xs">
                          {formatDateTime(locale, note.updatedAt)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}

      <CreateFolderDialog
        open={createOpen}
        parentId={null}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}
