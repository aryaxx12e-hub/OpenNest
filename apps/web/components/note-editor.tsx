"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import type { Folder, FolderId, Note, NoteId, Tag, TagId } from "@opennest/core";
import { useLocale, useTranslations } from "@opennest/localization";
import { Button, Card, ConfirmDialog, Input, Skeleton } from "@opennest/ui";

import { LiveBadge } from "@/components/collaboration/live-badge";
import { Presence } from "@/components/collaboration/presence";
import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { EmptyState } from "@/components/empty-state";
import { MarkdownPreview } from "@/components/markdown-preview";
import { MoveDialog } from "@/components/move-dialog";
import { NoteLinksDialog } from "@/components/note-links-dialog";
import { PageContainer } from "@/components/page-container";
import { TagDialog } from "@/components/tag-dialog";
import { useNoteAutosave, type NoteSavePatch } from "@/lib/autosave/use-note-autosave";
import { readBrowserCollaborationConfig } from "@/lib/collaboration/provider";
import { useCollaboration } from "@/lib/collaboration/use-collaboration";
import { useAppData } from "@/lib/data/app-data-provider";
import { downloadTextFile } from "@/lib/data/backup";
import { useAsyncData } from "@/lib/data/hooks";
import { useSaveCoordinator } from "@/lib/data/save-coordinator";
import { errorKey } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { noteMarkdownDocument, noteMarkdownFileName } from "@/lib/notes";

export function NoteEditor({ noteId }: { noteId: NoteId }) {
  const t = useTranslations();
  const { services, workspace } = useAppData();
  const state = useAsyncData(`note:${noteId}`, async () => {
    const note = await services.note.get(noteId);

    if (note === null) {
      return { missing: true as const };
    }

    const [folders, allTags, noteTags, links, notes] = await Promise.all([
      services.folder.list(workspace.id, { limit: 500, sort: "name" }),
      services.tag.list(workspace.id, { limit: 500, sort: "name" }),
      services.note.tags(note.id),
      services.note.links(note.id),
      services.note.list(
        workspace.id,
        {},
        { limit: 500, sort: "updatedAt", direction: "desc" }
      ),
    ]);
    const linkedNotes = (
      await Promise.all(links.map((link) => services.note.get(link.targetNoteId)))
    ).filter((linked): linked is Note => linked !== null);

    return {
      missing: false as const,
      note,
      folders: folders.items,
      allTags: allTags.items,
      noteTags,
      linkedNotes,
      allNotes: notes.items,
      notesTotal: notes.total,
    };
  });

  if (state.loading && state.data === null) {
    return (
      <PageContainer className="max-w-5xl space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-96 w-full" />
      </PageContainer>
    );
  }

  if (state.error !== null) {
    return (
      <PageContainer className="max-w-5xl">
        <div role="alert" className="space-y-3">
          <h1 className="text-xl font-semibold">{t("errors.unexpected")}</h1>
          <Button onClick={state.reload}>{t("common.retry")}</Button>
        </div>
      </PageContainer>
    );
  }

  const data = state.data;

  if (data === null || data.missing) {
    return (
      <PageContainer className="max-w-5xl">
        <EmptyState
          title={t("notes.notFoundTitle")}
          description={t("notes.notFoundBody")}
          action={
            <Link className="text-primary text-sm font-medium underline" href="/notes">
              {t("notes.back")}
            </Link>
          }
        />
      </PageContainer>
    );
  }

  return (
    <NoteEditorForm
      key={data.note.id}
      note={data.note}
      folders={data.folders}
      allTags={data.allTags}
      noteTags={data.noteTags}
      linkedNotes={data.linkedNotes}
      allNotes={data.allNotes}
      notesTotal={data.notesTotal}
    />
  );
}

function NoteEditorForm({
  note,
  folders,
  allTags,
  noteTags,
  linkedNotes,
  allNotes,
  notesTotal,
}: {
  note: Note;
  folders: Folder[];
  allTags: Tag[];
  noteTags: Tag[];
  linkedNotes: Note[];
  allNotes: Note[];
  notesTotal: number;
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
    applyRemoteContent,
  } = autosave;
  const [collaborationConfig] = useState(readBrowserCollaborationConfig);
  const collaboration = useCollaboration({
    noteId: note.id,
    shared: collaborationConfig?.shared ?? false,
    url: collaborationConfig?.url ?? null,
    initialText: note.content,
    onTextChange: (text, source) => {
      if (source !== "local") {
        applyRemoteContent(text);
      }
    },
  });
  const draftSentRef = useRef(false);
  const sendCollaborationText = collaboration.setText;

  useEffect(() => {
    if (!draftRestored || draftSentRef.current) {
      return;
    }

    draftSentRef.current = true;
    sendCollaborationText(content);
  }, [draftRestored, content, sendCollaborationText]);

  const [pinned, setPinned] = useState(note.pinned);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [tagsOpen, setTagsOpen] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

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

  async function saveLinks(noteIds: NoteId[]) {
    await services.note.setLinks(note.id, noteIds);
    invalidate();
  }

  function exportMarkdown() {
    setActionError(null);
    setActionSuccess(null);

    try {
      downloadTextFile(
        noteMarkdownFileName(title),
        noteMarkdownDocument(title, content),
        "text/markdown"
      );
      setActionSuccess("notes.exportSuccess");
    } catch {
      setActionError("notes.exportError");
    }
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
    <PageContainer className="max-w-5xl">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
        <Link
          href="/notes"
          className="text-muted hover:text-foreground text-sm underline-offset-4 hover:underline"
        >
          {t("notes.back")}
        </Link>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={collaboration.readOnly}
            onClick={() => void togglePinned()}
          >
            {pinned ? t("notes.unpin") : t("notes.pin")}
          </Button>
          <Button
            variant="secondary"
            disabled={collaboration.readOnly}
            onClick={() => setTagsOpen(true)}
          >
            {t("file.tags")}
          </Button>
          <Button
            variant="secondary"
            disabled={collaboration.readOnly}
            onClick={() => setLinksOpen(true)}
          >
            {t("notes.links")}
          </Button>
          <Button variant="secondary" onClick={exportMarkdown}>
            {t("notes.exportMarkdown")}
          </Button>
          <Button
            variant="secondary"
            disabled={collaboration.readOnly}
            onClick={() => setMoveOpen(true)}
          >
            {t("common.move")}
          </Button>
          <Button
            variant="danger"
            disabled={collaboration.readOnly}
            onClick={() => setDeleteOpen(true)}
          >
            {t("common.delete")}
          </Button>
        </div>
      </Card>

      {actionError === null ? null : (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {t(actionError)}
        </p>
      )}
      {actionSuccess === null ? null : (
        <p role="status" className="text-muted text-sm">
          {t(actionSuccess)}
        </p>
      )}

      <div className="space-y-2">
        <label htmlFor="note-title" className="sr-only">
          {t("notes.noteTitle")}
        </label>
        <Input
          id="note-title"
          value={title}
          readOnly={collaboration.readOnly}
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
        {collaborationConfig === null ? null : (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <LiveBadge status={collaboration.status} readOnly={collaboration.readOnly} />
            <Presence participants={collaboration.participants} />
          </div>
        )}
        {collaborationConfig === null ? null : collaboration.readOnly ? (
          <p role="status" className="text-muted text-xs">
            {t("collaboration.readOnlyNotice")}
          </p>
        ) : collaboration.status === "reconnecting" ||
          collaboration.status === "offline" ? (
          <p role="status" className="text-muted text-xs">
            {t("collaboration.reconnectingNotice")}
          </p>
        ) : null}
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

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t("notes.linkedNotes")}</h2>
          <Button
            variant="ghost"
            size="sm"
            disabled={collaboration.readOnly}
            onClick={() => setLinksOpen(true)}
          >
            {t("notes.editLinks")}
          </Button>
        </div>
        {linkedNotes.length === 0 ? (
          <p className="text-muted text-sm">{t("notes.noLinkedNotes")}</p>
        ) : (
          <ul className="space-y-1">
            {linkedNotes.map((linked) => (
              <li key={linked.id}>
                <Link
                  href={`/notes/${linked.id}`}
                  className="text-primary inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline"
                >
                  {linked.title.trim().length === 0 ? t("notes.untitled") : linked.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

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
              ? "bg-primary text-primary-foreground rounded-control min-h-10 px-3 text-sm font-medium"
              : "text-muted hover:bg-border/40 rounded-control min-h-10 px-3 text-sm"
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
              ? "bg-primary text-primary-foreground rounded-control min-h-10 px-3 text-sm font-medium"
              : "text-muted hover:bg-border/40 rounded-control min-h-10 px-3 text-sm"
          }
        >
          {t("notes.preview")}
        </button>
      </div>

      {mode === "edit" ? (
        <div role="tabpanel" id={editPanelId} aria-labelledby={editTabId}>
          <MarkdownEditor
            value={content}
            ariaLabel={t("notes.editor")}
            readOnly={collaboration.readOnly}
            rows={20}
            className="min-h-[55vh] font-mono"
            placeholder={t("notes.previewEmpty")}
            onChange={(value) => {
              autosave.setContent(value);
              collaboration.setText(value);
            }}
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

      {linksOpen ? (
        <NoteLinksDialog
          notes={allNotes}
          notesTotal={notesTotal}
          selected={linkedNotes.map((linked) => linked.id)}
          currentNoteId={note.id}
          onSave={saveLinks}
          onClose={() => setLinksOpen(false)}
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
    </PageContainer>
  );
}
