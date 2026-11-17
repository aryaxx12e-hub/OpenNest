import { z } from "zod";

import { isoDateSchema } from "./common";
import { BACKUP_FORMAT, backupFileV1Schema } from "./backup";

export const BACKUP_FORMAT_VERSION_V2 = 2;
export const BACKUP_CHUNK_SIZE = 4 * 1024 * 1024;
export const BACKUP_KDF_MIN_ITERATIONS = 600_000;
export const BACKUP_KDF_MAX_ITERATIONS = 2_000_000;
export const BACKUP_KEK_DOMAIN = "opennest:backup-kek:v1";

const base64UrlSchema = z
  .string({ error: "Expected a base64url string." })
  .regex(/^[A-Za-z0-9_-]+$/, { error: "Expected a base64url string." });

const base64UrlValueSchema = z
  .string({ error: "Expected a base64url string." })
  .regex(/^[A-Za-z0-9_-]*$/, { error: "Expected a base64url string." });

const wrappedKeySchema = z.strictObject({
  iv: base64UrlSchema,
  ciphertext: base64UrlSchema,
  tag: base64UrlSchema,
});

const kdfSchema = z.strictObject({
  name: z.literal("PBKDF2-SHA-256"),
  hash: z.literal("SHA-256"),
  iterations: z
    .number()
    .int()
    .min(BACKUP_KDF_MIN_ITERATIONS)
    .max(BACKUP_KDF_MAX_ITERATIONS),
  salt: base64UrlSchema,
  domain: z.literal(BACKUP_KEK_DOMAIN),
});

const encryptionSchema = z.strictObject({
  version: z.literal(1),
  alg: z.literal("AES-256-GCM"),
  kdf: kdfSchema,
  kid: z.string().min(1),
  wrappedDek: wrappedKeySchema,
});

const countsSchema = z.strictObject({
  workspaces: z.literal(1),
  folders: z.number().int().min(0),
  tags: z.number().int().min(0),
  files: z.number().int().min(0),
  notes: z.number().int().min(0),
});

const summarySchema = z.strictObject({
  counts: countsSchema,
  totalPlaintextBytes: z.number().int().min(0),
});

const chunkSchema = z.strictObject({
  index: z.number().int().min(0),
  iv: base64UrlSchema,
  wrappedCek: wrappedKeySchema,
  ciphertext: base64UrlValueSchema,
  tag: base64UrlSchema,
});

export const backupFileV2Schema = z
  .strictObject({
    format: z.literal(BACKUP_FORMAT),
    formatVersion: z.literal(BACKUP_FORMAT_VERSION_V2),
    exportedAt: isoDateSchema,
    encryption: encryptionSchema,
    chunkSize: z.number().int().min(1).max(BACKUP_CHUNK_SIZE),
    chunkCount: z.number().int().min(1),
    summary: summarySchema,
    chunks: z.array(chunkSchema).min(1),
  })
  .superRefine((file, ctx) => {
    if (file.chunks.length !== file.chunkCount) {
      ctx.addIssue({
        code: "custom",
        path: ["chunks"],
        message: "Chunk count does not match the chunk list.",
      });
    }

    for (const [position, chunk] of file.chunks.entries()) {
      if (chunk.index !== position) {
        ctx.addIssue({
          code: "custom",
          path: ["chunks", position, "index"],
          message: "Chunk indexes must be complete and ordered from zero.",
        });
      }
    }
  });

export const backupEnvelopeSchema = z.discriminatedUnion("formatVersion", [
  backupFileV1Schema,
  backupFileV2Schema,
]);

export type BackupFileV2 = z.infer<typeof backupFileV2Schema>;
export type BackupEnvelope = z.infer<typeof backupEnvelopeSchema>;
