import { z } from "zod";

import type { SearchQuery } from "@opennest/core";

import {
  folderIdSchema,
  offsetSchema,
  pageLimitSchema,
  searchTextSchema,
  tagIdSchema,
  withDomainCode,
  workspaceIdSchema,
} from "./common";

export const searchQuerySchema: z.ZodType<SearchQuery> = withDomainCode(
  z.strictObject({
    workspaceId: workspaceIdSchema,
    text: searchTextSchema,
    kinds: z
      .array(z.enum(["file", "note"], { error: "Kind must be file or note." }))
      .min(1, { error: "Kinds must not be empty." })
      .refine((kinds) => new Set(kinds).size === kinds.length, {
        message: "Kinds must not repeat.",
      })
      .optional(),
    folderId: folderIdSchema.nullable().optional(),
    tagIds: z.array(tagIdSchema).optional(),
    limit: pageLimitSchema.optional(),
    offset: offsetSchema.optional(),
  })
);
