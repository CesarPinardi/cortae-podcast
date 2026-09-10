import { env } from 'cloudflare:workers';
import { EpisodeKind, EpisodeStatus } from '@/lib/podcast';
import { requireAuth, providerFailureResponse } from '@/lib/server/auth';
import {
  error,
  json,
  parseJsonBody,
  safeSegment,
  stringField,
  isValidTimezone,
  toUtcIso,
} from '@/lib/server/http';
import { findOwnedProgram } from '@/lib/server/podcast-db';
import {
  SourceVerificationError,
  verifyOrConsumeSource,
} from '@/lib/server/source-verification';

const kinds = new Set<EpisodeKind>(['full', 'trailer', 'bonus']);
const statuses = new Set<EpisodeStatus>([
  'draft',
  'processing',
  'ready',
  'scheduled',
  'published',
  'failed',
]);

function asBoolean(value: unknown) {
  return value === true || value === 'true';
}

function sourceError(cause: unknown) {
  if (!(cause instanceof SourceVerificationError))
    return providerFailureResponse(cause);
  const status =
    cause.kind === 'forbidden'
      ? 403
      : cause.kind === 'not_found'
        ? 404
        : cause.kind === 'conflict'
          ? 409
          : 422;
  return error(cause.message, status);
}

export async function POST(request: Request) {
  const auth = await requireAuth(request, { csrf: true, channel: true });
  if ('response' in auth) return auth.response;
  const body = parseJsonBody(await request.json().catch(() => null));
  if (!body) return error('Envie um objeto JSON válido.');
  const programId = stringField(body, 'programId');
  const title = stringField(body, 'title');
  const description = stringField(body, 'description');
  const sourceUrl = stringField(body, 'sourceUrl');
  const timezone = stringField(body, 'timezone') || 'America/Sao_Paulo';
  const kind = stringField(body, 'kind') as EpisodeKind;
  const audioName = stringField(body, 'audioName') || 'episodio.mp3';
  const mimeType = stringField(body, 'mimeType');
  const sizeBytes = Number(body.sizeBytes);
  const duration = Number(body.duration);
  const status = (stringField(body, 'status') || 'processing') as EpisodeStatus;
  const publishAt = stringField(body, 'publishAt') || null;
  const publishAtUtc = publishAt ? toUtcIso(publishAt) : null;
  const errors: string[] = [];
  const program = programId
    ? await findOwnedProgram(
        programId,
        auth.context.userId,
        auth.context.connection?.channelId ?? '',
      )
    : null;
  if (!program) return error('Programa não encontrado.', 404);
  if (title.length < 2) errors.push('Informe o título do episódio.');
  if (description.length < 10)
    errors.push('Escreva uma descrição para o episódio.');
  if (!sourceUrl) errors.push('Informe a origem do episódio.');
  if (!kinds.has(kind)) errors.push('Tipo de episódio inválido.');
  if (!statuses.has(status) || status === 'published')
    errors.push('Estado inicial de episódio inválido.');
  if (!isValidTimezone(timezone)) errors.push('Fuso horário inválido.');
  if (publishAt && !publishAtUtc) errors.push('Data de publicação inválida.');
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0)
    errors.push('Informe o tamanho do áudio em bytes.');
  if (!Number.isInteger(duration) || duration <= 0)
    errors.push('Informe uma duração válida para o áudio.');
  if (!mimeType.startsWith('audio/'))
    errors.push('O MIME type precisa ser de áudio.');
  if (errors.length)
    return error('Não foi possível criar o episódio.', 422, errors);

  let verification;
  try {
    verification = await verifyOrConsumeSource(
      auth.context,
      programId,
      sourceUrl,
      stringField(body, 'verificationId') || undefined,
    );
  } catch (cause) {
    return sourceError(cause);
  }
  const guid = crypto.randomUUID();
  const audioKey = `audio/${programId}/${guid}/${safeSegment(audioName)}`;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO episodes
       (guid, program_id, owner_user_id, source_url, source_video_id, source_channel_id,
        source_verification_id, title, description, status, audio_key, audio_name, mime_type,
        size_bytes, duration_seconds, explicit, episode_type, season, episode_number, publish_at,
        timezone, published_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, NULL, ?22, ?22)`,
  )
    .bind(
      guid,
      programId,
      auth.context.userId,
      verification.sourceUrl,
      verification.videoId,
      verification.channelId,
      verification.id,
      title,
      description,
      status,
      audioKey,
      audioName,
      mimeType,
      sizeBytes,
      duration,
      asBoolean(body.explicit) ? 1 : 0,
      kind,
      stringField(body, 'season') || null,
      stringField(body, 'number') || null,
      publishAtUtc,
      timezone,
      now,
    )
    .run();
  return json(
    {
      guid,
      audioKey,
      status,
      sourceVideoId: verification.videoId,
      sourceChannelId: verification.channelId,
      mediaPath: `/media/${audioKey}`,
    },
    201,
  );
}
