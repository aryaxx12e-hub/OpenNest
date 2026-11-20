CREATE TABLE IF NOT EXISTS file_versions (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  blob_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  checksum TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (file_id, version_number)
);

CREATE INDEX IF NOT EXISTS file_versions_file_idx
  ON file_versions (file_id, version_number);

CREATE INDEX IF NOT EXISTS file_versions_workspace_idx
  ON file_versions (workspace_id);
