import { z } from "zod";

import {
  limits,
  normalizeTagName,
  validateChecksum,
  validateDisplayName,
  validateTagColor,
} from "@opennest/core";

import type {
  BlobKey,
  FileId,
  FolderId,
  IsoDate,
  NoteId,
  TagId,
  WorkspaceId,
} from "@opennest/core";

export function withDomainCode<T extends z.ZodType>(
  schema: T
): z.ZodType<z.output<T>, z.input<T>> {
  return z.unknown().transform((value, ctx) => {
    const result = schema.safeParse(value);

    if (!result.success) {
      for (const problem of result.error.issues) {
        ctx.addIssue({
          code: "custom",
          message: problem.message,
          path: [...problem.path],
          params: { domainCode: "validation", zodCode: problem.code },
        });
      }

      return z.NEVER;
    }

    return result.data;
  }) as z.ZodType<z.output<T>, z.input<T>>;
}

function fromRule<Output>(
  run: (input: string) => Output
): (input: string, ctx: z.RefinementCtx) => Output | typeof z.NEVER {
  return (input, ctx) => {
    try {
      return run(input);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid value.",
      });

      return z.NEVER;
    }
  };
}

function idSchema<Brand extends string>(label: string): z.ZodType<Brand> {
  return withDomainCode(
    z
      .uuid({ version: "v4", error: `${label} must be a UUID v4.` })
      .transform((value) => value.toLowerCase() as Brand)
  );
}

export const workspaceIdSchema = idSchema<WorkspaceId>("Workspace id");
export const folderIdSchema = idSchema<FolderId>("Folder id");
export const fileIdSchema = idSchema<FileId>("File id");
export const noteIdSchema = idSchema<NoteId>("Note id");
export const tagIdSchema = idSchema<TagId>("Tag id");

export const isoDateSchema = withDomainCode(
  z.iso
    .datetime({ error: "Timestamp must be an ISO 8601 UTC instant." })
    .transform((value) => value as IsoDate)
);

export const blobKeySchema = withDomainCode(
  z
    .uuid({ version: "v4", error: "Blob key must be a lowercase UUID v4." })
    .refine((value) => value === value.toLowerCase(), {
      message: "Blob key must be a lowercase UUID v4.",
    })
    .transform((value) => value as BlobKey)
);

export const hexChecksumSchema = withDomainCode(
  z
    .string({ error: "Checksum must be 64 lowercase hex characters." })
    .transform(fromRule((input) => validateChecksum(input) as string))
);

export const checksumSchema = hexChecksumSchema.nullable();

export const mimeTypeSchema = withDomainCode(
  z.enum(limits.allowedMimeTypes as [string, ...string[]], {
    error: "Unsupported MIME type.",
  })
);

export const sizeBytesSchema = withDomainCode(
  z
    .number({ error: "File size must be a number of bytes." })
    .int({ error: "File size must be a whole number of bytes." })
    .min(0, { error: "File size must not be negative." })
    .max(limits.maxFileSizeBytes, {
      error: `File size must be at most ${limits.maxFileSizeBytes} bytes.`,
    })
);

export const displayNameSchema = withDomainCode(
  z.string({ error: "Name must be a string." }).transform(fromRule(validateDisplayName))
);

export const tagNameSchema = withDomainCode(
  z
    .string({ error: "Tag name must be a string." })
    .transform(fromRule((input) => normalizeTagName(input).display))
);

export const tagColorSchema = withDomainCode(
  z
    .string({ error: "Tag colour must be six-digit hex or null." })
    .transform(fromRule(validateTagColor))
    .nullable()
);

export const noteTitleSchema = withDomainCode(
  z
    .string({ error: "Note title must be a string." })
    .transform((value, ctx) => {
      const title = value.trim();

      if (title.length === 0) {
        ctx.addIssue({ code: "custom", message: "Note title must not be empty." });

        return z.NEVER;
      }

      return title;
    })
    .pipe(
      z.string().max(limits.maxNoteTitleLength, {
        error: `Note title must be at most ${limits.maxNoteTitleLength} characters long.`,
      })
    )
);

export const noteContentSchema = withDomainCode(
  z.string({ error: "Note content must be a string." }).max(limits.maxNoteContentLength, {
    error: `Note content must be at most ${limits.maxNoteContentLength} characters long.`,
  })
);

export const pageLimitSchema = withDomainCode(
  z
    .number({ error: "Limit must be a number." })
    .int({ error: "Limit must be a whole number." })
    .min(1, { error: "Limit must be at least 1." })
    .max(limits.maxPageSize, { error: `Limit must be at most ${limits.maxPageSize}.` })
);

export const offsetSchema = withDomainCode(
  z
    .number({ error: "Offset must be a number." })
    .int({ error: "Offset must be a whole number." })
    .min(0, { error: "Offset must not be negative." })
);

export const searchTextSchema = withDomainCode(
  z.string({ error: "Search text must be a string." }).max(limits.maxSearchTextLength, {
    error: `Search text must be at most ${limits.maxSearchTextLength} characters long.`,
  })
);
