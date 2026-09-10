CREATE TABLE IF NOT EXISTS ownership_associations (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL UNIQUE REFERENCES programs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ownership_associations_user_idx
  ON ownership_associations (user_id, channel_id, created_at);
