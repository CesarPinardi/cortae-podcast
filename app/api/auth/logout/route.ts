import { env } from 'cloudflare:workers';
import {
  clearAuthCookies,
  getAuthContext,
  requireAuth,
} from '@/lib/server/auth';

export async function POST(request: Request) {
  const context = await getAuthContext(request);
  if (context) {
    const auth = await requireAuth(request, { csrf: true });
    if ('response' in auth) return auth.response;
    await env.DB.prepare('UPDATE sessions SET revoked_at=?1 WHERE id_hash=?2')
      .bind(new Date().toISOString(), context.sessionHash)
      .run();
  }
  const response = new Response(null, { status: 204 });
  for (const value of clearAuthCookies().getSetCookie())
    response.headers.append('set-cookie', value);
  return response;
}
