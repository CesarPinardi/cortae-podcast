import { env } from 'cloudflare:workers';
import type { Destination, Episode, Program } from '@/lib/podcast';
import { usableConnection, type YoutubeConnection } from '@/lib/server/auth';

type ProgramRow = {
  id: string;
  slug: string;
  owner_user_id: string | null;
  channel_id: string | null;
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
  owner_user_id: string | null;
  source_url: string;
  source_video_id: string | null;
  source_channel_id: string | null;
  source_verification_id: string | null;
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
    ownerUserId: row.owner_user_id,
    channelId: row.channel_id,
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
    ownerUserId: row.owner_user_id,
    sourceUrl: row.source_url,
    sourceVideoId: row.source_video_id,
    sourceChannelId: row.source_channel_id,
    sourceVerificationId: row.source_verification_id,
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
    `SELECT e.*, p.owner_user_id AS program_owner_user_id, p.channel_id AS program_channel_id
       FROM episodes e JOIN programs p ON p.id=e.program_id
       WHERE status='scheduled' AND publish_at IS NOT NULL
       AND julianday(publish_at) <= julianday(?1)`,
  )
    .bind(now)
    .all<
      EpisodeRow & {
        program_owner_user_id: string | null;
        program_channel_id: string | null;
      }
    >();
  let published = 0;
  for (const row of due.results) {
    if (
      !row.program_owner_user_id ||
      !row.program_channel_id ||
      !row.source_verification_id ||
      row.source_channel_id !== row.program_channel_id
    )
      continue;
    const program = await bindings.DB.prepare(
      'SELECT * FROM programs WHERE id = ?1',
    )
      .bind(row.program_id)
      .first<ProgramRow>();
    const connectionRow = await bindings.DB.prepare(
      `SELECT id, user_id, channel_id, channel_title, access_token_ciphertext,
         refresh_token_ciphertext, access_token_expires_at, revoked_at
       FROM youtube_connections WHERE user_id=?1 AND channel_id=?2 AND revoked_at IS NULL`,
    )
      .bind(row.program_owner_user_id, row.program_channel_id)
      .first<{
        id: string;
        user_id: string;
        channel_id: string;
        channel_title: string;
        access_token_ciphertext: string;
        refresh_token_ciphertext: string | null;
        access_token_expires_at: string;
        revoked_at: string | null;
      }>();
    if (!connectionRow) continue;
    const connection: YoutubeConnection = {
      id: connectionRow.id,
      userId: connectionRow.user_id,
      channelId: connectionRow.channel_id,
      channelTitle: connectionRow.channel_title,
      accessTokenCiphertext: connectionRow.access_token_ciphertext,
      refreshTokenCiphertext: connectionRow.refresh_token_ciphertext,
      accessTokenExpiresAt: connectionRow.access_token_expires_at,
      revokedAt: connectionRow.revoked_at,
    };
    try {
      await usableConnection(connection);
    } catch {
      continue;
    }
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

export async function findOwnedProgram(
  id: string,
  userId: string,
  channelId: string,
) {
  const result = await database()
    .prepare(
      `SELECT * FROM programs
       WHERE id=?1 AND owner_user_id=?2 AND channel_id=?3`,
    )
    .bind(id, userId, channelId)
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

export async function findOwnedEpisode(
  guid: string,
  userId: string,
  channelId: string,
) {
  const result = await database()
    .prepare(
      `SELECT e.* FROM episodes e
       JOIN programs p ON p.id=e.program_id
       WHERE e.guid=?1 AND e.owner_user_id=?2 AND e.owner_user_id=p.owner_user_id
         AND p.owner_user_id=?2 AND p.channel_id=?3`,
    )
    .bind(guid, userId, channelId)
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
