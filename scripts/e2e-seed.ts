import { randomUUID } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { IsoDate } from "@opennest/core";
import { createSqliteStorage } from "@opennest/storage-sqlite";

interface NoteSpec {
  title?: string;
  content?: string;
}

interface WorkspaceSpec {
  name?: string;
  notes?: NoteSpec[];
}

interface SeedSpec {
  at?: string;
  workspaceName?: string;
  notes?: NoteSpec[];
  extraWorkspaces?: WorkspaceSpec[];
}

async function main() {
  const dataDir = process.env.OPENNEST_DATA_DIR;

  if (!dataDir) {
    throw new Error("OPENNEST_DATA_DIR is required.");
  }

  const spec = JSON.parse(process.argv[2] ?? "{}") as SeedSpec;
  const at = (spec.at ?? new Date().toISOString()) as IsoDate;
  const databaseFile = path.join(dataDir, "workspace.sqlite");
  const storage = createSqliteStorage({
    databaseFile,
    blobRoot: path.join(dataDir, "blobs"),
  });

  await storage.init();

  const existing = await storage.workspaces.list();
  const workspace =
    existing[0] ??
    (await storage.workspaces.ensureWorkspace({
      name: spec.workspaceName ?? "Main",
      at,
    }));
  const notes = [];

  for (const note of spec.notes ?? []) {
    const created = await storage.notes.create({
      workspaceId: workspace.id,
      folderId: null,
      title: note.title ?? "Seed note",
      content: note.content ?? "",
      at,
    });

    notes.push({ id: created.id, title: created.title, content: created.content });
  }

  await storage.close();

  const extraWorkspaces = [];

  if ((spec.extraWorkspaces ?? []).length > 0) {
    const database = new DatabaseSync(databaseFile);

    database.exec("PRAGMA foreign_keys = ON");

    try {
      for (const extra of spec.extraWorkspaces ?? []) {
        const workspaceId = randomUUID();

        database
          .prepare(
            "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)"
          )
          .run(workspaceId, extra.name ?? "Other workspace", at, at);

        const extraNotes = [];

        for (const note of extra.notes ?? []) {
          const noteId = randomUUID();

          database
            .prepare(
              "INSERT INTO notes (id, workspace_id, folder_id, title, content, pinned, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, 0, ?, ?)"
            )
            .run(
              noteId,
              workspaceId,
              note.title ?? "Other note",
              note.content ?? "",
              at,
              at
            );
          extraNotes.push({
            id: noteId,
            title: note.title ?? "Other note",
            content: note.content ?? "",
          });
        }

        extraWorkspaces.push({
          id: workspaceId,
          name: extra.name ?? "Other workspace",
          notes: extraNotes,
        });
      }
    } finally {
      database.close();
    }
  }

  console.log(
    JSON.stringify({
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      notes,
      extraWorkspaces,
    })
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
