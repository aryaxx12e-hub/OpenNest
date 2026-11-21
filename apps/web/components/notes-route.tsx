"use client";

import { useSearchParams } from "next/navigation";

import type { NoteId } from "@opennest/core";

import { NoteEditor } from "@/components/note-editor";
import { NotesList } from "@/components/notes-list";

export function NotesRoute() {
  const searchParams = useSearchParams();
  const noteId = searchParams.get("noteId");

  return noteId ? <NoteEditor key={noteId} noteId={noteId as NoteId} /> : <NotesList />;
}
