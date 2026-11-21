"use client";

import Link from "next/link";

import { useTranslations } from "@opennest/localization";

import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";

export function NotFoundView() {
  const t = useTranslations();

  return (
    <PageContainer>
      <EmptyState
        title={t("common.notFoundTitle")}
        description={t("common.notFoundBody")}
        action={
          <Link className="text-primary text-sm font-medium underline" href="/">
            {t("common.backHome")}
          </Link>
        }
      />
    </PageContainer>
  );
}
