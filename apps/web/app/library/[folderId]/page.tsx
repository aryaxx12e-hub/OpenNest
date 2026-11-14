import type { Metadata } from "next";

import type { FolderId } from "@opennest/core";

import { LibraryBrowser } from "@/components/library-browser";

export const metadata: Metadata = {
  title: "Folder · OpenNest",
};

export default async function FolderPage({
  params,
}: {
  params: Promise<{ folderId: string }>;
}) {
  const { folderId } = await params;

  return <LibraryBrowser folderId={folderId as FolderId} />;
}
