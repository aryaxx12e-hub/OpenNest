"use client";

import { useId, useState } from "react";

import type { Tag, TagId } from "@opennest/core";
import { useTranslations } from "@opennest/localization";
import { Button, Dialog, Input, Label } from "@opennest/ui";

import { errorKey } from "@/lib/errors";

export interface TagDialogProps {
  tags: readonly Tag[];
  selected: readonly TagId[];
  onCreate: (name: string) => Promise<Tag>;
  onSave: (tagIds: TagId[]) => Promise<void>;
  onClose: () => void;
}

export function TagDialog({ tags, selected, onCreate, onSave, onClose }: TagDialogProps) {
  const t = useTranslations();
  const formId = useId();
  const newTagId = useId();
  const [items, setItems] = useState<Tag[]>([...tags]);
  const [chosen, setChosen] = useState<Set<string>>(new Set(selected));
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function create() {
    if (name.trim().length === 0) {
      setError("errors.tagNameRequired");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const tag = await onCreate(name);
      setItems((previous) => [...previous, tag]);
      setChosen((previous) => new Set([...previous, tag.id]));
      setName("");
    } catch (caught) {
      setError(errorKey(caught));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);

    try {
      await onSave([...chosen] as TagId[]);
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
      title={t("file.tags")}
      description={t("file.tagsDescription")}
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
        {items.length === 0 ? (
          <p className="text-muted text-sm">{t("file.noTags")}</p>
        ) : (
          <ul className="max-h-56 space-y-1 overflow-auto">
            {items.map((tag) => (
              <li key={tag.id}>
                <label className="hover:bg-border/30 flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2">
                  <input
                    type="checkbox"
                    checked={chosen.has(tag.id)}
                    disabled={busy}
                    onChange={() => toggle(tag.id)}
                    className="size-4"
                  />
                  <span
                    aria-hidden="true"
                    className="size-3 rounded-full border border-black/10"
                    style={{ backgroundColor: tag.color ?? "#8b9490" }}
                  />
                  <span className="truncate text-sm">{tag.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}

        <div className="border-border space-y-2 border-t pt-4">
          <Label htmlFor={newTagId}>{t("file.newTag")}</Label>
          <div className="flex gap-2">
            <Input
              id={newTagId}
              value={name}
              maxLength={50}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
            <Button variant="secondary" onClick={() => void create()} disabled={busy}>
              {t("file.createTag")}
            </Button>
          </div>
        </div>

        {error === null ? null : (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {t(error)}
          </p>
        )}
      </form>
    </Dialog>
  );
}
