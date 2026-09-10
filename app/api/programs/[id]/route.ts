import { env } from 'cloudflare:workers';
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

type ProgramRow = {
  id: string;
  slug: string;
  owner_user_id: string;
  channel_id: string;
  cover_key: string;
  cover_content_type: string;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const auth = await requireAuth(request, { csrf: true, channel: true });
  if ('response' in auth) return auth.response;
  const { id } = await Promise.resolve(context.params);
  const current = await env.DB.prepare(
    `SELECT id, slug, owner_user_id, channel_id, cover_key, cover_content_type
     FROM programs WHERE id=?1 AND owner_user_id=?2 AND channel_id=?3`,
  )
    .bind(id, auth.context.userId, auth.context.connection?.channelId)
    .first<ProgramRow>();
  if (!current) return error('Programa não encontrado.', 404);
  try {
    await usableConnection(auth.context.connection!);
  } catch (cause) {
    return providerFailureResponse(cause);
  }
  const form = await request.formData().catch(() => null);
  if (!form)
    return error('Envie os dados do programa como multipart/form-data.');
  const fields = formFields(form);
  const coverEntry = form.get('cover');
  const cover = coverEntry instanceof File ? coverEntry : null;
  const errors = [
    ...validateProgramFields(fields, cover, false),
    ...(await validateCover(cover)),
  ];
  if (errors.length)
    return error('Não foi possível atualizar o programa.', 422, errors);
  const now = new Date().toISOString();
  const nextCoverKey = cover ? coverKey(id, cover.name) : current.cover_key;
  if (cover)
    await env.MEDIA.put(nextCoverKey, cover.stream(), {
      httpMetadata: {
        contentType: cover.type,
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
  try {
    const result = await env.DB.prepare(
      `UPDATE programs SET title=?1, description=?2, author=?3, language=?4, category=?5,
       explicit=?6, email=?7, cover_key=?8, cover_content_type=?9, updated_at=?10
       WHERE id=?11 AND owner_user_id=?12 AND channel_id=?13`,
    )
      .bind(
        fields.title,
        fields.description,
        fields.author,
        fields.language,
        fields.category,
        fields.explicit ? 1 : 0,
        fields.email,
        nextCoverKey,
        cover?.type ?? current.cover_content_type,
        now,
        id,
        auth.context.userId,
        auth.context.connection?.channelId,
      )
      .run();
    if (!result.meta.changes) {
      if (cover) await env.MEDIA.delete(nextCoverKey);
      return error(
        'Programa mudou durante a atualização. Tente novamente.',
        409,
      );
    }
  } catch (cause) {
    if (cover) await env.MEDIA.delete(nextCoverKey);
    throw cause;
  }
  return json({ id, slug: current.slug, feedPath: `/feed/${current.slug}` });
}
