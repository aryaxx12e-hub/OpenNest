import type { z } from "zod";

import type { fileInputSchema, filePatchSchema } from "./file";
import type { folderInputSchema, folderPatchSchema } from "./folder";
import type { noteInputSchema, notePatchSchema } from "./note";
import type { tagInputSchema, tagPatchSchema } from "./tag";

export type { FileFilter, NoteFilter, SearchQuery } from "@opennest/core";

export type FolderInput = z.output<typeof folderInputSchema>;
export type FolderPatch = z.output<typeof folderPatchSchema>;
export type FileInput = z.output<typeof fileInputSchema>;
export type FilePatch = z.output<typeof filePatchSchema>;
export type NoteInput = z.output<typeof noteInputSchema>;
export type NotePatch = z.output<typeof notePatchSchema>;
export type TagInput = z.output<typeof tagInputSchema>;
export type TagPatch = z.output<typeof tagPatchSchema>;
