import { env } from 'cloudflare:workers';
import { error, json } from '@/lib/server/http';
import { findEpisode } from '@/lib/server/podcast-db';

export async function POST(
  request: Request,
  context: { params: Promise<{ guid: string }> | { guid: string } },
) {
  const { guid } = await Promise.resolve(context.params);
  const episode = await findEpisode(guid);
  if (!episode) return error('Episódio não encontrado.', 404);
  if (
    !episode.publishAt ||
    !hasTimezone(episode.publishAt) ||
    Number.isNaN(Date.parse(episode.publishAt)) ||
    Date.parse(episode.publishAt) <= Date.now()
  )
    return error('Escolha uma data futura válida.', 422);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE episodes SET status='scheduled', updated_at=?1 WHERE guid=?2 AND status <> 'published'`,
  )
    .bind(now, guid)
    .run();
  return json({ guid, status: 'scheduled', publishAt: episode.publishAt });
}

function hasTimezone(value: string) {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
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
