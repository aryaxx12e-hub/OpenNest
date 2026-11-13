import type { IsoDate } from "@opennest/core";

export interface RestoreManifestEntry {
  path: string;
  bytes: number;
  sha256: string;
}

export interface RestoreManifest {
  manifestVersion: 1;
  snapshotVersion: 1;
  schemaVersion: number;
  kind: "dexie" | "sqlite";
  createdAt: IsoDate;
  entries: RestoreManifestEntry[];
}
