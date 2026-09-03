import { env } from 'cloudflare:workers';
import type { Destination, Episode, Program } from '@/lib/podcast';

type ProgramRow = {
  id: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  language: string;
  category: string;
  explicit: number;
  email: string;
  cover_key: string;
  cover_content_type: string;
  created_at: string;
  updated_at: string;
};

type EpisodeRow = {
  guid: string;
  program_id: string;
  source_url: string;
  title: string;
  description: string;
  status: Episode['status'];
  audio_key: string;
  audio_etag: string | null;
  audio_name: string;
  mime_type: string;
  size_bytes: number;
  duration_seconds: number;
  explicit: number;
  episode_type: Episode['kind'];
  season: string | null;
  episode_number: string | null;
  publish_at: string | null;
  timezone: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

type DestinationRow = {
  platform: string;
  status: Destination['status'];
  public_url: string;
};

export function database() {
  return env.DB;
}

export function media() {
  return env.MEDIA;
}

export function programFromRow(
  row: ProgramRow,
): Program & { id: string; coverKey: string } {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    author: row.author,
    language: row.language,
    category: row.category,
    explicit: row.explicit === 1,
    email: row.email,
    coverName: row.cover_key.split('/').pop() ?? row.cover_key,
    coverValid: true,
    coverUrl: '',
    coverKey: row.cover_key,
    slug: row.slug,
    updatedAt: row.updated_at,
  };
}

export function episodeFromRow(
  row: EpisodeRow,
): Episode & { programId: string; sourceUrl: string; audioKey: string } {
  return {
    guid: row.guid,
    title: row.title,
    description: row.description,
    status: row.status,
    kind: row.episode_type,
    season: row.season ?? '',
    number: row.episode_number ?? '',
    explicit: row.explicit === 1,
    publishAt: row.publish_at ?? '',
    timezone: row.timezone,
    publishedAt: row.published_at ?? '',
    audioName: row.audio_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    duration: row.duration_seconds,
    enclosureUrl: '',
    programId: row.program_id,
    sourceUrl: row.source_url,
    audioKey: row.audio_key,
    audioEtag: row.audio_etag ?? undefined,
    updatedAt: row.updated_at,
  };
}

type PodcastBindings = { DB: D1Database; MEDIA: R2Bucket };

export async function publishDueEpisodes(
  bindings: PodcastBindings = { DB: database(), MEDIA: media() },
  now = new Date().toISOString(),
) {
  const due = await bindings.DB.prepare(
    `SELECT * FROM episodes
       WHERE status='scheduled' AND publish_at IS NOT NULL
       AND julianday(publish_at) <= julianday(?1)`,
  )
    .bind(now)
    .all<EpisodeRow>();
  let published = 0;
  for (const row of due.results) {
    const program = await bindings.DB.prepare(
      'SELECT * FROM programs WHERE id = ?1',
    )
      .bind(row.program_id)
      .first<ProgramRow>();
    const [audio, cover] = await Promise.all([
      bindings.MEDIA.head(row.audio_key),
      program ? bindings.MEDIA.head(program.cover_key) : null,
    ]);
    if (
      !program ||
      !audio ||
      audio.size !== row.size_bytes ||
      (row.audio_etag && audio.httpEtag !== row.audio_etag) ||
      !cover
    )
      continue;
    const result = await bindings.DB.prepare(
      `UPDATE episodes SET status='published', published_at=publish_at,
         publish_at=NULL, updated_at=?1
         WHERE guid=?2 AND status='scheduled' AND publish_at IS NOT NULL
           AND julianday(publish_at) <= julianday(?3)
           AND audio_key=?4 AND size_bytes=?5`,
    )
      .bind(now, row.guid, now, row.audio_key, row.size_bytes)
      .run();
    published += result.meta.changes;
  }
  return published;
}

export async function findProgram(slug: string) {
  const result = await database()
    .prepare('SELECT * FROM programs WHERE slug = ?1')
    .bind(slug)
    .first<ProgramRow>();
  return result ? programFromRow(result) : null;
}

export async function findProgramById(id: string) {
  const result = await database()
    .prepare('SELECT * FROM programs WHERE id = ?1')
    .bind(id)
    .first<ProgramRow>();
  return result ? programFromRow(result) : null;
}

export async function findEpisode(guid: string) {
  const result = await database()
    .prepare('SELECT * FROM episodes WHERE guid = ?1')
    .bind(guid)
    .first<EpisodeRow>();
  return result ? episodeFromRow(result) : null;
}

export async function findPublishedEpisodes(programId: string, now: string) {
  const result = await database()
    .prepare(
      `SELECT * FROM episodes
       WHERE program_id = ?1 AND status = 'published'
       AND published_at IS NOT NULL AND julianday(published_at) <= julianday(?2)
       ORDER BY julianday(published_at) DESC`,
    )
    .bind(programId, now)
    .all<EpisodeRow>();
  return result.results.map(episodeFromRow);
}

export async function listDestinations(programId: string) {
  const result = await database()
    .prepare(
      'SELECT platform, status, public_url FROM destinations WHERE program_id = ?1',
    )
    .bind(programId)
    .all<DestinationRow>();
  return Object.fromEntries(
    result.results.map((row) => [
      row.platform,
      { status: row.status, publicUrl: row.public_url },
    ]),
  );
}
