import { z } from "zod";

import type { BackupSnapshot } from "@opennest/core";
import { assertNoFolderCycleInTree } from "@opennest/core";

import {
  blobKeySchema,
  checksumSchema,
  displayNameSchema,
  fileIdSchema,
  folderIdSchema,
  isoDateSchema,
  mimeTypeSchema,
  noteIdSchema,
  noteTitleSchema,
  sizeBytesSchema,
  tagColorSchema,
  tagIdSchema,
  tagNameSchema,
  withDomainCode,
  workspaceIdSchema,
} from "./common";

const loose = <T extends z.ZodRawShape>(shape: T) => z.object(shape);
const strict = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape);

const workspaceSchema = loose({
  id: workspaceIdSchema,
  name: displayNameSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

const folderSchema = loose({
  id: folderIdSchema,
  workspaceId: workspaceIdSchema,
  parentId: folderIdSchema.nullable(),
  name: displayNameSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const snapshotBlobSchema = loose({
  key: blobKeySchema,
  mimeType: mimeTypeSchema,
  data: z.instanceof(Uint8Array, { error: "Blob data must be a Uint8Array." }),
});

const storedFileSchema = loose({
  id: fileIdSchema,
  workspaceId: workspaceIdSchema,
  folderId: folderIdSchema.nullable(),
  name: displayNameSchema,
  mimeType: mimeTypeSchema.nullable(),
  sizeBytes: sizeBytesSchema,
  blobKey: blobKeySchema,
  checksum: checksumSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

const noteSchema = loose({
  id: noteIdSchema,
  workspaceId: workspaceIdSchema,
  folderId: folderIdSchema.nullable(),
  title: noteTitleSchema,
  content: z.string({ error: "Note content must be a string." }),
  pinned: z.boolean({ error: "Pinned must be a boolean." }),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

const tagSchema = loose({
  id: tagIdSchema,
  workspaceId: workspaceIdSchema,
  name: tagNameSchema,
  color: tagColorSchema,
  createdAt: isoDateSchema,
});

const fileTagSchema = loose({ fileId: fileIdSchema, tagId: tagIdSchema });
const noteTagSchema = loose({ noteId: noteIdSchema, tagId: tagIdSchema });
const noteLinkSchema = loose({
  sourceNoteId: noteIdSchema,
  targetNoteId: noteIdSchema,
});

function duplicateIds<T extends { id: string }>(
  rows: readonly T[],
  ctx: z.RefinementCtx,
  path: (string | number)[],
  label: string
): void {
  const seen = new Set<string>();

  for (const row of rows) {
    if (seen.has(row.id)) {
      ctx.addIssue({ code: "custom", path, message: `${label} ids must be unique.` });

      return;
    }

    seen.add(row.id);
  }
}

function indexOf<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

export const backupSnapshotSchema: z.ZodType<BackupSnapshot> = withDomainCode(
  strict({
    snapshotVersion: z.literal(1),
    schemaVersion: z
      .number({ error: "Schema version must be a number." })
      .int({ error: "Schema version must be a whole number." })
      .min(0, { error: "Schema version must not be negative." }),
    kind: z.enum(["dexie", "sqlite"], {
      error: "Snapshot kind must be dexie or sqlite.",
    }),
    createdAt: isoDateSchema,
    workspace: workspaceSchema,
    folders: z.array(folderSchema),
    files: z.array(storedFileSchema),
    notes: z.array(noteSchema),
    tags: z.array(tagSchema),
    fileTags: z.array(fileTagSchema),
    noteTags: z.array(noteTagSchema),
    noteLinks: z.array(noteLinkSchema),
    blobs: z.array(snapshotBlobSchema),
  }).superRefine((snapshot, ctx) => {
    duplicateIds(snapshot.folders, ctx, ["folders"], "Folder");
    duplicateIds(snapshot.files, ctx, ["files"], "File");
    duplicateIds(snapshot.notes, ctx, ["notes"], "Note");
    duplicateIds(snapshot.tags, ctx, ["tags"], "Tag");

    const workspaceId = snapshot.workspace.id;
    const folderById = indexOf(snapshot.folders);
    const fileById = indexOf(snapshot.files);
    const noteById = indexOf(snapshot.notes);
    const tagById = indexOf(snapshot.tags);

    for (const folder of snapshot.folders) {
      if (folder.workspaceId !== workspaceId) {
        ctx.addIssue({
          code: "custom",
          path: ["folders"],
          message: "Every folder must belong to the snapshot workspace.",
        });
      }

      if (folder.parentId !== null && !folderById.has(folder.parentId)) {
        ctx.addIssue({
          code: "custom",
          path: ["folders"],
          message: "A folder parent must exist in the snapshot.",
        });
      }
    }

    try {
      assertNoFolderCycleInTree(snapshot.folders);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        path: ["folders"],
        message: error instanceof Error ? error.message : "Folder tree is invalid.",
      });
    }

    const blobByKey = new Map(snapshot.blobs.map((blob) => [blob.key, blob]));

    for (const file of snapshot.files) {
      if (file.workspaceId !== workspaceId) {
        ctx.addIssue({
          code: "custom",
          path: ["files"],
          message: "Every file must belong to the snapshot workspace.",
        });
      }

      if (file.folderId !== null && !folderById.has(file.folderId)) {
        ctx.addIssue({
          code: "custom",
          path: ["files"],
          message: "A file folder must exist in the snapshot.",
        });
      }

      if (!blobByKey.has(file.blobKey)) {
        ctx.addIssue({
          code: "custom",
          path: ["files"],
          message: "Every file blob must be present in the snapshot.",
        });
      }
    }

    for (const note of snapshot.notes) {
      if (note.workspaceId !== workspaceId) {
        ctx.addIssue({
          code: "custom",
          path: ["notes"],
          message: "Every note must belong to the snapshot workspace.",
        });
      }

      if (note.folderId !== null && !folderById.has(note.folderId)) {
        ctx.addIssue({
          code: "custom",
          path: ["notes"],
          message: "A note folder must exist in the snapshot.",
        });
      }
    }

    for (const tag of snapshot.tags) {
      if (tag.workspaceId !== workspaceId) {
        ctx.addIssue({
          code: "custom",
          path: ["tags"],
          message: "Every tag must belong to the snapshot workspace.",
        });
      }
    }

    const fileTagPairs = new Set<string>();

    for (const link of snapshot.fileTags) {
      const pair = `${link.fileId}:${link.tagId}`;

      if (fileTagPairs.has(pair)) {
        ctx.addIssue({
          code: "custom",
          path: ["fileTags"],
          message: "File tag pairs must be unique.",
        });
      }

      fileTagPairs.add(pair);

      if (!fileById.has(link.fileId)) {
        ctx.addIssue({
          code: "custom",
          path: ["fileTags"],
          message: "A file tag must point at an existing file.",
        });
      }

      if (!tagById.has(link.tagId)) {
        ctx.addIssue({
          code: "custom",
          path: ["fileTags"],
          message: "A file tag must point at an existing tag.",
        });
      }
    }

    const noteTagPairs = new Set<string>();

    for (const link of snapshot.noteTags) {
      const pair = `${link.noteId}:${link.tagId}`;

      if (noteTagPairs.has(pair)) {
        ctx.addIssue({
          code: "custom",
          path: ["noteTags"],
          message: "Note tag pairs must be unique.",
        });
      }

      noteTagPairs.add(pair);

      if (!noteById.has(link.noteId)) {
        ctx.addIssue({
          code: "custom",
          path: ["noteTags"],
          message: "A note tag must point at an existing note.",
        });
      }

      if (!tagById.has(link.tagId)) {
        ctx.addIssue({
          code: "custom",
          path: ["noteTags"],
          message: "A note tag must point at an existing tag.",
        });
      }
    }

    for (const link of snapshot.noteLinks) {
      if (!noteById.has(link.sourceNoteId)) {
        ctx.addIssue({
          code: "custom",
          path: ["noteLinks"],
          message: "A note link must start at an existing note.",
        });
      }

      if (!noteById.has(link.targetNoteId)) {
        ctx.addIssue({
          code: "custom",
          path: ["noteLinks"],
          message: "A note link must end at an existing note.",
        });
      }

      if (link.sourceNoteId === link.targetNoteId) {
        ctx.addIssue({
          code: "custom",
          path: ["noteLinks"],
          message: "A note must not link to itself.",
        });
      }
    }

    const referencedKeys = new Set(snapshot.files.map((file) => file.blobKey));
    const seenBlobKeys = new Set<string>();

    for (const blob of snapshot.blobs) {
      const file = snapshot.files.find((row) => row.blobKey === blob.key);

      if (seenBlobKeys.has(blob.key)) {
        ctx.addIssue({
          code: "custom",
          path: ["blobs"],
          message: "Blob keys must be unique.",
        });
      }

      seenBlobKeys.add(blob.key);

      if (!referencedKeys.has(blob.key)) {
        ctx.addIssue({
          code: "custom",
          path: ["blobs"],
          message: "Every blob must be referenced by a file.",
        });
      }

      if (file !== undefined && blob.data.byteLength !== file.sizeBytes) {
        ctx.addIssue({
          code: "custom",
          path: ["blobs"],
          message: "Blob length must match the file size.",
        });
      }
    }
  })
);
