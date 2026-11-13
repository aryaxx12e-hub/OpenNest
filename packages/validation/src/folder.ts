import { z } from "zod";

import {
  displayNameSchema,
  workspaceIdSchema,
  folderIdSchema,
  isoDateSchema,
  withDomainCode,
} from "./common";

const atSchema = isoDateSchema.optional();

export const folderInputSchema = withDomainCode(
  z.strictObject({
    workspaceId: workspaceIdSchema,
    parentId: folderIdSchema.nullable(),
    name: displayNameSchema,
    at: atSchema,
  })
);

export const folderPatchSchema = withDomainCode(
  z
    .strictObject({
      name: displayNameSchema.optional(),
      parentId: folderIdSchema.nullable().optional(),
      at: atSchema,
    })
    .refine((patch) => patch.name !== undefined || patch.parentId !== undefined, {
      message: "Patch must change at least one field.",
    })
);
