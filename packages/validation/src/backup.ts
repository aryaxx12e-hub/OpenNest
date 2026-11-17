import { z } from "zod";

import { blobKeySchema, isoDateSchema, mimeTypeSchema } from "./common";

export const BACKUP_FORMAT = "opennest-backup";
export const BACKUP_FORMAT_VERSION = 1;

const serializedBlobSchema = z.strictObject({
  key: blobKeySchema,
  mimeType: mimeTypeSchema,
  data: z.string({ error: "Blob data must be a base64 string." }),
});

export const serializedBackupSnapshotSchema = z.strictObject({
  snapshotVersion: z.literal(1),
  schemaVersion: z.number().int().min(0),
  kind: z.enum(["dexie", "sqlite"]),
  createdAt: isoDateSchema,
  workspace: z.unknown(),
  folders: z.array(z.unknown()),
  files: z.array(z.unknown()),
  notes: z.array(z.unknown()),
  tags: z.array(z.unknown()),
  fileTags: z.array(z.unknown()),
  noteTags: z.array(z.unknown()),
  noteLinks: z.array(z.unknown()),
  blobs: z.array(serializedBlobSchema),
});

export const backupFileSchema = z.strictObject({
  format: z.literal(BACKUP_FORMAT),
  formatVersion: z.literal(BACKUP_FORMAT_VERSION),
  exportedAt: isoDateSchema,
  snapshot: serializedBackupSnapshotSchema,
});

export const backupFileV1Schema = backupFileSchema;

export type BackupFile = z.infer<typeof backupFileSchema>;
