import { env } from 'cloudflare:workers';
import {
  constantTimeEqual,
  providerFailureResponse,
  usableConnection,
  type YoutubeConnection,
} from '@/lib/server/auth';
import { error, json, parseJsonBody, stringField } from '@/lib/server/http';

type ProgramRow = {
  id: string;
  owner_user_id: string | null;
  channel_id: string | null;
};

type ConnectionRow = {
  id: string;
  user_id: string;
  channel_id: string;
  channel_title: string;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string | null;
  access_token_expires_at: string;
  revoked_at: string | null;
};

function authorized(request: Request) {
  const expected = env.OWNERSHIP_ADMIN_TOKEN?.trim() ?? '';
  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : '';
  return Boolean(
    expected && provided && constantTimeEqual(provided, expected),
  );
}

export async function POST(request: Request) {
  if (!authorized(request)) return error('Autorização administrativa necessária.', 401);
  const actor = request.headers.get('x-ownership-admin-actor')?.trim() ?? '';
  if (!actor || actor.length > 160)
    return error('Identifique o operador administrativo.', 422);
  const body = parseJsonBody(await request.json().catch(() => null));
  if (!body) return error('Envie um objeto JSON válido.');
  const programId = stringField(body, 'programId');
  const userId = stringField(body, 'userId');
  const channelId = stringField(body, 'channelId');
  const reason = stringField(body, 'reason');
  if (!programId || !userId || !channelId || reason.length < 10)
    return error(
      'Informe programa, usuário, canal e uma justificativa auditável.',
      422,
    );

  const program = await env.DB.prepare(
    'SELECT id, owner_user_id, channel_id FROM programs WHERE id=?1',
  )
    .bind(programId)
    .first<ProgramRow>();
  if (!program) return error('Programa não encontrado.', 404);
  if (program.owner_user_id || program.channel_id)
    return error('O programa já possui associação de propriedade.', 409);

  const user = await env.DB.prepare('SELECT id FROM users WHERE id=?1')
    .bind(userId)
    .first<{ id: string }>();
  if (!user) return error('Usuário não encontrado.', 404);
  const connectionRow = await env.DB.prepare(
    `SELECT id, user_id, channel_id, channel_title, access_token_ciphertext,
       refresh_token_ciphertext, access_token_expires_at, revoked_at
     FROM youtube_connections
     WHERE user_id=?1 AND channel_id=?2 AND revoked_at IS NULL`,
  )
    .bind(userId, channelId)
    .first<ConnectionRow>();
  if (!connectionRow)
    return error('O usuário não possui uma conexão ativa para esse canal.', 403);

  const conflictingEpisode = await env.DB.prepare(
    `SELECT guid FROM episodes
     WHERE program_id=?1 AND owner_user_id IS NOT NULL AND owner_user_id<>?2
     LIMIT 1`,
  )
    .bind(programId, userId)
    .first<{ guid: string }>();
  if (conflictingEpisode)
    return error('O programa possui episódios associados a outro usuário.', 409);

  const connection: YoutubeConnection = {
    id: connectionRow.id,
    userId: connectionRow.user_id,
    channelId: connectionRow.channel_id,
    channelTitle: connectionRow.channel_title,
    accessTokenCiphertext: connectionRow.access_token_ciphertext,
    refreshTokenCiphertext: connectionRow.refresh_token_ciphertext,
    accessTokenExpiresAt: connectionRow.access_token_expires_at,
    revokedAt: connectionRow.revoked_at,
  };
  try {
    await usableConnection(connection);
  } catch (cause) {
    return providerFailureResponse(cause);
  }

  const associationId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE programs SET owner_user_id=?1, channel_id=?2, updated_at=?3
         WHERE id=?4 AND owner_user_id IS NULL AND channel_id IS NULL`,
      ).bind(userId, channelId, createdAt, programId),
      env.DB.prepare(
        'UPDATE episodes SET owner_user_id=?1 WHERE program_id=?2 AND owner_user_id IS NULL',
      ).bind(userId, programId),
      env.DB.prepare(
        `INSERT INTO ownership_associations
           (id, program_id, user_id, channel_id, actor, reason, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      ).bind(
        associationId,
        programId,
        userId,
        channelId,
        actor,
        reason,
        createdAt,
      ),
    ]);
  } catch {
    return error('Não foi possível registrar a associação administrativa.', 409);
  }
  return json({
    associationId,
    programId,
    userId,
    channelId,
    createdAt,
  });
}
