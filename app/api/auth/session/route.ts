import {
  getAuthContext,
  getCookie,
  listConnections,
  rotateCsrf,
  sessionJson,
} from '@/lib/server/auth';
import { json } from '@/lib/server/http';

export async function GET(request: Request) {
  const context = await getAuthContext(request);
  if (!context)
    return json({ authenticated: false }, 200, { 'cache-control': 'no-store' });
  const csrfToken = getCookie(request, '__Host-cortae_csrf') ?? '';
  if (csrfToken)
    return sessionJson(
      context,
      await listConnections(context.userId),
      csrfToken,
    );
  const rotated = await rotateCsrf(context);
  const response = sessionJson(
    context,
    await listConnections(context.userId),
    rotated.csrfToken,
  );
  for (const value of rotated.headers.getSetCookie())
    response.headers.append('set-cookie', value);
  return response;
}
