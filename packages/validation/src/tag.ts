import { z } from "zod";

import {
  workspaceIdSchema,
  isoDateSchema,
  tagColorSchema,
  tagNameSchema,
  withDomainCode,
} from "./common";

const atSchema = isoDateSchema.optional();

export const tagInputSchema = withDomainCode(
  z.strictObject({
    workspaceId: workspaceIdSchema,
    name: tagNameSchema,
    color: tagColorSchema.optional(),
    at: atSchema,
  })
);

export const tagPatchSchema = withDomainCode(
  z
    .strictObject({
      name: tagNameSchema.optional(),
      color: tagColorSchema.optional(),
      at: atSchema,
    })
    .refine((patch) => patch.name !== undefined || patch.color !== undefined, {
      message: "Patch must change at least one field.",
    })
);
