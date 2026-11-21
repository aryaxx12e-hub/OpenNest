"use client";

import { useSearchParams } from "next/navigation";

import type { FolderId } from "@opennest/core";

import { LibraryBrowser } from "@/components/library-browser";

export function LibraryRoute() {
  const searchParams = useSearchParams();
  const folderId = searchParams.get("folderId");

  return (
    <LibraryBrowser
      key={folderId ?? "root"}
      folderId={folderId === null ? null : (folderId as FolderId)}
    />
  );
}
