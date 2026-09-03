import handler from 'vinext/server/fetch-handler';
import { publishDueEpisodes } from '@/lib/server/podcast-db';

const ALLOWED_CORS_ORIGINS = new Set([
  'https://cesarpinardi.github.io',
  'http://localhost:5173',
]);

function corsOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return origin && ALLOWED_CORS_ORIGINS.has(origin) ? origin : null;
}

const worker = {
  async fetch(request: Request, bindings: Env, context: ExecutionContext) {
    const origin = corsOrigin(request);
    if (request.method === 'OPTIONS' && origin)
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-headers': 'content-type',
          'access-control-allow-methods':
            'DELETE, GET, HEAD, OPTIONS, PATCH, POST',
          'access-control-allow-origin': origin,
          'access-control-max-age': '86400',
          vary: 'Origin',
        },
      });
    const response = await handler.fetch(request, bindings, context);
    if (!origin) return response;
    const headers = new Headers(response.headers);
    headers.set('access-control-allow-origin', origin);
    headers.set(
      'access-control-expose-headers',
      'accept-ranges, content-length, content-range, etag, last-modified',
    );
    headers.set('vary', 'Origin');
    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  },
  async scheduled(
    _controller: ScheduledController,
    bindings: Env,
    _ctx: ExecutionContext,
  ) {
    await publishDueEpisodes(bindings);
  },
};

export default worker;
