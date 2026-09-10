import { requireAuth, revokeConnection } from '@/lib/server/auth';
import { error, json } from '@/lib/server/http';

export async function DELETE(request: Request) {
  const auth = await requireAuth(request, { csrf: true });
  if ('response' in auth) return auth.response;
  if (!auth.context.connection) return error('Nenhum canal conectado.', 409);
  await revokeConnection(auth.context.connection);
  return json({ connected: false });
}
