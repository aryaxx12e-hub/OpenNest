import type { Metadata } from "next";

import type { NoteId } from "@opennest/core";

import { NoteEditor } from "@/components/note-editor";

export const metadata: Metadata = {
  title: "Note · OpenNest",
};

export default async function NotePage({
  params,
}: {
  params: Promise<{ noteId: string }>;
}) {
  const { noteId } = await params;

  return <NoteEditor noteId={noteId as NoteId} />;
}
