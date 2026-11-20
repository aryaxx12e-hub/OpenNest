CREATE TABLE IF NOT EXISTS sync_authority_state (
  workspace_id TEXT PRIMARY KEY NOT NULL,
  canonical_revision INTEGER NOT NULL CHECK (canonical_revision >= 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_applied_operations (
  op_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (
    entity_type IN ('workspace', 'folder', 'file', 'note', 'tag')
  ),
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (
    operation IN ('create', 'update', 'delete', 'restore')
  ),
  base_entity_revision INTEGER NOT NULL CHECK (base_entity_revision >= 0),
  base_workspace_revision INTEGER NOT NULL CHECK (base_workspace_revision >= 0),
  field_patches TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  local_sequence INTEGER NOT NULL CHECK (local_sequence >= 1),
  created_at TEXT NOT NULL,
  canonical_revision INTEGER NOT NULL CHECK (canonical_revision >= 1),
  applied_at TEXT NOT NULL,
  entity_revision INTEGER NOT NULL CHECK (entity_revision >= 1),
  field_revisions TEXT NOT NULL,
  UNIQUE (workspace_id, canonical_revision),
  UNIQUE (workspace_id, device_id, local_sequence)
);

CREATE INDEX IF NOT EXISTS sync_applied_workspace_revision_idx
  ON sync_applied_operations (workspace_id, canonical_revision);

CREATE INDEX IF NOT EXISTS sync_applied_workspace_entity_idx
  ON sync_applied_operations (workspace_id, entity_type, entity_id);
