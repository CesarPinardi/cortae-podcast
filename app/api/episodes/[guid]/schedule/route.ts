import { env } from 'cloudflare:workers';
import { error, json, toUtcIso } from '@/lib/server/http';
import { findEpisode } from '@/lib/server/podcast-db';

export async function POST(
  request: Request,
  context: { params: Promise<{ guid: string }> | { guid: string } },
) {
  const { guid } = await Promise.resolve(context.params);
  const episode = await findEpisode(guid);
  if (!episode) return error('Episódio não encontrado.', 404);
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
  await env.DB.prepare(
    `UPDATE episodes SET status='scheduled', publish_at=?1, updated_at=?2 WHERE guid=?3 AND status <> 'published'`,
  )
    .bind(publishAtUtc, now, guid)
    .run();
  return json({ guid, status: 'scheduled', publishAt: publishAtUtc });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ guid: string }> | { guid: string } },
) {
  const { guid } = await Promise.resolve(context.params);
  const episode = await findEpisode(guid);
  if (!episode) return error('Episódio não encontrado.', 404);
  if (episode.status !== 'scheduled')
    return error('O episódio não está agendado.', 409);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE episodes SET status='draft', publish_at=NULL, updated_at=?1 WHERE guid=?2`,
  )
    .bind(now, guid)
    .run();
  return json({ guid, status: 'draft' });
}
