import { z } from "zod";

import {
  folderIdSchema,
  workspaceIdSchema,
  isoDateSchema,
  noteContentSchema,
  noteTitleSchema,
  withDomainCode,
} from "./common";

const atSchema = isoDateSchema.optional();

export const noteInputSchema = withDomainCode(
  z.strictObject({
    workspaceId: workspaceIdSchema,
    folderId: folderIdSchema.nullable(),
    title: noteTitleSchema,
    content: noteContentSchema.default(""),
    pinned: z.boolean({ error: "Pinned must be a boolean." }).default(false),
    at: atSchema,
  })
);

export const notePatchSchema = withDomainCode(
  z
    .strictObject({
      title: noteTitleSchema.optional(),
      content: noteContentSchema.optional(),
      folderId: folderIdSchema.nullable().optional(),
      pinned: z.boolean({ error: "Pinned must be a boolean." }).optional(),
      at: atSchema,
    })
    .refine(
      (patch) =>
        patch.title !== undefined ||
        patch.content !== undefined ||
        patch.folderId !== undefined ||
        patch.pinned !== undefined,
      { message: "Patch must change at least one field." }
    )
);
