import { env } from 'cloudflare:workers';
import {
  requireAuth,
  providerFailureResponse,
  usableConnection,
} from '@/lib/server/auth';
import { error, json, toUtcIso } from '@/lib/server/http';
import { findOwnedEpisode } from '@/lib/server/podcast-db';

async function authorizedEpisode(request: Request, guid: string) {
  const auth = await requireAuth(request, { csrf: true, channel: true });
  if ('response' in auth) return { response: auth.response } as const;
  const episode = await findOwnedEpisode(
    guid,
    auth.context.userId,
    auth.context.connection?.channelId ?? '',
  );
  if (!episode)
    return { response: error('Episódio não encontrado.', 404) } as const;
  return { auth: auth.context, episode } as const;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ guid: string }> | { guid: string } },
) {
  const { guid } = await Promise.resolve(context.params);
  const result = await authorizedEpisode(request, guid);
  if ('response' in result) return result.response;
  const episode = result.episode;
  if (
    !episode.sourceVideoId ||
    !episode.sourceChannelId ||
    !episode.sourceVerificationId ||
    episode.sourceChannelId !== result.auth.connection?.channelId
  )
    return error(
      'A origem do episódio não está verificada para este canal.',
      403,
    );
  try {
    await usableConnection(result.auth.connection!);
  } catch (cause) {
    return providerFailureResponse(cause);
  }
  const publishAtUtc = episode.publishAt ? toUtcIso(episode.publishAt) : null;
  if (!publishAtUtc || Date.parse(publishAtUtc) <= Date.now())
    return error('Escolha uma data futura válida.', 422);
  const audio = await env.MEDIA.head(episode.audioKey);
  if (
    !audio ||
    audio.size !== episode.sizeBytes ||
    (episode.audioEtag && audio.httpEtag !== episode.audioEtag)
  )
    return error('Envie um áudio final válido antes de agendar.', 422);
  const now = new Date().toISOString();
  const update = await env.DB.prepare(
    `UPDATE episodes SET status='scheduled', publish_at=?1, updated_at=?2
     WHERE guid=?3 AND owner_user_id=?4 AND status <> 'published'`,
  )
    .bind(publishAtUtc, now, guid, result.auth.userId)
    .run();
  if (!update.meta.changes)
    return error(
      'O episódio mudou durante o agendamento. Tente novamente.',
      409,
    );
  return json({ guid, status: 'scheduled', publishAt: publishAtUtc });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ guid: string }> | { guid: string } },
) {
  const { guid } = await Promise.resolve(context.params);
  const result = await authorizedEpisode(request, guid);
  if ('response' in result) return result.response;
  if (result.episode.status !== 'scheduled')
    return error('O episódio não está agendado.', 409);
  const now = new Date().toISOString();
  const update = await env.DB.prepare(
    `UPDATE episodes SET status='draft', publish_at=NULL, updated_at=?1
     WHERE guid=?2 AND owner_user_id=?3 AND status='scheduled'`,
  )
    .bind(now, guid, result.auth.userId)
    .run();
  if (!update.meta.changes)
    return error(
      'O episódio mudou durante a atualização. Tente novamente.',
      409,
    );
  return json({ guid, status: 'draft' });
}
