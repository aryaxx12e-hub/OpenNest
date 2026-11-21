"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import type { FileId } from "@opennest/core";
import { useTranslations } from "@opennest/localization";

import { EmptyState } from "@/components/empty-state";
import { FilePreview } from "@/components/file-preview";
import { PageContainer } from "@/components/page-container";

export function FilesRoute() {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const fileId = searchParams.get("fileId");

  if (fileId === null) {
    return (
      <PageContainer>
        <EmptyState
          title={t("file.noSelectionTitle")}
          description={t("file.noSelectionBody")}
          action={
            <Link className="text-primary text-sm font-medium underline" href="/library">
              {t("file.back")}
            </Link>
          }
        />
      </PageContainer>
    );
  }

  return <FilePreview key={fileId} fileId={fileId as FileId} />;
}
