import type { Metadata } from "next";

import type { FileId } from "@opennest/core";

import { FilePreview } from "@/components/file-preview";

export const metadata: Metadata = {
  title: "File · OpenNest",
};

export default async function FilePage({
  params,
}: {
  params: Promise<{ fileId: string }>;
}) {
  const { fileId } = await params;

  return <FilePreview fileId={fileId as FileId} />;
}
