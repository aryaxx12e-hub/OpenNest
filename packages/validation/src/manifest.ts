import { z } from "zod";

import type { RestoreManifest } from "./types";

import { hexChecksumSchema, isoDateSchema, withDomainCode } from "./common";

const RELATIVE_SEGMENT = /^(?!\.\.?$)[^/\\]+$/;

function isSafeArchivePath(path: string): boolean {
  if (path.length === 0 || path.startsWith("/") || path.includes("\\")) {
    return false;
  }

  return path.split("/").every((segment) => RELATIVE_SEGMENT.test(segment));
}

export const manifestEntrySchema = withDomainCode(
  z.strictObject({
    path: z.string({ error: "Entry path must be a string." }).refine(isSafeArchivePath, {
      message: "Entry path must be a relative path without '..' or a backslash.",
    }),
    bytes: z
      .number({ error: "Entry size must be a number of bytes." })
      .int({ error: "Entry size must be a whole number of bytes." })
      .min(0, { error: "Entry size must not be negative." }),
    sha256: hexChecksumSchema,
  })
);

export const restoreManifestSchema: z.ZodType<RestoreManifest> = withDomainCode(
  z.strictObject({
    manifestVersion: z.literal(1),
    snapshotVersion: z.literal(1),
    schemaVersion: z
      .number({ error: "Schema version must be a number." })
      .int({ error: "Schema version must be a whole number." })
      .min(0, { error: "Schema version must not be negative." }),
    kind: z.enum(["dexie", "sqlite"], {
      error: "Manifest kind must be dexie or sqlite.",
    }),
    createdAt: isoDateSchema,
    entries: z
      .array(manifestEntrySchema)
      .refine(
        (entries) => new Set(entries.map((entry) => entry.path)).size === entries.length,
        { message: "Manifest entry paths must be unique." }
      ),
  })
);
