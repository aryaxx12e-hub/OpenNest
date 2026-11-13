import { z } from "zod";

import type { FileFilter, NoteFilter } from "@opennest/core";

import {
  folderIdSchema,
  mimeTypeSchema,
  searchTextSchema,
  tagIdSchema,
  withDomainCode,
} from "./common";

export const fileFilterSchema: z.ZodType<FileFilter> = withDomainCode(
  z.strictObject({
    folderId: folderIdSchema.nullable().optional(),
    tagIds: z.array(tagIdSchema).optional(),
    mimeTypes: z.array(mimeTypeSchema).optional(),
    text: searchTextSchema.optional(),
  })
);

export const noteFilterSchema: z.ZodType<NoteFilter> = withDomainCode(
  z.strictObject({
    folderId: folderIdSchema.nullable().optional(),
    tagIds: z.array(tagIdSchema).optional(),
    pinned: z.boolean({ error: "Pinned must be a boolean." }).optional(),
    text: searchTextSchema.optional(),
  })
);
