"use client";

import Link from "next/link";

import { useTranslations } from "@opennest/localization";
import { Badge } from "@opennest/ui";

import type { Passage } from "@/lib/ai/retrieval/types";

export interface CitationListProps {
  citations: readonly Passage[];
  title?: string;
}

export function CitationList({ citations, title }: CitationListProps) {
  const t = useTranslations();

  if (citations.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2" data-testid="qa-citations">
      <h3 className="text-sm font-medium">{title ?? t("ai.qa.citationsTitle")}</h3>
      <ol className="space-y-2">
        {citations.map((citation) => (
          <li key={citation.id}>
            <Link
              href={
                citation.kind === "note"
                  ? `/notes/${citation.sourceId}`
                  : `/files/${citation.sourceId}`
              }
              className="border-border hover:bg-border/30 rounded-control flex min-h-11 items-center gap-2 border px-3 py-2 transition-colors"
            >
              <Badge tone={citation.kind === "note" ? "primary" : "neutral"}>
                {citation.kind === "note"
                  ? t("ai.qa.citationNote")
                  : t("ai.qa.citationFile")}
              </Badge>
              <span className="min-w-0 flex-1 truncate text-sm">
                {citation.sourceTitle}
              </span>
              <span className="text-muted text-xs">{t("ai.qa.citationOpen")}</span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
