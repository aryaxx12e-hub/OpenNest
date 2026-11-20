CREATE TABLE IF NOT EXISTS mcp_tokens (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS mcp_tokens_workspace_idx ON mcp_tokens(workspace_id);
CREATE INDEX IF NOT EXISTS mcp_tokens_created_by_idx ON mcp_tokens(created_by);

CREATE TABLE IF NOT EXISTS mcp_audit (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('success', 'failure')),
  duration_ms INTEGER NOT NULL,
  error_code TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS mcp_audit_created_at_idx ON mcp_audit(created_at);
CREATE INDEX IF NOT EXISTS mcp_audit_token_id_idx ON mcp_audit(token_id);
