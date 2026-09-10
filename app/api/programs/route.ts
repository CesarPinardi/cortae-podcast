import { env } from 'cloudflare:workers';
import { DEFAULT_DESTINATIONS } from '@/lib/podcast';
import {
  providerFailureResponse,
  requireAuth,
  usableConnection,
} from '@/lib/server/auth';
import { error, json } from '@/lib/server/http';
import {
  coverKey,
  formFields,
  validateCover,
  validateProgramFields,
} from '@/lib/server/program';

export async function POST(request: Request) {
  const auth = await requireAuth(request, { csrf: true, channel: true });
  if ('response' in auth) return auth.response;
  const form = await request.formData().catch(() => null);
  if (!form)
    return error('Envie os dados do programa como multipart/form-data.');
  const fields = formFields(form);
  const coverEntry = form.get('cover');
  const cover = coverEntry instanceof File ? coverEntry : null;
  const existing = await env.DB.prepare(
    'SELECT id FROM programs WHERE slug = ?1',
  )
    .bind(fields.slug)
    .first<{ id: string }>();
  if (existing) return error('O slug do programa já está em uso.', 409);
  const errors = [
    ...validateProgramFields(fields, cover, true),
    ...(await validateCover(cover)),
  ];
  if (errors.length)
    return error('Não foi possível criar o programa.', 422, errors);
  if (!cover) return error('Adicione uma capa JPG ou PNG.', 422);
  try {
    await usableConnection(auth.context.connection!);
  } catch (cause) {
    return providerFailureResponse(cause);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const newCoverKey = coverKey(id, cover?.name ?? 'capa.jpg');
  await env.MEDIA.put(newCoverKey, cover.stream(), {
    httpMetadata: {
      contentType: cover.type,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });
  try {
    await env.DB.prepare(
      `INSERT INTO programs
       (id, slug, owner_user_id, channel_id, title, description, author, language, category, explicit,
        email, cover_key, cover_content_type, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)`,
    )
      .bind(
        id,
        fields.slug,
        auth.context.userId,
        auth.context.connection?.channelId,
        fields.title,
        fields.description,
        fields.author,
        fields.language,
        fields.category,
        fields.explicit ? 1 : 0,
        fields.email,
        newCoverKey,
        cover.type,
        now,
      )
      .run();
  } catch (cause) {
    await env.MEDIA.delete(newCoverKey);
    if (String(cause).toLowerCase().includes('unique'))
      return error('O slug do programa já está em uso.', 409);
    throw cause;
  }

  const statements = Object.entries(DEFAULT_DESTINATIONS).map(
    ([platform, destination]) =>
      env.DB.prepare(
        `INSERT INTO destinations (program_id, platform, status, public_url, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      ).bind(id, platform, destination.status, destination.publicUrl, now),
  );
  await env.DB.batch(statements);
  return json({ id, slug: fields.slug, feedPath: `/feed/${fields.slug}` }, 201);
}

export async function GET(request: Request) {
  const auth = await requireAuth(request, { channel: true });
  if ('response' in auth) return auth.response;
  const slug = new URL(request.url).searchParams.get('slug')?.trim();
  if (!slug) return error('Informe o slug do programa.', 400);
  const program = await env.DB.prepare(
    `SELECT * FROM programs
     WHERE slug=?1 AND owner_user_id=?2 AND channel_id=?3`,
  )
    .bind(slug, auth.context.userId, auth.context.connection?.channelId)
    .first();
  if (!program) return error('Programa não encontrado.', 404);
  return json(program);
}
