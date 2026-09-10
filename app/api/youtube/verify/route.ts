import { requireAuth, providerFailureResponse } from '@/lib/server/auth';
import { error, json, parseJsonBody, stringField } from '@/lib/server/http';
import { findOwnedProgram } from '@/lib/server/podcast-db';
import {
  SourceVerificationError,
  verifyAndStoreSource,
} from '@/lib/server/source-verification';

export async function POST(request: Request) {
  const auth = await requireAuth(request, { csrf: true, channel: true });
  if ('response' in auth) return auth.response;
  const body = parseJsonBody(await request.json().catch(() => null));
  if (!body) return error('Envie um objeto JSON válido.');
  const programId = stringField(body, 'programId');
  const sourceUrl = stringField(body, 'sourceUrl');
  if (!programId || !sourceUrl)
    return error('Informe programa e URL do vídeo.', 422);
  const program = await findOwnedProgram(
    programId,
    auth.context.userId,
    auth.context.connection?.channelId ?? '',
  );
  if (!program) return error('Programa não encontrado.', 404);
  try {
    const verification = await verifyAndStoreSource(
      auth.context,
      programId,
      sourceUrl,
    );
    return json({
      verificationId: verification.id,
      videoId: verification.videoId,
      channelId: verification.channelId,
      expiresAt: verification.expiresAt,
    });
  } catch (cause) {
    if (cause instanceof SourceVerificationError) {
      const status =
        cause.kind === 'forbidden'
          ? 403
          : cause.kind === 'not_found'
            ? 404
            : 422;
      return error(cause.message, status);
    }
    return providerFailureResponse(cause);
  }
}
