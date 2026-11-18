"use client";

import { useId, useState } from "react";

import type { Note, NoteId } from "@opennest/core";
import { useLocale, useTranslations } from "@opennest/localization";
import { Button, Dialog, Input, Label } from "@opennest/ui";

import { errorKey } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";

export interface NoteLinksDialogProps {
  notes: readonly Note[];
  notesTotal: number;
  selected: readonly NoteId[];
  currentNoteId: NoteId;
  onSave: (noteIds: NoteId[]) => Promise<void>;
  onClose: () => void;
}

export function NoteLinksDialog({
  notes,
  notesTotal,
  selected,
  currentNoteId,
  onSave,
  onClose,
}: NoteLinksDialogProps) {
  const t = useTranslations();
  const { locale } = useLocale();
  const formId = useId();
  const searchId = useId();
  const [chosen, setChosen] = useState<Set<string>>(new Set(selected));
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available = notes.filter((note) => note.id !== currentNoteId);
  const normalizedQuery = query.trim().toLocaleLowerCase(locale);
  const filtered =
    normalizedQuery.length === 0
      ? available
      : available.filter(
          (note) =>
            note.title.toLocaleLowerCase(locale).includes(normalizedQuery) ||
            note.content.toLocaleLowerCase(locale).includes(normalizedQuery)
        );

  function toggle(id: string) {
    setChosen((previous) => {
      const next = new Set(previous);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }

  async function save() {
    setBusy(true);
    setError(null);

    try {
      await onSave([...chosen] as NoteId[]);
      onClose();
    } catch (caught) {
      setError(errorKey(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title={t("notes.linkDialogTitle")}
      description={t("notes.linkDialogDescription")}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={formId} loading={busy}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor={searchId}>{t("notes.linkSearch")}</Label>
          <Input
            id={searchId}
            type="search"
            value={query}
            placeholder={t("notes.linkSearch")}
            disabled={busy}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {available.length === 0 ? (
          <p className="text-muted text-sm">{t("notes.linkEmpty")}</p>
        ) : filtered.length === 0 ? (
          <p className="text-muted text-sm">{t("notes.linkNoMatches")}</p>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-auto">
            {filtered.map((note) => (
              <li key={note.id}>
                <label className="hover:bg-border/30 flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2">
                  <input
                    type="checkbox"
                    checked={chosen.has(note.id)}
                    disabled={busy}
                    onChange={() => toggle(note.id)}
                    className="size-4"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {note.title.trim().length === 0 ? t("notes.untitled") : note.title}
                    </span>
                    <span className="text-muted block text-xs">
                      {formatDateTime(locale, note.updatedAt)}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        {notesTotal > notes.length ? (
          <p className="text-muted text-xs">{t("notes.linkLimit")}</p>
        ) : null}

        {error === null ? null : (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {t(error)}
          </p>
        )}
      </form>
    </Dialog>
  );
}
