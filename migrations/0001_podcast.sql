CREATE TABLE IF NOT EXISTS programs (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  author TEXT NOT NULL,
  language TEXT NOT NULL,
  category TEXT NOT NULL,
  explicit INTEGER NOT NULL DEFAULT 0 CHECK (explicit IN (0, 1)),
  email TEXT NOT NULL,
  cover_key TEXT NOT NULL,
  cover_content_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS episodes (
  guid TEXT PRIMARY KEY,
  program_id TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'processing', 'ready', 'scheduled', 'published', 'failed')),
  audio_key TEXT NOT NULL,
  audio_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
  explicit INTEGER NOT NULL DEFAULT 0 CHECK (explicit IN (0, 1)),
  episode_type TEXT NOT NULL CHECK (episode_type IN ('full', 'trailer', 'bonus')),
  season TEXT,
  episode_number TEXT,
  publish_at TEXT,
  timezone TEXT NOT NULL,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (program_id, audio_key)
);

CREATE TABLE IF NOT EXISTS destinations (
  program_id TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('not_connected', 'sent', 'available', 'problem')),
  public_url TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (program_id, platform)
);

CREATE INDEX IF NOT EXISTS episodes_program_status_idx
  ON episodes (program_id, status, publish_at);
CREATE INDEX IF NOT EXISTS episodes_program_published_idx
  ON episodes (program_id, published_at DESC);
