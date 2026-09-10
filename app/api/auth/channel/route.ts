import { env } from 'cloudflare:workers';
import { requireAuth } from '@/lib/server/auth';
import { error, json, parseJsonBody, stringField } from '@/lib/server/http';

export async function POST(request: Request) {
  const auth = await requireAuth(request, { csrf: true });
  if ('response' in auth) return auth.response;
  const body = parseJsonBody(await request.json().catch(() => null));
  const channelId = body ? stringField(body, 'channelId') : '';
  if (!channelId) return error('Informe o canal do YouTube.', 422);
  const connection = await env.DB.prepare(
    `SELECT id, channel_id, channel_title FROM youtube_connections
     WHERE user_id=?1 AND channel_id=?2 AND revoked_at IS NULL`,
  )
    .bind(auth.context.userId, channelId)
    .first<{ id: string; channel_id: string; channel_title: string }>();
  if (!connection) return error('Canal não pertence à conta conectada.', 403);
  await env.DB.prepare(
    'UPDATE sessions SET active_connection_id=?1 WHERE id_hash=?2 AND user_id=?3',
  )
    .bind(connection.id, auth.context.sessionHash, auth.context.userId)
    .run();
  return json({
    channel: {
      id: connection.id,
      channelId: connection.channel_id,
      title: connection.channel_title,
    },
  });
}
