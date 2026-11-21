"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Folder, FolderId, SortField } from "@opennest/core";
import { useTranslations } from "@opennest/localization";
import { Button, Card, ConfirmDialog, LibraryIcon, Select, Skeleton } from "@opennest/ui";

import { EmptyState } from "@/components/empty-state";
import { FileRow } from "@/components/file-row";
import { FolderCard } from "@/components/folder-card";
import { CreateFolderDialog } from "@/components/create-folder-dialog";
import { MoveDialog } from "@/components/move-dialog";
import { NameDialog } from "@/components/name-dialog";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { UploadButton } from "@/components/upload-button";
import { useAppData } from "@/lib/data/app-data-provider";
import { useAsyncData } from "@/lib/data/hooks";
import { errorKey } from "@/lib/errors";
import { collectFolderSubtree } from "@/lib/folders";
import { libraryTypeMimeTypes, type LibraryFileType } from "@/lib/library";
import { folderHref } from "@/lib/routes";

const PAGE_STEP = 50;
const PAGE_MAX = 500;

export function LibraryBrowser({ folderId }: { folderId: FolderId | null }) {
  const t = useTranslations();
  const router = useRouter();
  const { services, workspace, invalidate } = useAppData();
  const [limit, setLimit] = useState(PAGE_STEP);
  const [sort, setSort] = useState<SortField>("updatedAt");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [type, setType] = useState<LibraryFileType>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const state = useAsyncData(
    `library:${folderId ?? "root"}:${limit}:${sort}:${direction}:${type}`,
    async () => {
      let folder: Folder | null = null;
      let ancestors: Folder[] = [];

      if (folderId !== null) {
        folder = await services.folder.get(folderId);

        if (folder === null) {
          return { missing: true as const };
        }

        ancestors = await services.folder.ancestors(folder.id);
      }

      const mimeTypes = libraryTypeMimeTypes(type);
      const [children, files, allFolders] = await Promise.all([
        services.folder.children(workspace.id, folderId),
        services.file.list(
          workspace.id,
          mimeTypes === undefined
            ? { folderId }
            : { folderId, mimeTypes: [...mimeTypes] },
          { limit, sort, direction }
        ),
        services.folder.list(workspace.id, { limit: PAGE_MAX, sort: "name" }),
      ]);

      return {
        missing: false as const,
        folder,
        ancestors,
        children,
        files,
        allFolders: allFolders.items,
      };
    }
  );

  if (state.loading && state.data === null) {
    return (
      <PageContainer className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
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

  const data = state.data;
  const missing = data?.missing === true;

  if (missing) {
    return (
      <PageContainer>
        <EmptyState
          title={t("library.notFoundTitle")}
          description={t("library.notFoundBody")}
          action={
            <Link className="text-primary text-sm font-medium underline" href="/library">
              {t("library.backToLibrary")}
            </Link>
          }
        />
      </PageContainer>
    );
  }

  const currentFolder = data?.folder ?? null;
  const ancestors = data?.ancestors ?? [];
  const children = data?.children ?? [];
  const files = data?.files;
  const items = files?.items ?? [];
  const total = files?.total ?? 0;
  const allFolders = data?.allFolders ?? [];
  const isEmpty = children.length === 0 && items.length === 0 && type === "all";

  function changeSort(value: SortField) {
    setSort(value);
    setLimit(PAGE_STEP);
  }

  function changeDirection(value: "asc" | "desc") {
    setDirection(value);
    setLimit(PAGE_STEP);
  }

  function changeType(value: LibraryFileType) {
    setType(value);
    setLimit(PAGE_STEP);
  }

  function clearFilters() {
    setType("all");
    setLimit(PAGE_STEP);
  }

  async function rename(name: string) {
    if (currentFolder === null) {
      return;
    }

    await services.folder.rename(currentFolder.id, name);
    invalidate();
  }

  async function move(parentId: FolderId | null) {
    if (currentFolder === null) {
      return;
    }

    await services.folder.move(currentFolder.id, parentId);
    invalidate();
  }

  async function remove() {
    if (currentFolder === null) {
      return;
    }

    setDeleteBusy(true);
    setActionError(null);

    try {
      const target = folderHref(currentFolder.parentId);
      await services.folder.delete(currentFolder.id);
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

  return (
    <PageContainer>
      <nav
        aria-label="Breadcrumb"
        className="text-muted flex flex-wrap items-center gap-1 text-sm"
      >
        <Link
          className="hover:text-foreground underline-offset-4 hover:underline"
          href="/library"
        >
          {t("library.root")}
        </Link>
        {ancestors.map((folder) => (
          <span key={folder.id} className="flex items-center gap-1">
            <span aria-hidden="true">/</span>
            <Link
              className="hover:text-foreground underline-offset-4 hover:underline"
              href={folderHref(folder.id)}
            >
              {folder.name}
            </Link>
          </span>
        ))}
        {currentFolder === null ? null : (
          <span className="flex items-center gap-1">
            <span aria-hidden="true">/</span>
            <span aria-current="page">{currentFolder.name}</span>
          </span>
        )}
      </nav>

      <PageHeader
        title={currentFolder?.name ?? t("library.title")}
        description={
          currentFolder === null ? t("library.subtitle") : t("library.includesSubfolders")
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(true)}>
              {t("library.newFolder")}
            </Button>
            <UploadButton folderId={currentFolder?.id ?? null} />
            {currentFolder === null ? null : (
              <>
                <Button variant="secondary" onClick={() => setRenameOpen(true)}>
                  {t("common.rename")}
                </Button>
                <Button variant="secondary" onClick={() => setMoveOpen(true)}>
                  {t("common.move")}
                </Button>
                <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                  {t("common.delete")}
                </Button>
              </>
            )}
          </div>
        }
      />

      {actionError === null ? null : (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {t(actionError)}
        </p>
      )}

      <Card className="grid gap-3 p-4 sm:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="text-muted block text-xs font-medium">
            {t("library.sortLabel")}
          </span>
          <Select
            value={sort}
            onChange={(event) => changeSort(event.target.value as SortField)}
          >
            <option value="name">{t("library.sortName")}</option>
            <option value="createdAt">{t("library.sortCreated")}</option>
            <option value="updatedAt">{t("library.sortUpdated")}</option>
          </Select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted block text-xs font-medium">
            {t("library.directionLabel")}
          </span>
          <Select
            value={direction}
            onChange={(event) => changeDirection(event.target.value as "asc" | "desc")}
          >
            <option value="asc">{t("library.ascending")}</option>
            <option value="desc">{t("library.descending")}</option>
          </Select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted block text-xs font-medium">
            {t("library.typeLabel")}
          </span>
          <Select
            value={type}
            onChange={(event) => changeType(event.target.value as LibraryFileType)}
          >
            <option value="all">{t("library.allTypes")}</option>
            <option value="documents">{t("library.documents")}</option>
            <option value="images">{t("library.images")}</option>
          </Select>
        </label>
      </Card>

      {children.length === 0 ? null : (
        <section aria-labelledby="library-folders" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="library-folders" className="text-sm font-semibold">
              {t("library.folders")}
            </h2>
            <span className="text-muted text-xs">{children.length}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {children.map((folder) => (
              <FolderCard key={folder.id} folder={folder} />
            ))}
          </div>
        </section>
      )}

      {isEmpty ? (
        <EmptyState
          icon={<LibraryIcon className="size-6" />}
          title={
            currentFolder === null
              ? t("library.emptyTitle")
              : t("library.emptyFolderTitle")
          }
          description={
            currentFolder === null ? t("library.emptyBody") : t("library.emptyFolderBody")
          }
          action={
            <Button variant="secondary" onClick={() => setCreateOpen(true)}>
              {t("library.newFolder")}
            </Button>
          }
        />
      ) : (
        <section aria-labelledby="library-files" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="library-files" className="text-sm font-semibold">
              {t("library.files")}{" "}
              <span className="text-muted font-normal">({total})</span>
            </h2>
            {total === 0 ? null : (
              <span className="text-muted text-xs">
                {t("library.showing")} {items.length} / {total}
              </span>
            )}
          </div>

          {items.length === 0 ? (
            type === "all" ? (
              <p className="text-muted border-border rounded-card border border-dashed p-6 text-sm">
                {t("library.emptyFolderBody")}
              </p>
            ) : (
              <EmptyState
                title={t("library.filteredEmptyTitle")}
                description={t("library.filteredEmptyBody")}
                action={
                  <Button variant="secondary" onClick={clearFilters}>
                    {t("library.clearFilters")}
                  </Button>
                }
              />
            )
          ) : (
            <ul className="border-border bg-surface divide-border rounded-card divide-y overflow-hidden border">
              {items.map((file) => (
                <FileRow key={file.id} file={file} />
              ))}
            </ul>
          )}

          {items.length < total && limit < PAGE_MAX ? (
            <Button
              variant="secondary"
              onClick={() => setLimit((value) => Math.min(value + PAGE_STEP, PAGE_MAX))}
            >
              {t("library.showMore")}
            </Button>
          ) : null}
        </section>
      )}

      <CreateFolderDialog
        open={createOpen}
        parentId={currentFolder?.id ?? null}
        onClose={() => setCreateOpen(false)}
      />

      {renameOpen && currentFolder !== null ? (
        <NameDialog
          title={t("folderActions.renameTitle")}
          description={t("folderActions.renameDescription")}
          label={t("library.folderName")}
          initialValue={currentFolder.name}
          submitLabel={t("common.save")}
          onSubmit={rename}
          onClose={() => setRenameOpen(false)}
        />
      ) : null}

      {moveOpen && currentFolder !== null ? (
        <MoveDialog
          title={t("folderActions.moveTitle")}
          description={t("folderActions.moveDescription")}
          folders={allFolders}
          initialFolderId={currentFolder.parentId}
          excluded={collectFolderSubtree(allFolders, currentFolder.id)}
          rootLabel={t("folderActions.moveToRoot")}
          onSubmit={move}
          onClose={() => setMoveOpen(false)}
        />
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        title={t("folderActions.deleteTitle")}
        description={t("folderActions.deleteBody")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        busy={deleteBusy}
        destructive
        onConfirm={() => void remove()}
        onClose={() => setDeleteOpen(false)}
      />
    </PageContainer>
  );
}
