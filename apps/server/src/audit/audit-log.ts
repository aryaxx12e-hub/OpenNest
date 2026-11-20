import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { AuthDatabase } from "../auth/auth-db";

export type AuditResult = "success" | "failure";

export interface AuditEntry {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  result: AuditResult;
}

export interface AuditRecord extends AuditEntry {
  id: string;
  createdAt: string;
}

export interface AuditLog {
  record(entry: AuditEntry, now?: Date): AuditRecord;
  list(): AuditRecord[];
}

interface AuditRow {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  result: AuditResult;
  created_at: string;
}

const SCHEMA = readFileSync(
  fileURLToPath(new URL("./schema.sql", import.meta.url)),
  "utf8"
);

function toRecord(row: AuditRow): AuditRecord {
  return {
    id: row.id,
    actorId: row.actor_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    result: row.result,
    createdAt: row.created_at,
  };
}

export function createAuditLog(database: AuthDatabase): AuditLog {
  database.sqlite.exec(SCHEMA);

  return {
    record(entry, now = new Date()) {
      const record: AuditRecord = {
        id: randomUUID(),
        actorId: entry.actorId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        result: entry.result,
        createdAt: now.toISOString(),
      };

      database.sqlite
        .prepare(
          "INSERT INTO audit_log (id, actor_id, action, target_type, target_id, result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          record.id,
          record.actorId,
          record.action,
          record.targetType,
          record.targetId,
          record.result,
          record.createdAt
        );

      return record;
    },

    list() {
      const rows = database.sqlite
        .prepare(
          "SELECT id, actor_id, action, target_type, target_id, result, created_at FROM audit_log ORDER BY created_at, rowid"
        )
        .all() as unknown as AuditRow[];

      return rows.map(toRecord);
    },
  };
}
