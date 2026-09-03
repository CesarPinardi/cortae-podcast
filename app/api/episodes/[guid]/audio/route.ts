import { env } from 'cloudflare:workers';
import { error, json, safeSegment } from '@/lib/server/http';
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
  const audioKey = `audio/${episode.programId}/${guid}/${crypto.randomUUID()}-${safeSegment(episode.audioName)}`;
  const object = await env.MEDIA.put(audioKey, request.body, {
    httpMetadata: {
      contentType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE episodes SET audio_key=?1, audio_etag=?2, mime_type=?3, size_bytes=?4, status=?5, updated_at=?6
     WHERE guid=?7 AND status <> 'published' AND audio_key=?8`,
  )
    .bind(
      audioKey,
      object.httpEtag,
      contentType,
      object.size,
      'ready',
      now,
      guid,
      episode.audioKey,
    )
    .run();
  if (!result.meta.changes) {
    await env.MEDIA.delete(audioKey);
    return error('O episódio mudou durante o upload. Tente novamente.', 409);
  }
  return json({
    guid,
    status: 'ready',
    sizeBytes: object.size,
    mimeType: contentType,
    audioKey,
    mediaPath: `/media/${audioKey}`,
  });
}
