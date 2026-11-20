"use client";

import Link from "next/link";
import { useState, type ComponentType } from "react";

import { formatNumber, useLocale, useTranslations } from "@opennest/localization";
import {
  AlertIcon,
  ArchiveIcon,
  ArrowRightIcon,
  Badge,
  Button,
  Card,
  CheckIcon,
  CloudOffIcon,
  FileIcon,
  FolderIcon,
  FolderPlusIcon,
  HardDriveIcon,
  LibraryIcon,
  NoteIcon,
  PrivacyIcon,
  SearchIcon,
  Skeleton,
  UploadIcon,
  type IconProps,
} from "@opennest/ui";

import { BackupReminder } from "@/components/backup-reminder";
import { CreateFolderDialog } from "@/components/create-folder-dialog";
import { EmptyState } from "@/components/empty-state";
import { FileRow } from "@/components/file-row";
import { FolderCard } from "@/components/folder-card";
import { NewNoteButton } from "@/components/new-note-button";
import { PageHeader } from "@/components/page-header";
import { UploadButton } from "@/components/upload-button";
import { useAppData } from "@/lib/data/app-data-provider";
import { readLastBackupAt } from "@/lib/data/backup-reminder";
import { useAsyncData } from "@/lib/data/hooks";
import { formatBytes, formatCalendarDate } from "@/lib/format";
import { noteExcerpt } from "@/lib/notes";
import { readStorageStatus } from "@/lib/privacy/storage-status";

interface StorageRingProps {
  used: number;
  quota: number | null;
}

function StorageRing({ used, quota }: StorageRingProps) {
  const t = useTranslations();
  const { locale } = useLocale();
  const hasQuota = quota !== null && quota > 0;
  const progress = hasQuota ? Math.min(1, used / quota) : 0;
  const radius = 52;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="flex shrink-0 flex-col items-center gap-2">
      <div className="relative grid size-40 place-items-center">
        <svg viewBox="0 0 120 120" className="size-40 -rotate-90" aria-hidden="true">
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke="var(--border)"
            strokeWidth="9"
          />
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-2xl font-semibold tracking-tight">
              {hasQuota
                ? `${formatNumber(locale, Math.round(progress * 100))}%`
                : formatBytes(locale, used)}
            </p>
            <p className="text-muted mt-0.5 text-xs font-medium">
              {hasQuota ? t("dashboard.used") : t("dashboard.localOnly")}
            </p>
          </div>
        </div>
      </div>
      <p className="text-muted max-w-44 text-center text-xs">
        {hasQuota
          ? `${t("dashboard.quota")}: ${formatBytes(locale, quota)}`
          : t("dashboard.quotaUnavailable")}
      </p>
    </div>
  );
}

interface HealthRowProps {
  icon: ComponentType<IconProps>;
  label: string;
  value: string;
  href?: string;
}

function HealthRow({ icon: Icon, label, value, href }: HealthRowProps) {
  const content = (
    <>
      <span className="bg-primary-soft text-primary rounded-control grid size-8 shrink-0 place-items-center">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1 text-sm font-medium">{label}</span>
      <span className="text-muted shrink-0 text-right text-xs">{value}</span>
      {href === undefined ? null : (
        <ArrowRightIcon className="text-muted size-3.5 shrink-0" />
      )}
    </>
  );

  if (href === undefined) {
    return <li className="flex items-center gap-3 px-2 py-2">{content}</li>;
  }

  return (
    <li>
      <Link
        href={href}
        className="hover:bg-surface-muted rounded-control flex items-center gap-3 px-2 py-2 transition-colors"
      >
        {content}
      </Link>
    </li>
  );
}

export function Dashboard() {
  const t = useTranslations();
  const { locale } = useLocale();
  const { services, workspace, privacy } = useAppData();
  const [createOpen, setCreateOpen] = useState(false);
  const state = useAsyncData("dashboard", async () => {
    const [files, notes, folders, children, overview, storageStatus] = await Promise.all([
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
      readStorageStatus(),
    ]);

    return {
      files,
      notes,
      folders,
      children,
      overview,
      storageStatus,
      lastBackupAt: readLastBackupAt(),
    };
  });

  if (state.loading && state.data === null) {
    return (
      <div className="mx-auto w-full max-w-[1500px] space-y-4 px-4 py-6 sm:px-6 lg:px-8">
        <Skeleton className="h-10 w-56" />
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (state.error !== null) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
        <Card role="alert" className="space-y-3">
          <span className="bg-accent-soft text-accent rounded-control grid size-10 place-items-center">
            <AlertIcon className="size-5" />
          </span>
          <h1 className="text-xl font-semibold">{t("errors.unexpected")}</h1>
          <Button variant="secondary" onClick={state.reload}>
            {t("common.retry")}
          </Button>
        </Card>
      </div>
    );
  }

  const data = state.data;

  if (data === null) {
    return null;
  }

  const stats = [
    {
      label: t("dashboard.files"),
      value: formatNumber(locale, data.overview.files),
      icon: FileIcon,
    },
    {
      label: t("dashboard.notes"),
      value: formatNumber(locale, data.overview.notes),
      icon: NoteIcon,
    },
    {
      label: t("dashboard.folders"),
      value: formatNumber(locale, data.overview.folders),
      icon: FolderIcon,
    },
  ];
  const isEmpty =
    data.files.total === 0 &&
    data.notes.total === 0 &&
    data.folders.total === 0 &&
    data.children.length === 0;
  const used = data.storageStatus.usage ?? data.overview.bytes;
  const quota = data.storageStatus.quota;
  const hasQuota = quota !== null && quota > 0;
  const storagePercent = hasQuota
    ? `${formatNumber(locale, Math.round(Math.min(1, used / quota) * 100))}%`
    : t("dashboard.localOnly");

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start">
        <div className="min-w-0 space-y-5">
          <PageHeader
            title={t("dashboard.title")}
            description={isEmpty ? t("dashboard.emptyBody") : t("dashboard.subtitle")}
          />

          <section className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
            <div className="border-border bg-surface rounded-panel shadow-card relative overflow-hidden border p-5 sm:p-6">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-3">
                  <Badge tone="primary">
                    <HardDriveIcon className="size-3.5" />
                    {t("dashboard.storage")}
                  </Badge>
                  <div>
                    <p className="text-3xl font-semibold tracking-tight sm:text-4xl">
                      {formatBytes(locale, data.overview.bytes)}
                    </p>
                    <p className="text-muted text-sm">{t("dashboard.librarySize")}</p>
                  </div>
                  <p className="text-muted max-w-md text-sm leading-6">
                    {t("dashboard.storageBody")}
                  </p>
                </div>
                <StorageRing used={used} quota={quota} />
              </div>
            </div>

            <Card className="flex flex-col p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">{t("dashboard.quickActions")}</h2>
              </div>
              <div className="mt-3 grid flex-1 auto-rows-fr gap-2 sm:grid-cols-2">
                <NewNoteButton
                  variant="secondary"
                  icon={<NoteIcon className="size-4" />}
                  containerClassName="h-full w-full"
                  className="h-full w-full"
                />
                <UploadButton
                  folderId={null}
                  variant="secondary"
                  label={t("dashboard.quickUpload")}
                  icon={<UploadIcon className="size-4" />}
                  containerClassName="h-full w-full"
                  className="h-full w-full"
                />
                <Button
                  variant="secondary"
                  onClick={() => setCreateOpen(true)}
                  className="h-full w-full"
                >
                  <FolderPlusIcon className="size-4" />
                  {t("dashboard.newFolder")}
                </Button>
                <Link
                  href="/search"
                  className="focus-visible:outline-primary rounded-control border-border bg-surface text-foreground hover:bg-border/40 inline-flex h-full min-h-11 w-full items-center justify-center gap-2 border px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <SearchIcon className="size-4" />
                  {t("dashboard.quickSearch")}
                </Link>
              </div>
            </Card>
          </section>

          <section
            aria-label={t("dashboard.overview")}
            className="grid gap-3 sm:grid-cols-3"
          >
            {stats.map((stat) => {
              const Icon = stat.icon;

              return (
                <Card key={stat.label} className="flex items-center gap-3 p-4">
                  <span className="bg-primary-soft text-primary rounded-control grid size-10 shrink-0 place-items-center">
                    <Icon className="size-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="text-muted block text-xs font-medium">
                      {stat.label}
                    </span>
                    <span className="block text-xl font-semibold tracking-tight">
                      {stat.value}
                    </span>
                  </span>
                </Card>
              );
            })}
          </section>

          {isEmpty ? null : <BackupReminder lastBackupAt={data.lastBackupAt} />}

          {isEmpty ? (
            <EmptyState
              title={t("dashboard.emptyTitle")}
              description={t("dashboard.emptyBody")}
              icon={<LibraryIcon className="size-6" />}
              action={
                <>
                  <NewNoteButton icon={<NoteIcon className="size-4" />} />
                  <UploadButton
                    folderId={null}
                    variant="secondary"
                    label={t("dashboard.uploadFirst")}
                    icon={<UploadIcon className="size-4" />}
                  />
                </>
              }
            />
          ) : (
            <>
              {data.children.length === 0 ? null : (
                <section aria-labelledby="dashboard-folders" className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h2 id="dashboard-folders" className="text-sm font-semibold">
                      {t("dashboard.folders")}
                    </h2>
                    <Link
                      href="/library"
                      className="text-primary inline-flex min-h-11 items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {t("dashboard.viewLibrary")}
                      <ArrowRightIcon className="size-3.5" />
                    </Link>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {data.children.slice(0, 3).map((folder) => (
                      <FolderCard key={folder.id} folder={folder} />
                    ))}
                  </div>
                </section>
              )}

              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="overflow-hidden p-0">
                  <div className="border-border flex items-center justify-between gap-2 border-b px-5 py-4">
                    <h2 id="dashboard-recent-files" className="text-sm font-semibold">
                      {t("dashboard.recentFiles")}
                    </h2>
                    <Link
                      href="/library"
                      className="text-primary inline-flex min-h-11 items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {t("dashboard.viewLibrary")}
                      <ArrowRightIcon className="size-3.5" />
                    </Link>
                  </div>
                  {data.files.items.length === 0 ? (
                    <p className="text-muted px-5 py-8 text-sm">
                      {t("dashboard.recentEmpty")}
                    </p>
                  ) : (
                    <ul
                      aria-labelledby="dashboard-recent-files"
                      className="divide-border divide-y"
                    >
                      {data.files.items.map((file) => (
                        <FileRow key={file.id} file={file} />
                      ))}
                    </ul>
                  )}
                </Card>

                <Card className="overflow-hidden p-0">
                  <div className="border-border flex items-center justify-between gap-2 border-b px-5 py-4">
                    <h2 id="dashboard-recent-notes" className="text-sm font-semibold">
                      {t("dashboard.recentNotes")}
                    </h2>
                    <Link
                      href="/notes"
                      className="text-primary inline-flex min-h-11 items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {t("dashboard.viewNotes")}
                      <ArrowRightIcon className="size-3.5" />
                    </Link>
                  </div>
                  {data.notes.items.length === 0 ? (
                    <p className="text-muted px-5 py-8 text-sm">
                      {t("dashboard.recentEmpty")}
                    </p>
                  ) : (
                    <ul
                      aria-labelledby="dashboard-recent-notes"
                      className="divide-border divide-y"
                    >
                      {data.notes.items.map((note) => {
                        const excerpt = noteExcerpt(note.content);

                        return (
                          <li key={note.id}>
                            <Link
                              href={`/notes/${note.id}`}
                              className="hover:bg-surface-muted flex items-start gap-3 px-5 py-3 transition-colors"
                            >
                              <span className="bg-primary-soft text-primary rounded-control mt-0.5 grid size-9 shrink-0 place-items-center">
                                <NoteIcon className="size-4" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">
                                  {note.title}
                                </span>
                                <span className="text-muted mt-0.5 block truncate text-xs">
                                  {excerpt.length === 0
                                    ? t("notes.previewEmpty")
                                    : excerpt}
                                </span>
                              </span>
                              <span className="text-muted shrink-0 text-xs">
                                {formatCalendarDate(locale, note.updatedAt)}
                              </span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Card>
              </div>
            </>
          )}
        </div>

        <aside className="hidden space-y-4 xl:block">
          <Card className="p-0">
            <div className="border-border flex items-center justify-between gap-2 border-b px-5 py-4">
              <h2 className="text-sm font-semibold">{t("dashboard.nestHealth")}</h2>
              <Badge tone="primary">
                <CheckIcon className="size-3.5" />
                {t("dashboard.localFirst")}
              </Badge>
            </div>
            <ul className="space-y-1 p-3">
              <HealthRow
                icon={HardDriveIcon}
                label={t("dashboard.healthStorage")}
                value={storagePercent}
              />
              <HealthRow
                icon={ArchiveIcon}
                label={t("dashboard.healthBackup")}
                value={
                  data.lastBackupAt === null
                    ? t("dashboard.never")
                    : formatCalendarDate(locale, data.lastBackupAt)
                }
              />
              <HealthRow
                icon={CloudOffIcon}
                label={t("dashboard.healthOffline")}
                value={t("dashboard.offlineReady")}
              />
              <HealthRow
                icon={PrivacyIcon}
                label={t("nav.privacy")}
                value={t("dashboard.localOnly")}
                href="/privacy"
              />
            </ul>
            <div className="border-border border-t px-5 py-3">
              <Link
                href="/privacy"
                className="text-primary inline-flex min-h-11 items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
              >
                {t("dashboard.reviewPrivacy")}
                <ArrowRightIcon className="size-3.5" />
              </Link>
            </div>
          </Card>
          <div className="rounded-panel border-border bg-surface-muted/50 border p-4">
            <p className="text-muted text-xs leading-5">
              {t("dashboard.localFirstNote")}
            </p>
          </div>
        </aside>
      </div>

      <CreateFolderDialog
        open={createOpen}
        parentId={null}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}
