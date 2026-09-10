import { env } from 'cloudflare:workers';
import { EpisodeKind } from '@/lib/podcast';
import {
  requireAuth,
  providerFailureResponse,
  usableConnection,
} from '@/lib/server/auth';
import {
  error,
  json,
  parseJsonBody,
  stringField,
  isValidTimezone,
  toUtcIso,
} from '@/lib/server/http';
import { findOwnedEpisode } from '@/lib/server/podcast-db';
import {
  SourceVerificationError,
  verifyOrConsumeSource,
} from '@/lib/server/source-verification';

const kinds = new Set<EpisodeKind>(['full', 'trailer', 'bonus']);
const editableStatuses = new Set(['draft', 'ready', 'scheduled', 'failed']);

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

async function ownedEpisode(request: Request, guid: string, csrf = false) {
  const auth = await requireAuth(request, { csrf, channel: true });
  if ('response' in auth) return { response: auth.response } as const;
  const episode = await findOwnedEpisode(
    guid,
    auth.context.userId,
    auth.context.connection?.channelId ?? '',
  );
  if (!episode)
    return { response: error('Episódio não encontrado.', 404) } as const;
  return { auth: auth.context, episode } as const;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ guid: string }> | { guid: string } },
) {
  const { guid } = await Promise.resolve(context.params);
  const result = await ownedEpisode(request, guid);
  if ('response' in result) return result.response;
  return json(result.episode);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ guid: string }> | { guid: string } },
) {
  const { guid } = await Promise.resolve(context.params);
  const result = await ownedEpisode(request, guid, true);
  if ('response' in result) return result.response;
  const body = parseJsonBody(await request.json().catch(() => null));
  if (!body) return error('Envie um objeto JSON válido.');
  const current = result.episode;
  const title = stringField(body, 'title') || current.title;
  const description = stringField(body, 'description') || current.description;
  const kind = (stringField(body, 'kind') || current.kind) as EpisodeKind;
  const audioName = stringField(body, 'audioName') || current.audioName;
  const timezone = stringField(body, 'timezone') || current.timezone;
  const publishAt = stringField(body, 'publishAt') || null;
  const status = stringField(body, 'status') || current.status;
  if (title.length < 2 || description.length < 10)
    return error('Título e descrição precisam ser válidos.', 422);
  if (!kinds.has(kind)) return error('Tipo de episódio inválido.', 422);
  if (!isValidTimezone(timezone)) return error('Fuso horário inválido.', 422);
  if (!editableStatuses.has(status))
    return error('Estado não pode ser alterado por esta operação.', 422);
  const publishAtUtc = publishAt ? toUtcIso(publishAt) : null;
  if (publishAt && !publishAtUtc)
    return error('Data de publicação inválida.', 422);

  let sourceUrl = current.sourceUrl ?? '';
  let sourceVideoId = current.sourceVideoId ?? '';
  let sourceChannelId = current.sourceChannelId ?? '';
  let sourceVerificationId = current.sourceVerificationId ?? '';
  if (Object.prototype.hasOwnProperty.call(body, 'sourceUrl')) {
    sourceUrl = stringField(body, 'sourceUrl');
    if (!sourceUrl) return error('Informe a origem do episódio.', 422);
    try {
      const verification = await verifyOrConsumeSource(
        result.auth,
        current.programId ?? '',
        sourceUrl,
        stringField(body, 'verificationId') || undefined,
      );
      sourceVideoId = verification.videoId;
      sourceChannelId = verification.channelId;
      sourceVerificationId = verification.id;
      sourceUrl = verification.sourceUrl;
    } catch (cause) {
      return sourceError(cause);
    }
  }
  if (!sourceVideoId || !sourceChannelId || !sourceVerificationId)
    return error('A origem do episódio precisa ser verificada.', 422);
  if (status === 'scheduled') {
    if (sourceChannelId !== result.auth.connection?.channelId)
      return error(
        'A origem do episódio não está verificada para este canal.',
        403,
      );
    try {
      await usableConnection(result.auth.connection!);
    } catch (cause) {
      return providerFailureResponse(cause);
    }
    if (!publishAtUtc || Date.parse(publishAtUtc) <= Date.now())
      return error('Escolha uma data futura válida.', 422);
    const audio = await env.MEDIA.head(current.audioKey);
    if (
      !audio ||
      audio.size !== current.sizeBytes ||
      (current.audioEtag && audio.httpEtag !== current.audioEtag)
    )
      return error('Envie um áudio final válido antes de agendar.', 422);
  }
  const now = new Date().toISOString();
  const update = await env.DB.prepare(
    `UPDATE episodes SET title=?1, description=?2, explicit=?3, episode_type=?4, season=?5,
       episode_number=?6, publish_at=?7, timezone=?8, status=?9, audio_name=?10,
       source_url=?11, source_video_id=?12, source_channel_id=?13, source_verification_id=?14,
       updated_at=?15
     WHERE guid=?16 AND owner_user_id=?17`,
  )
    .bind(
      title,
      description,
      body.explicit === undefined
        ? current.explicit
          ? 1
          : 0
        : body.explicit === true
          ? 1
          : 0,
      kind,
      stringField(body, 'season') || current.season || null,
      stringField(body, 'number') || current.number || null,
      publishAtUtc,
      timezone,
      status,
      audioName,
      sourceUrl,
      sourceVideoId,
      sourceChannelId,
      sourceVerificationId,
      now,
      guid,
      result.auth.userId,
    )
    .run();
  if (!update.meta.changes)
    return error(
      'O episódio mudou durante a atualização. Tente novamente.',
      409,
    );
  return json({
    ...current,
    title,
    description,
    status,
    sourceUrl,
    updatedAt: now,
  });
}
