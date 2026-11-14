"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { FolderId, SearchHit, TagId } from "@opennest/core";
import { formatNumber, useLocale, useTranslations } from "@opennest/localization";
import { Badge, Button, Card, Input, Select, Skeleton } from "@opennest/ui";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { useAppData } from "@/lib/data/app-data-provider";
import { useAsyncData } from "@/lib/data/hooks";
import { folderOptions } from "@/lib/folders";

type Kind = "file" | "note" | undefined;

export function SearchView() {
  const t = useTranslations();
  const { locale } = useLocale();
  const router = useRouter();
  const pathname = usePathname() ?? "/search";
  const searchParams = useSearchParams();
  const { services, workspace } = useAppData();
  const text = searchParams.get("q") ?? "";
  const kindParam = searchParams.get("kind");
  const kind: Kind = kindParam === "file" || kindParam === "note" ? kindParam : undefined;
  const folderParam = searchParams.get("folder");
  const folderId = folderParam === null ? undefined : (folderParam as FolderId);
  const tagIds = (searchParams.get("tags") ?? "")
    .split(",")
    .filter((value) => value.length > 0);
  const key = `search:${text}:${kind ?? "all"}:${folderId ?? "all"}:${tagIds.join(",")}`;
  const state = useAsyncData(key, async () => {
    const [folders, tags, hits] = await Promise.all([
      services.folder.list(workspace.id, { limit: 500, sort: "name" }),
      services.tag.list(workspace.id, { limit: 500, sort: "name" }),
      text.trim().length === 0
        ? Promise.resolve([] as SearchHit[])
        : services.search.search({
            workspaceId: workspace.id,
            text,
            ...(kind === undefined ? {} : { kinds: [kind] }),
            ...(folderId === undefined ? {} : { folderId }),
            ...(tagIds.length === 0 ? {} : { tagIds: tagIds as TagId[] }),
            limit: 100,
          }),
    ]);

    return { folders: folders.items, tags: tags.items, hits };
  });

  function update(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());

    for (const [name, value] of Object.entries(changes)) {
      if (value === null || value.length === 0) {
        params.delete(name);
      } else {
        params.set(name, value);
      }
    }

    const query = params.toString();
    router.replace(query.length === 0 ? pathname : `${pathname}?${query}`, {
      scroll: false,
    });
  }

  function toggleTag(id: string) {
    const next = tagIds.includes(id)
      ? tagIds.filter((value) => value !== id)
      : [...tagIds, id];

    update({ tags: next.length === 0 ? null : next.join(",") });
  }

  const data = state.data;
  const folders = data?.folders ?? [];
  const tags = data?.tags ?? [];
  const hits = data?.hits ?? [];
  const hasQuery = text.trim().length > 0;
  const hasFilters = kind !== undefined || folderId !== undefined || tagIds.length > 0;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <PageHeader title={t("search.title")} description={t("search.subtitle")} />

      <Card className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="search-input" className="sr-only">
            {t("search.placeholder")}
          </label>
          <Input
            id="search-input"
            type="search"
            value={text}
            autoFocus
            placeholder={t("search.placeholder")}
            onChange={(event) => update({ q: event.target.value })}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="search-kind" className="text-muted text-xs font-medium">
              {t("search.kindFilter")}
            </label>
            <Select
              id="search-kind"
              value={kind ?? ""}
              onChange={(event) => update({ kind: event.target.value || null })}
            >
              <option value="">{t("search.allKinds")}</option>
              <option value="file">{t("search.files")}</option>
              <option value="note">{t("search.notes")}</option>
            </Select>
          </div>

          <div className="space-y-1">
            <label htmlFor="search-folder" className="text-muted text-xs font-medium">
              {t("search.folderFilter")}
            </label>
            <Select
              id="search-folder"
              value={folderId ?? ""}
              onChange={(event) => update({ folder: event.target.value || null })}
            >
              <option value="">{t("search.allFolders")}</option>
              {folderOptions(folders).map((option) => (
                <option key={option.folder.id} value={option.folder.id}>
                  {`${"\u00A0".repeat(option.depth * 2)}${option.folder.name}`}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {tags.length === 0 ? null : (
          <fieldset className="min-w-0 space-y-2 border-0 p-0">
            <legend className="text-muted text-xs font-medium">
              {t("search.tagsFilter")}
            </legend>
            <ul className="flex max-h-28 flex-wrap gap-2 overflow-auto">
              {tags.map((tag) => {
                const active = tagIds.includes(tag.id);

                return (
                  <li key={tag.id}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleTag(tag.id)}
                      className={
                        active
                          ? "bg-primary text-primary-foreground inline-flex min-h-9 items-center gap-2 rounded-full px-3 text-sm"
                          : "border-border text-foreground hover:bg-border/30 inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-sm"
                      }
                    >
                      <span
                        aria-hidden="true"
                        className="size-2.5 rounded-full border border-black/10"
                        style={{ backgroundColor: tag.color ?? "#8b9490" }}
                      />
                      {tag.name}
                    </button>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        )}

        {hasQuery && hasFilters ? (
          <Button
            variant="secondary"
            onClick={() => update({ kind: null, folder: null, tags: null })}
          >
            {t("search.clear")}
          </Button>
        ) : null}
      </Card>

      {state.error !== null ? (
        <div role="alert" className="space-y-3">
          <h2 className="text-lg font-semibold">{t("errors.unexpected")}</h2>
          <Button onClick={state.reload}>{t("common.retry")}</Button>
        </div>
      ) : state.loading && data === null ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : !hasQuery ? (
        <EmptyState
          title={t("search.promptTitle")}
          description={t("search.promptBody")}
        />
      ) : hits.length === 0 ? (
        <EmptyState
          title={t("search.noResultsTitle")}
          description={t("search.noResultsBody")}
        />
      ) : (
        <section aria-labelledby="search-results" className="space-y-3">
          <h2
            id="search-results"
            role="status"
            aria-live="polite"
            className="text-sm font-semibold"
          >
            {formatNumber(locale, hits.length)} {t("search.resultCount")}
          </h2>
          <ul className="border-border bg-surface divide-border divide-y overflow-hidden rounded-xl border">
            {hits.map((hit) => (
              <li key={`${hit.kind}:${hit.id}`}>
                <Link
                  href={hit.kind === "file" ? `/files/${hit.id}` : `/notes/${hit.id}`}
                  className="hover:bg-border/30 block px-4 py-3"
                >
                  <div className="flex items-center gap-2">
                    <Badge>
                      {hit.kind === "file" ? t("search.files") : t("search.notes")}
                    </Badge>
                    <span className="min-w-0 truncate font-medium">{hit.title}</span>
                  </div>
                  <p className="text-muted mt-1 line-clamp-2 text-sm">{hit.snippet}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
