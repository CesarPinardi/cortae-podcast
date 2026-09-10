import { env } from 'cloudflare:workers';
import {
  AuthProviderError,
  usableConnection,
  type AuthContext,
  youtubeClientOptions,
} from '@/lib/server/auth';
import {
  findVideo,
  parseYouTubeVideoId,
  YouTubeApiError,
} from '@/lib/server/youtube';

const VERIFICATION_MINUTES = 10;

export type SourceVerification = {
  id: string;
  videoId: string;
  channelId: string;
  sourceUrl: string;
  connectionId: string;
  verifiedAt: string;
  expiresAt: string;
};

export class SourceVerificationError extends Error {
  readonly kind: 'invalid' | 'not_found' | 'forbidden' | 'conflict';

  constructor(
    kind: 'invalid' | 'not_found' | 'forbidden' | 'conflict',
    message: string,
  ) {
    super(message);
    this.kind = kind;
    this.name = 'SourceVerificationError';
  }
}

export async function verifyAndStoreSource(
  context: AuthContext,
  programId: string,
  sourceUrl: string,
) {
  if (!context.connection)
    throw new AuthProviderError('revoked', 'Conecte um canal do YouTube.');
  const videoId = parseYouTubeVideoId(sourceUrl);
  if (!videoId)
    throw new SourceVerificationError(
      'invalid',
      'Informe uma URL válida de vídeo ou live do YouTube.',
    );
  const connection = await usableConnection(context.connection);
  let video;
  try {
    video = await findVideo(
      connection.accessToken,
      videoId,
      youtubeClientOptions(),
    );
  } catch (cause) {
    if (cause instanceof YouTubeApiError && cause.kind === 'not_found')
      throw new SourceVerificationError(
        'not_found',
        'Vídeo do YouTube não encontrado ou inacessível.',
      );
    if (cause instanceof YouTubeApiError && cause.kind === 'revoked')
      throw new AuthProviderError('revoked', 'Reconecte o canal do YouTube.');
    throw new AuthProviderError(
      'temporary',
      'YouTube indisponível no momento.',
    );
  }
  if (!video)
    throw new SourceVerificationError(
      'not_found',
      'Vídeo do YouTube não encontrado ou inacessível.',
    );
  if (video.channelId !== connection.channelId)
    throw new SourceVerificationError(
      'forbidden',
      'O vídeo pertence a outro canal do YouTube.',
    );
  const now = new Date();
  const verifiedAt = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + VERIFICATION_MINUTES * 60_000,
  ).toISOString();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO source_verifications
       (id, user_id, connection_id, program_id, video_id, channel_id, source_url,
        verified_at, expires_at, status, used_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'verified', NULL)`,
  )
    .bind(
      id,
      context.userId,
      context.connection.id,
      programId,
      video.id,
      video.channelId,
      sourceUrl,
      verifiedAt,
      expiresAt,
    )
    .run();
  return {
    id,
    videoId: video.id,
    channelId: video.channelId,
    sourceUrl,
    connectionId: context.connection.id,
    verifiedAt,
    expiresAt,
  } satisfies SourceVerification;
}

export async function consumeSourceVerification(
  context: AuthContext,
  programId: string,
  verificationId: string,
  sourceUrl?: string,
) {
  if (!context.connection)
    throw new AuthProviderError('revoked', 'Conecte um canal do YouTube.');
  const row = await env.DB.prepare(
    `SELECT id, video_id, channel_id, source_url, connection_id, verified_at, expires_at
     FROM source_verifications
     WHERE id=?1 AND user_id=?2 AND connection_id=?3 AND program_id=?4
       AND status='verified' AND used_at IS NULL AND julianday(expires_at) > julianday(?5)`,
  )
    .bind(
      verificationId,
      context.userId,
      context.connection.id,
      programId,
      new Date().toISOString(),
    )
    .first<{
      id: string;
      video_id: string;
      channel_id: string;
      source_url: string;
      connection_id: string;
      verified_at: string;
      expires_at: string;
    }>();
  if (!row)
    throw new SourceVerificationError(
      'invalid',
      'A verificação do vídeo expirou. Verifique a origem novamente.',
    );
  if (sourceUrl && sourceUrl !== row.source_url)
    throw new SourceVerificationError(
      'conflict',
      'A URL do episódio não corresponde à verificação do servidor.',
    );
  const usedAt = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE source_verifications SET status='used', used_at=?1
     WHERE id=?2 AND status='verified' AND used_at IS NULL`,
  )
    .bind(usedAt, verificationId)
    .run();
  if (result.meta.changes !== 1)
    throw new SourceVerificationError(
      'conflict',
      'A verificação já foi consumida.',
    );
  return {
    id: row.id,
    videoId: row.video_id,
    channelId: row.channel_id,
    sourceUrl: row.source_url,
    connectionId: row.connection_id,
    verifiedAt: row.verified_at,
    expiresAt: row.expires_at,
  } satisfies SourceVerification;
}

export async function verifyOrConsumeSource(
  context: AuthContext,
  programId: string,
  sourceUrl: string,
  verificationId?: string,
) {
  if (verificationId)
    return consumeSourceVerification(
      context,
      programId,
      verificationId,
      sourceUrl,
    );
  const verification = await verifyAndStoreSource(
    context,
    programId,
    sourceUrl,
  );
  const consumed = await consumeSourceVerification(
    context,
    programId,
    verification.id,
    sourceUrl,
  );
  return consumed;
}
