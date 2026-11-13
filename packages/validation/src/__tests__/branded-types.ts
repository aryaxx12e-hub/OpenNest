import type { BlobKey, FolderId, IsoDate } from "@opennest/core";

import { blobKeySchema, folderIdSchema, isoDateSchema } from "../common";

const V4 = "3f2b8c1e-9d4a-4f6b-8c2d-1a2b3c4d5e6f";

const folderId: FolderId = folderIdSchema.parse(V4);
const blobKey: BlobKey = blobKeySchema.parse(V4);
const createdAt: IsoDate = isoDateSchema.parse("2026-11-12T00:00:00.000Z");

void folderId;
void blobKey;
void createdAt;
