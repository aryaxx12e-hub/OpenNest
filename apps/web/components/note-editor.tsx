"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useId, useState, type KeyboardEvent } from "react";

import type { Folder, FolderId, Note, NoteId, Tag, TagId } from "@opennest/core";
import { useLocale, useTranslations } from "@opennest/localization";
import { Button, Card, ConfirmDialog, Input, Skeleton, Textarea } from "@opennest/ui";

import { EmptyState } from "@/components/empty-state";
import { MarkdownPreview } from "@/components/markdown-preview";
import { MoveDialog } from "@/components/move-dialog";
import { TagDialog } from "@/components/tag-dialog";
import { useNoteAutosave, type NoteSavePatch } from "@/lib/autosave/use-note-autosave";
import { useAppData } from "@/lib/data/app-data-provider";
import { useAsyncData } from "@/lib/data/hooks";
import { useSaveCoordinator } from "@/lib/data/save-coordinator";
import { errorKey } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";

export function NoteEditor({ noteId }: { noteId: NoteId }) {
  const t = useTranslations();
  const { services, workspace } = useAppData();
  const state = useAsyncData(`note:${noteId}`, async () => {
    const note = await services.note.get(noteId);

    if (note === null) {
      return { missing: true as const };
    }

    const [folders, allTags, noteTags] = await Promise.all([
      services.folder.list(workspace.id, { limit: 500, sort: "name" }),
      services.tag.list(workspace.id, { limit: 500, sort: "name" }),
      services.note.tags(note.id),
    ]);

    return {
      missing: false as const,
      note,
      folders: folders.items,
      allTags: allTags.items,
      noteTags,
    };
  });

  if (state.loading && state.data === null) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6 sm:px-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-96 w-full" />
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
          title={t("notes.notFoundTitle")}
          description={t("notes.notFoundBody")}
          action={
            <Link className="text-primary text-sm font-medium underline" href="/notes">
              {t("notes.back")}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <NoteEditorForm
      key={data.note.id}
      note={data.note}
      folders={data.folders}
      allTags={data.allTags}
      noteTags={data.noteTags}
    />
  );
}

function NoteEditorForm({
  note,
  folders,
  allTags,
  noteTags,
}: {
  note: Note;
  folders: Folder[];
  allTags: Tag[];
  noteTags: Tag[];
}) {
  const t = useTranslations();
  const { locale } = useLocale();
  const router = useRouter();
  const { drafts, services, workspace, invalidate } = useAppData();
  const titleErrorId = useId();
  const tabPrefix = useId();
  const editTabId = `${tabPrefix}-edit-tab`;
  const previewTabId = `${tabPrefix}-preview-tab`;
  const editPanelId = `${tabPrefix}-edit-panel`;
  const previewPanelId = `${tabPrefix}-preview-panel`;
  const coordinator = useSaveCoordinator();
  const save = useCallback(
    (patch: NoteSavePatch) => services.note.update(note.id, patch),
    [services, note.id]
  );
  const autosave = useNoteAutosave({
    note,
    save,
    coordinator,
    draftStore: drafts,
  });
  const {
    title,
    content,
    updatedAt,
    saving,
    saveError,
    draftError,
    dirty,
    titleMissing,
    draftRestored,
  } = autosave;
  const [pinned, setPinned] = useState(note.pinned);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [tagsOpen, setTagsOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function togglePinned() {
    setActionError(null);

    try {
      const updated = await services.note.update(note.id, { pinned: !pinned });
      setPinned(updated.pinned);
      invalidate();
    } catch (caught) {
      setActionError(errorKey(caught));
    }
  }

  async function move(folderId: FolderId | null) {
    await services.note.update(note.id, { folderId });
    invalidate();
  }

  async function createTag(name: string) {
    return services.tag.create({ workspaceId: workspace.id, name });
  }

  async function saveTags(tagIds: TagId[]) {
    await services.note.setTags(note.id, tagIds);
    invalidate();
  }

  async function remove() {
    setDeleteBusy(true);
    setActionError(null);

    try {
      await services.note.delete(note.id);
      autosave.deactivate();
      invalidate();
      setDeleteOpen(false);
      router.push("/notes");
    } catch (caught) {
      setDeleteOpen(false);
      setActionError(errorKey(caught));
    } finally {
      setDeleteBusy(false);
    }
  }

  function handleTabKeys(event: KeyboardEvent<HTMLDivElement>) {
    const current = mode === "edit" ? 0 : 1;
    let next = current;

    if (event.key === "ArrowRight") {
      next = (current + 1) % 2;
    } else if (event.key === "ArrowLeft") {
      next = (current + 1) % 2;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = 1;
    } else {
      return;
    }

    event.preventDefault();
    setMode(next === 0 ? "edit" : "preview");
    const tabs = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[next]?.focus();
  }

  const status =
    saveError !== null
      ? t("notes.saveError")
      : saving
        ? t("notes.saving")
        : dirty
          ? t("notes.unsaved")
          : t("notes.saved");

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/notes"
          className="text-muted hover:text-foreground text-sm underline-offset-4 hover:underline"
        >
          {t("notes.back")}
        </Link>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void togglePinned()}>
            {pinned ? t("notes.unpin") : t("notes.pin")}
          </Button>
          <Button variant="secondary" onClick={() => setTagsOpen(true)}>
            {t("file.tags")}
          </Button>
          <Button variant="secondary" onClick={() => setMoveOpen(true)}>
            {t("common.move")}
          </Button>
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>
            {t("common.delete")}
          </Button>
        </div>
      </div>

      {actionError === null ? null : (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {t(actionError)}
        </p>
      )}

      <div className="space-y-2">
        <label htmlFor="note-title" className="sr-only">
          {t("notes.noteTitle")}
        </label>
        <Input
          id="note-title"
          value={title}
          aria-invalid={titleMissing}
          aria-describedby={titleMissing ? titleErrorId : undefined}
          className="text-2xl font-semibold"
          placeholder={t("notes.untitled")}
          onChange={(event) => autosave.setTitle(event.target.value)}
          onBlur={() => {
            if (dirty) {
              void autosave.flush();
            }
          }}
        />
        {titleMissing ? (
          <p
            id={titleErrorId}
            role="alert"
            className="text-sm text-red-700 dark:text-red-300"
          >
            {t("errors.titleRequired")}
          </p>
        ) : null}
        {draftError === null ? null : (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {t(draftError)}
          </p>
        )}
        {draftRestored ? (
          <p role="status" className="text-muted text-xs">
            {t("notes.draftRestored")}
          </p>
        ) : null}
        <div className="text-muted flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span aria-live="polite">{status}</span>
          <span aria-hidden="true">·</span>
          <span>{formatDateTime(locale, updatedAt)}</span>
          {pinned ? <span>{t("notes.pinned")}</span> : null}
        </div>
        {noteTags.length === 0 ? null : (
          <ul className="flex flex-wrap gap-2 pt-1">
            {noteTags.map((tag) => (
              <li
                key={tag.id}
                className="border-border bg-surface inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs"
              >
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-full border border-black/10"
                  style={{ backgroundColor: tag.color ?? "#8b9490" }}
                />
                {tag.name}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div
        className="flex items-center gap-1"
        role="tablist"
        aria-label={t("notes.title")}
        onKeyDown={handleTabKeys}
      >
        <button
          type="button"
          role="tab"
          id={editTabId}
          aria-selected={mode === "edit"}
          aria-controls={editPanelId}
          tabIndex={mode === "edit" ? 0 : -1}
          onClick={() => setMode("edit")}
          className={
            mode === "edit"
              ? "bg-primary text-primary-foreground min-h-10 rounded-lg px-3 text-sm font-medium"
              : "text-muted hover:bg-border/40 min-h-10 rounded-lg px-3 text-sm"
          }
        >
          {t("notes.editor")}
        </button>
        <button
          type="button"
          role="tab"
          id={previewTabId}
          aria-selected={mode === "preview"}
          aria-controls={previewPanelId}
          tabIndex={mode === "preview" ? 0 : -1}
          onClick={() => setMode("preview")}
          className={
            mode === "preview"
              ? "bg-primary text-primary-foreground min-h-10 rounded-lg px-3 text-sm font-medium"
              : "text-muted hover:bg-border/40 min-h-10 rounded-lg px-3 text-sm"
          }
        >
          {t("notes.preview")}
        </button>
      </div>

      {mode === "edit" ? (
        <div role="tabpanel" id={editPanelId} aria-labelledby={editTabId}>
          <Textarea
            value={content}
            aria-label={t("notes.editor")}
            rows={20}
            className="min-h-[55vh] font-mono"
            placeholder={t("notes.previewEmpty")}
            onChange={(event) => autosave.setContent(event.target.value)}
            onBlur={() => {
              if (dirty) {
                void autosave.flush();
              }
            }}
          />
        </div>
      ) : (
        <div
          role="tabpanel"
          id={previewPanelId}
          aria-labelledby={previewTabId}
          tabIndex={0}
        >
          <Card>
            {content.trim().length === 0 ? (
              <p className="text-muted text-sm">{t("notes.previewEmpty")}</p>
            ) : (
              <MarkdownPreview content={content} />
            )}
          </Card>
        </div>
      )}

      {tagsOpen ? (
        <TagDialog
          tags={allTags}
          selected={noteTags.map((tag) => tag.id)}
          onCreate={createTag}
          onSave={saveTags}
          onClose={() => setTagsOpen(false)}
        />
      ) : null}

      {moveOpen ? (
        <MoveDialog
          title={t("notes.moveTitle")}
          description={t("notes.moveDescription")}
          folders={folders}
          initialFolderId={note.folderId}
          rootLabel={t("folderActions.moveToRoot")}
          onSubmit={move}
          onClose={() => setMoveOpen(false)}
        />
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        title={t("notes.deleteTitle")}
        description={t("notes.deleteBody")}
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
