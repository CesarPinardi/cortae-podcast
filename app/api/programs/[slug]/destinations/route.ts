import { DEFAULT_DESTINATIONS } from '@/lib/podcast';
import { error, json } from '@/lib/server/http';
import { findProgram, listDestinations } from '@/lib/server/podcast-db';

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> | { slug: string } },
) {
  const { slug } = await Promise.resolve(context.params);
  const program = await findProgram(slug);
  if (!program || !program.id) return error('Programa não encontrado.', 404);
  const destinations = await listDestinations(program.id);
  return json({
    id: program.id,
    destinations: { ...DEFAULT_DESTINATIONS, ...destinations },
  });
}
