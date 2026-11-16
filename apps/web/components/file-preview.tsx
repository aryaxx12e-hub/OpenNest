"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { FileId, FolderId, TagId } from "@opennest/core";
import { useLocale, useTranslations } from "@opennest/localization";
import { Button, Card, ConfirmDialog, Skeleton } from "@opennest/ui";

import { EmptyState } from "@/components/empty-state";
import { MoveDialog } from "@/components/move-dialog";
import { NameDialog } from "@/components/name-dialog";
import { PageHeader } from "@/components/page-header";
import { TagDialog } from "@/components/tag-dialog";
import { useAppData } from "@/lib/data/app-data-provider";
import { useAsyncData } from "@/lib/data/hooks";
import { errorKey } from "@/lib/errors";
import { isPreviewableMime } from "@/lib/files";
import { formatBytes, formatDateTime } from "@/lib/format";

const TEXT_PREVIEW_LIMIT = 100_000;

export function FilePreview({ fileId }: { fileId: FileId }) {
  const t = useTranslations();
  const { locale } = useLocale();
  const router = useRouter();
  const { services, workspace, privacy, invalidate } = useAppData();
  const [renameOpen, setRenameOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const state = useAsyncData(`file:${fileId}`, async () => {
    const file = await services.file.get(fileId);

    if (file === null) {
      return { missing: true as const };
    }

    const [blob, folders, allTags, fileTags] = await Promise.all([
      privacy.data.readBlob(file.blobKey),
      services.folder.list(workspace.id, { limit: 500, sort: "name" }),
      services.tag.list(workspace.id, { limit: 500, sort: "name" }),
      services.file.tags(file.id),
    ]);
    const previewable = isPreviewableMime(file.mimeType);
    const url = previewable && blob !== null ? URL.createObjectURL(blob) : null;
    const text =
      blob !== null &&
      (file.mimeType === "text/plain" || file.mimeType === "text/markdown")
        ? (await blob.text()).slice(0, TEXT_PREVIEW_LIMIT)
        : null;

    return {
      missing: false as const,
      file,
      url,
      text,
      folders: folders.items,
      allTags: allTags.items,
      fileTags,
    };
  });

  const url = state.data?.missing === false ? state.data.url : null;

  useEffect(() => {
    return () => {
      if (url !== null) {
        URL.revokeObjectURL(url);
      }
    };
  }, [url]);

  if (state.loading && state.data === null) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6 sm:px-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-80 w-full" />
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

  const data = state.data;

  if (data === null || data.missing) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
        <EmptyState
          title={t("file.notFoundTitle")}
          description={t("file.notFoundBody")}
          action={
            <Link className="text-primary text-sm font-medium underline" href="/library">
              {t("file.back")}
            </Link>
          }
        />
      </div>
    );
  }

  const { file, text, folders, allTags, fileTags } = data;
  const isImage =
    file.mimeType === "image/png" ||
    file.mimeType === "image/jpeg" ||
    file.mimeType === "image/webp";
  const isPdf = file.mimeType === "application/pdf";
  const hasText = text !== null;

  async function rename(name: string) {
    await services.file.update(file.id, { name });
    invalidate();
  }

  async function move(folderId: FolderId | null) {
    await services.file.update(file.id, { folderId });
    invalidate();
  }

  async function remove() {
    setDeleteBusy(true);
    setActionError(null);

    try {
      const target = file.folderId === null ? "/library" : `/library/${file.folderId}`;
      await services.file.delete(file.id);
      invalidate();
      setDeleteOpen(false);
      router.push(target);
    } catch (caught) {
      setDeleteOpen(false);
      setActionError(errorKey(caught));
    } finally {
      setDeleteBusy(false);
    }
  }

  async function createTag(name: string) {
    return services.tag.create({ workspaceId: workspace.id, name });
  }

  async function saveTags(tagIds: TagId[]) {
    await services.file.setTags(file.id, tagIds);
    invalidate();
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <div>
        <Link
          href={file.folderId === null ? "/library" : `/library/${file.folderId}`}
          className="text-muted hover:text-foreground text-sm underline-offset-4 hover:underline"
        >
          {t("file.back")}
        </Link>
      </div>

      <PageHeader
        title={file.name}
        description={`${formatBytes(locale, file.sizeBytes)} · ${formatDateTime(
          locale,
          file.updatedAt
        )}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setRenameOpen(true)}>
              {t("common.rename")}
            </Button>
            <Button variant="secondary" onClick={() => setMoveOpen(true)}>
              {t("common.move")}
            </Button>
            <Button variant="secondary" onClick={() => setTagsOpen(true)}>
              {t("file.tags")}
            </Button>
            <Button variant="danger" onClick={() => setDeleteOpen(true)}>
              {t("common.delete")}
            </Button>
            {data.url === null ? null : (
              <a
                href={data.url}
                download={file.name}
                className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-medium"
              >
                {t("file.download")}
              </a>
            )}
          </div>
        }
      />

      {actionError === null ? null : (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {t(actionError)}
        </p>
      )}

      <section aria-labelledby="file-tags" className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h2 id="file-tags" className="text-sm font-semibold">
            {t("file.tags")}
          </h2>
          <Button variant="secondary" onClick={() => setTagsOpen(true)}>
            {t("common.add")}
          </Button>
        </div>
        {fileTags.length === 0 ? (
          <p className="text-muted text-sm">{t("file.noTags")}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {fileTags.map((tag) => (
              <li
                key={tag.id}
                className="border-border bg-surface inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm"
              >
                <span
                  aria-hidden="true"
                  className="size-3 rounded-full border border-black/10"
                  style={{ backgroundColor: tag.color ?? "#8b9490" }}
                />
                {tag.name}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card className="overflow-hidden p-0">
        {isImage && data.url !== null ? (
          <div className="bg-background grid place-items-center p-4">
            <Image
              src={data.url}
              alt={file.name}
              width={1600}
              height={1200}
              unoptimized
              className="max-h-[70vh] w-auto max-w-full object-contain"
            />
          </div>
        ) : isPdf && data.url !== null ? (
          <iframe title={file.name} src={data.url} className="h-[70vh] w-full border-0" />
        ) : hasText ? (
          <div className="space-y-2 p-4">
            <h2 className="text-sm font-semibold">{t("file.textPreview")}</h2>
            <pre className="bg-background max-h-[70vh] overflow-auto rounded-xl p-4 text-sm leading-6 whitespace-pre-wrap">
              {text}
            </pre>
          </div>
        ) : (
          <div className="p-6">
            <h2 className="text-base font-semibold">{t("file.previewUnavailable")}</h2>
            <p className="text-muted mt-1 text-sm leading-6">
              {t("file.previewUnavailableBody")}
            </p>
          </div>
        )}
      </Card>

      <section aria-labelledby="file-details" className="space-y-3">
        <h2 id="file-details" className="text-sm font-semibold">
          {t("file.details")}
        </h2>
        <dl className="border-border bg-surface grid gap-3 rounded-xl border p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted text-xs">{t("file.size")}</dt>
            <dd>{formatBytes(locale, file.sizeBytes)}</dd>
          </div>
          <div>
            <dt className="text-muted text-xs">{t("file.type")}</dt>
            <dd className="break-all">{file.mimeType ?? t("file.previewUnavailable")}</dd>
          </div>
          <div>
            <dt className="text-muted text-xs">{t("file.created")}</dt>
            <dd>{formatDateTime(locale, file.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-muted text-xs">{t("file.updated")}</dt>
            <dd>{formatDateTime(locale, file.updatedAt)}</dd>
          </div>
          {file.checksum === null ? null : (
            <div className="sm:col-span-2">
              <dt className="text-muted text-xs">{t("file.checksum")}</dt>
              <dd className="font-mono text-xs break-all">{file.checksum}</dd>
            </div>
          )}
        </dl>
      </section>

      {renameOpen ? (
        <NameDialog
          title={t("file.renameTitle")}
          description={t("file.renameDescription")}
          label={t("file.name")}
          initialValue={file.name}
          submitLabel={t("common.save")}
          onSubmit={rename}
          onClose={() => setRenameOpen(false)}
        />
      ) : null}

      {moveOpen ? (
        <MoveDialog
          title={t("file.moveTitle")}
          description={t("file.moveDescription")}
          folders={folders}
          initialFolderId={file.folderId}
          rootLabel={t("folderActions.moveToRoot")}
          onSubmit={move}
          onClose={() => setMoveOpen(false)}
        />
      ) : null}

      {tagsOpen ? (
        <TagDialog
          tags={allTags}
          selected={fileTags.map((tag) => tag.id)}
          onCreate={createTag}
          onSave={saveTags}
          onClose={() => setTagsOpen(false)}
        />
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        title={t("file.deleteTitle")}
        description={t("file.deleteBody")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        busy={deleteBusy}
        destructive
        onConfirm={() => void remove()}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}
