import { env } from 'cloudflare:workers';
import { error } from '@/lib/server/http';

function rangeForHeader(value: string | null, size: number) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return 'invalid' as const;
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  const end = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  )
    return 'invalid' as const;
  return {
    offset: start,
    length: Math.min(end, size - 1) - start + 1,
    end: Math.min(end, size - 1),
  };
}

async function respond(
  request: Request,
  context: { params: Promise<{ key: string[] }> | { key: string[] } },
) {
  const { key: segments } = await Promise.resolve(context.params);
  const key = segments.join('/');
  if (!key || key.includes('..')) return error('Mídia não encontrada.', 404);
  const [episode, program] = await Promise.all([
    env.DB.prepare(
      `SELECT guid, audio_key, audio_etag, mime_type, status FROM episodes WHERE audio_key = ?1 AND status = 'published'`,
    )
      .bind(key)
      .first<{
        audio_key: string;
        audio_etag: string | null;
        mime_type: string;
      }>(),
    env.DB.prepare(
      'SELECT cover_key, cover_content_type FROM programs WHERE cover_key = ?1',
    )
      .bind(key)
      .first<{ cover_key: string; cover_content_type: string }>(),
  ]);
  if (!episode && !program) return error('Mídia não encontrada.', 404);
  const object = await env.MEDIA.head(key);
  if (!object) return error('Mídia não encontrada.', 404);
  if (episode?.audio_etag && episode.audio_etag !== object.httpEtag)
    return error('A mídia publicada está inconsistente.', 409);
  const contentType =
    episode?.mime_type ??
    program?.cover_content_type ??
    object.httpMetadata?.contentType ??
    'application/octet-stream';
  const range = rangeForHeader(request.headers.get('range'), object.size);
  if (range === 'invalid')
    return new Response(null, {
      status: 416,
      headers: {
        'accept-ranges': 'bytes',
        'content-range': `bytes */${object.size}`,
      },
    });
  const headers = new Headers({
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=31536000, immutable',
    'content-type': contentType,
    etag: object.httpEtag,
  });
  if (!range) {
    headers.set('content-length', String(object.size));
    if (request.method === 'HEAD') return new Response(null, { headers });
    const body = await env.MEDIA.get(key);
    return new Response(body?.body ?? null, { headers });
  }
  headers.set('content-length', String(range.length));
  headers.set(
    'content-range',
    `bytes ${range.offset}-${range.end}/${object.size}`,
  );
  if (request.method === 'HEAD')
    return new Response(null, { status: 206, headers });
  const body = await env.MEDIA.get(key, {
    range: { offset: range.offset, length: range.length },
  });
  return new Response(body?.body ?? null, { status: 206, headers });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ key: string[] }> | { key: string[] } },
) {
  return respond(request, context);
}
export async function HEAD(
  request: Request,
  context: { params: Promise<{ key: string[] }> | { key: string[] } },
) {
  return respond(request, context);
}
