import { env } from 'cloudflare:workers';
import {
  DEFAULT_DESTINATIONS,
  Destination,
  DestinationStatus,
} from '@/lib/podcast';
import { error, json, parseJsonBody, stringField } from '@/lib/server/http';
import { findProgram } from '@/lib/server/podcast-db';

const statuses = new Set<DestinationStatus>([
  'not_connected',
  'sent',
  'available',
  'problem',
]);

function isPublicUrl(value: string) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function PATCH(
  request: Request,
  context: {
    params:
      | Promise<{ slug: string; platform: string }>
      | { slug: string; platform: string };
  },
) {
  const { slug, platform } = await Promise.resolve(context.params);
  const defaultDestination = DEFAULT_DESTINATIONS[platform];
  if (!defaultDestination) return error('Agregador não suportado.', 404);
  const program = await findProgram(slug);
  if (!program || !program.id) return error('Programa não encontrado.', 404);
  const body = parseJsonBody(await request.json().catch(() => null));
  if (!body) return error('Envie um objeto JSON válido.');

  const status = stringField(body, 'status') as DestinationStatus;
  const publicUrl = stringField(body, 'publicUrl');
  if (!statuses.has(status)) return error('Estado do agregador inválido.', 422);
  if (publicUrl.length > 2048 || !isPublicUrl(publicUrl))
    return error(
      'Informe uma URL pública http(s) válida ou limpe o campo.',
      422,
    );

  const updatedAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO destinations (program_id, platform, status, public_url, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(program_id, platform) DO UPDATE SET
       status=excluded.status, public_url=excluded.public_url,
       updated_at=excluded.updated_at`,
  )
    .bind(program.id, platform, status, publicUrl, updatedAt)
    .run();
  const destination: Destination = { status, publicUrl };
  return json({ destination });
}
