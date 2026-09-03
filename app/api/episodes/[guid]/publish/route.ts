import { env } from 'cloudflare:workers';
import { error, json } from '@/lib/server/http';
import { findEpisode, findProgramById } from '@/lib/server/podcast-db';

export async function POST(
  request: Request,
  context: { params: Promise<{ guid: string }> | { guid: string } },
) {
  const { guid } = await Promise.resolve(context.params);
  const episode = await findEpisode(guid);
  if (!episode) return error('Episódio não encontrado.', 404);
  if (episode.status === 'published' && episode.publishedAt)
    return json({
      guid,
      status: 'published',
      publishedAt: episode.publishedAt,
    });
  const program = await findProgramById(episode.programId);
  const [audio, cover] = await Promise.all([
    env.MEDIA.head(episode.audioKey),
    program ? env.MEDIA.head(program.coverKey) : null,
  ]);
  const errors: string[] = [];
  if (!program) errors.push('Programa não encontrado.');
  if (!audio || audio.size !== episode.sizeBytes)
    errors.push('O áudio publicado não está disponível ou mudou de tamanho.');
  if (!cover) errors.push('A capa do programa não está disponível.');
  if (episode.title.length < 2)
    errors.push('O título do episódio é obrigatório.');
  if (episode.description.length < 10)
    errors.push('A descrição do episódio é obrigatória.');
  if (errors.length)
    return error('Publicação bloqueada até corrigir os dados.', 422, errors);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE episodes SET status='published', publish_at=NULL, published_at=?1, updated_at=?1 WHERE guid=?2 AND status <> 'published'`,
  )
    .bind(now, guid)
    .run();
  return json({
    guid,
    status: 'published',
    publishedAt: now,
    feedPath: `/feed/${program?.slug}`,
  });
}
