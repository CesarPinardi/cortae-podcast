CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT,
  display_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  code_verifier_ciphertext TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS youtube_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  channel_title TEXT NOT NULL,
  access_token_ciphertext TEXT NOT NULL,
  refresh_token_ciphertext TEXT,
  access_token_expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, channel_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active_connection_id TEXT,
  csrf_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES youtube_connections(id) ON DELETE CASCADE,
  program_id TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('verified', 'superseded', 'used')),
  used_at TEXT
);

ALTER TABLE programs ADD COLUMN owner_user_id TEXT REFERENCES users(id);
ALTER TABLE programs ADD COLUMN channel_id TEXT;

ALTER TABLE episodes ADD COLUMN owner_user_id TEXT REFERENCES users(id);
ALTER TABLE episodes ADD COLUMN source_video_id TEXT;
ALTER TABLE episodes ADD COLUMN source_channel_id TEXT;
ALTER TABLE episodes ADD COLUMN source_verification_id TEXT REFERENCES source_verifications(id);

CREATE INDEX IF NOT EXISTS programs_owner_idx
  ON programs (owner_user_id, channel_id);
CREATE INDEX IF NOT EXISTS episodes_owner_idx
  ON episodes (owner_user_id, program_id);
CREATE INDEX IF NOT EXISTS youtube_connections_user_idx
  ON youtube_connections (user_id, channel_id, revoked_at);
CREATE INDEX IF NOT EXISTS source_verifications_lookup_idx
  ON source_verifications (user_id, program_id, connection_id, status, expires_at);
