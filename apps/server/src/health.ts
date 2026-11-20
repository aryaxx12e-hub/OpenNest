import { DatabaseSync } from "node:sqlite";

export interface ReadinessTarget {
  databaseFile: string;
  requiredTable: string;
}

export async function isDatabaseReady(target: ReadinessTarget): Promise<boolean> {
  let database: DatabaseSync | null = null;

  try {
    database = new DatabaseSync(target.databaseFile, { readOnly: true });
    const row = database
      .prepare("SELECT 1 AS ready FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(target.requiredTable);

    return row !== undefined;
  } catch {
    return false;
  } finally {
    database?.close();
  }
}

export function createReadinessCheck(
  targets: readonly ReadinessTarget[]
): () => Promise<boolean> {
  return async () => {
    for (const target of targets) {
      if (!(await isDatabaseReady(target))) {
        return false;
      }
    }

    return true;
  };
}
