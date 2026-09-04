import { env } from 'cloudflare:workers';
import { isAcceptedAudioType, MAX_AUDIO_BYTES } from '@/lib/podcast';
import { hasValidAudioSignature, readAudioSignature } from '@/lib/server/audio';
import { error, json, safeSegment } from '@/lib/server/http';
import { findEpisode } from '@/lib/server/podcast-db';

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
  if (!isAcceptedAudioType(contentType))
    return error('Envie um arquivo MP3, M4A ou AAC.', 415);
  const contentLengthHeader = request.headers.get('content-length');
  const contentLength = Number(contentLengthHeader);
  if (
    !contentLengthHeader ||
    !Number.isInteger(contentLength) ||
    contentLength <= 0
  )
    return error('Informe o tamanho do arquivo de áudio.', 411);
  if (contentLength > MAX_AUDIO_BYTES)
    return error('O áudio excede o limite de 1 GB.', 413);
  if (!request.body) return error('O corpo do upload está vazio.', 400);
  const duration = Number(request.headers.get('x-audio-duration-seconds'));
  if (!Number.isInteger(duration) || duration <= 0)
    return error('Informe a duração válida do áudio.', 422);
  const [signatureBody, uploadBody] = request.body.tee();
  const signature = await readAudioSignature(signatureBody);
  if (!hasValidAudioSignature(contentType, signature)) {
    await uploadBody.cancel();
    return error('O conteúdo do arquivo não corresponde ao formato informado.', 415);
  }
  const audioKey = `audio/${episode.programId}/${guid}/${crypto.randomUUID()}-${safeSegment(episode.audioName)}`;
  const object = await env.MEDIA.put(audioKey, uploadBody, {
    httpMetadata: {
      contentType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });
  if (object.size !== contentLength) {
    await env.MEDIA.delete(audioKey);
    return error('O tamanho do upload não corresponde ao arquivo enviado.', 400);
  }
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE episodes SET audio_key=?1, audio_etag=?2, mime_type=?3, size_bytes=?4, duration_seconds=?5,
      status=?6, updated_at=?7 WHERE guid=?8 AND status <> 'published' AND audio_key=?9`,
  )
    .bind(
      audioKey,
      object.httpEtag,
      contentType,
      object.size,
      duration,
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
    duration,
    audioKey,
    mediaPath: `/media/${audioKey}`,
  });
}
