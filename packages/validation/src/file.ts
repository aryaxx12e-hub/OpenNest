import { z } from "zod";

import {
  blobKeySchema,
  workspaceIdSchema,
  checksumSchema,
  displayNameSchema,
  folderIdSchema,
  isoDateSchema,
  mimeTypeSchema,
  sizeBytesSchema,
  withDomainCode,
} from "./common";

const atSchema = isoDateSchema.optional();

export const fileInputSchema = withDomainCode(
  z.strictObject({
    workspaceId: workspaceIdSchema,
    folderId: folderIdSchema.nullable(),
    name: displayNameSchema,
    mimeType: mimeTypeSchema.nullable(),
    sizeBytes: sizeBytesSchema,
    blobKey: blobKeySchema,
    checksum: checksumSchema,
    at: atSchema,
  })
);

export const filePatchSchema = withDomainCode(
  z
    .strictObject({
      name: displayNameSchema.optional(),
      folderId: folderIdSchema.nullable().optional(),
      at: atSchema,
    })
    .refine((patch) => patch.name !== undefined || patch.folderId !== undefined, {
      message: "Patch must change at least one field.",
    })
);
