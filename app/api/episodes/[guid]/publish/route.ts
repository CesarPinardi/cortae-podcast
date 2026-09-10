import { env } from 'cloudflare:workers';
import {
  requireAuth,
  providerFailureResponse,
  usableConnection,
} from '@/lib/server/auth';
import { error, json } from '@/lib/server/http';
import { findOwnedEpisode, findOwnedProgram } from '@/lib/server/podcast-db';

export async function POST(
  request: Request,
  context: { params: Promise<{ guid: string }> | { guid: string } },
) {
  const auth = await requireAuth(request, { csrf: true, channel: true });
  if ('response' in auth) return auth.response;
  const { guid } = await Promise.resolve(context.params);
  const episode = await findOwnedEpisode(
    guid,
    auth.context.userId,
    auth.context.connection?.channelId ?? '',
  );
  if (!episode) return error('Episódio não encontrado.', 404);
  if (episode.status === 'published' && episode.publishedAt)
    return json({
      guid,
      status: 'published',
      publishedAt: episode.publishedAt,
    });
  if (
    !episode.sourceVideoId ||
    !episode.sourceChannelId ||
    !episode.sourceVerificationId ||
    episode.sourceChannelId !== auth.context.connection?.channelId
  )
    return error(
      'A origem do episódio não está verificada para este canal.',
      403,
    );
  try {
    await usableConnection(auth.context.connection!);
  } catch (cause) {
    return providerFailureResponse(cause);
  }
  const program = await findOwnedProgram(
    episode.programId ?? '',
    auth.context.userId,
    auth.context.connection?.channelId ?? '',
  );
  const [audio, cover] = await Promise.all([
    env.MEDIA.head(episode.audioKey),
    program ? env.MEDIA.head(program.coverKey) : null,
  ]);
  const errors: string[] = [];
  if (!program) errors.push('Programa não encontrado.');
  if (
    !audio ||
    audio.size !== episode.sizeBytes ||
    (episode.audioEtag && audio.httpEtag !== episode.audioEtag)
  )
    errors.push('O áudio publicado não está disponível ou mudou de tamanho.');
  if (!cover) errors.push('A capa do programa não está disponível.');
  if (episode.title.length < 2)
    errors.push('O título do episódio é obrigatório.');
  if (episode.description.length < 10)
    errors.push('A descrição do episódio é obrigatória.');
  if (errors.length)
    return error('Publicação bloqueada até corrigir os dados.', 422, errors);
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE episodes SET status='published', publish_at=NULL, published_at=?1, updated_at=?1
     WHERE guid=?2 AND owner_user_id=?3 AND status IN ('draft', 'ready', 'scheduled')
       AND source_channel_id=?4 AND audio_key=?5 AND size_bytes=?6`,
  )
    .bind(
      now,
      guid,
      auth.context.userId,
      auth.context.connection?.channelId,
      episode.audioKey,
      episode.sizeBytes,
    )
    .run();
  if (!result.meta.changes) {
    const latest = await findOwnedEpisode(
      guid,
      auth.context.userId,
      auth.context.connection?.channelId ?? '',
    );
    if (latest?.status === 'published' && latest.publishedAt)
      return json({
        guid,
        status: 'published',
        publishedAt: latest.publishedAt,
      });
    return error(
      'O episódio mudou durante a publicação. Tente novamente.',
      409,
    );
  }
  return json({
    guid,
    status: 'published',
    publishedAt: now,
    feedPath: `/feed/${program?.slug}`,
  });
}
