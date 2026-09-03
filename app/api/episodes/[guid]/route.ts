import { env } from 'cloudflare:workers';
import { EpisodeKind } from '@/lib/podcast';
import {
  error,
  json,
  parseJsonBody,
  stringField,
  isValidTimezone,
  toUtcIso,
} from '@/lib/server/http';
import { findEpisode } from '@/lib/server/podcast-db';

const kinds = new Set<EpisodeKind>(['full', 'trailer', 'bonus']);
const editableStatuses = new Set(['draft', 'ready', 'scheduled', 'failed']);

export async function GET(
  _request: Request,
  context: { params: Promise<{ guid: string }> | { guid: string } },
) {
  const { guid } = await Promise.resolve(context.params);
  const episode = await findEpisode(guid);
  if (!episode) return error('Episódio não encontrado.', 404);
  return json(episode);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ guid: string }> | { guid: string } },
) {
  const { guid } = await Promise.resolve(context.params);
  const current = await findEpisode(guid);
  if (!current) return error('Episódio não encontrado.', 404);
  const body = parseJsonBody(await request.json().catch(() => null));
  if (!body) return error('Envie um objeto JSON válido.');
  const title = stringField(body, 'title') || current.title;
  const description = stringField(body, 'description') || current.description;
  const kind = (stringField(body, 'kind') || current.kind) as EpisodeKind;
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
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE episodes SET title=?1, description=?2, explicit=?3, episode_type=?4, season=?5, episode_number=?6,
      publish_at=?7, timezone=?8, status=?9, updated_at=?10 WHERE guid=?11`,
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
      now,
      guid,
    )
    .run();
  return GET(request, { params: { guid } });
}
