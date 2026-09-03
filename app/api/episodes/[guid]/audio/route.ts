import { env } from 'cloudflare:workers';
import { error, json } from '@/lib/server/http';
import { findEpisode } from '@/lib/server/podcast-db';

const MAX_AUDIO_BYTES = 1_000_000_000;

export async function POST(
  request: Request,
  context: { params: Promise<{ guid: string }> | { guid: string } },
) {
  const { guid } = await Promise.resolve(context.params);
  const episode = await findEpisode(guid);
  if (!episode) return error('Episódio não encontrado.', 404);
  if (episode.status === 'published')
    return error(
      'O áudio já publicado não pode ser substituído. Crie uma nova versão do episódio.',
      409,
    );
  const contentType = request.headers.get('content-type')?.split(';')[0] ?? '';
  if (!contentType.startsWith('audio/'))
    return error('Envie um arquivo de áudio com Content-Type audio/*.', 415);
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_AUDIO_BYTES)
    return error('O áudio excede o limite de 1 GB.', 413);
  if (!request.body) return error('O corpo do upload está vazio.', 400);
  const object = await env.MEDIA.put(episode.audioKey, request.body, {
    httpMetadata: {
      contentType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });
  const now = new Date().toISOString();
  await env.DB.prepare(
    'UPDATE episodes SET mime_type=?1, size_bytes=?2, status=?3, updated_at=?4 WHERE guid=?5',
  )
    .bind(contentType, object.size, 'ready', now, guid)
    .run();
  return json({
    guid,
    status: 'ready',
    sizeBytes: object.size,
    mimeType: contentType,
    mediaPath: `/media/${episode.audioKey}`,
  });
}
