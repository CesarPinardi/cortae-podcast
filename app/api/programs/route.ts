import { env } from 'cloudflare:workers';
import { DEFAULT_DESTINATIONS, slugify } from '@/lib/podcast';
import { error, json, safeSegment } from '@/lib/server/http';

const MAX_COVER_BYTES = 15 * 1024 * 1024;

function formFields(form: FormData) {
  const value = (key: string) => {
    const entry = form.get(key);
    return typeof entry === 'string' ? entry.trim() : '';
  };
  return {
    title: value('title'),
    description: value('description'),
    author: value('author'),
    language: value('language'),
    category: value('category'),
    email: value('email'),
    explicit: form.get('explicit') === 'true',
    slug: slugify(value('slug')),
  };
}

function validateProgramFields(
  fields: ReturnType<typeof formFields>,
  cover: File | null,
  requiresCover: boolean,
) {
  const errors: string[] = [];
  if (fields.title.length < 2) errors.push('Informe o título do programa.');
  if (fields.description.length < 10)
    errors.push('Escreva uma descrição com pelo menos 10 caracteres.');
  if (!fields.author) errors.push('Informe o autor do programa.');
  if (!fields.language) errors.push('Escolha o idioma do programa.');
  if (!fields.category) errors.push('Escolha uma categoria.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email))
    errors.push('Informe um e-mail de verificação válido.');
  if (
    requiresCover &&
    (!cover || !['image/jpeg', 'image/png'].includes(cover.type))
  )
    errors.push('Adicione uma capa JPG ou PNG.');
  if (cover && cover.size > MAX_COVER_BYTES)
    errors.push('A capa não pode exceder 15 MB.');
  return errors;
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form)
    return error('Envie os dados do programa como multipart/form-data.');
  const fields = formFields(form);
  const coverEntry = form.get('cover');
  const cover = coverEntry instanceof File ? coverEntry : null;
  const existing = await env.DB.prepare(
    'SELECT id, cover_key FROM programs WHERE slug = ?1',
  )
    .bind(fields.slug)
    .first<{ id: string; cover_key: string }>();
  const errors = validateProgramFields(fields, cover, !existing);
  if (errors.length)
    return error('Não foi possível salvar o programa.', 422, errors);
  const id = existing?.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const coverKey =
    existing?.cover_key ??
    `covers/${id}/${safeSegment(cover?.name ?? 'capa.jpg')}`;

  if (cover) {
    await env.MEDIA.put(coverKey, cover.stream(), {
      httpMetadata: {
        contentType: cover.type,
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
  }
  await env.DB.prepare(
    `INSERT INTO programs (id, slug, title, description, author, language, category, explicit, email, cover_key, cover_content_type, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)
     ON CONFLICT(slug) DO UPDATE SET title=excluded.title, description=excluded.description, author=excluded.author,
       language=excluded.language, category=excluded.category, explicit=excluded.explicit, email=excluded.email,
       cover_key=excluded.cover_key, cover_content_type=excluded.cover_content_type, updated_at=excluded.updated_at`,
  )
    .bind(
      id,
      fields.slug,
      fields.title,
      fields.description,
      fields.author,
      fields.language,
      fields.category,
      fields.explicit ? 1 : 0,
      fields.email,
      coverKey,
      cover?.type ?? 'image/jpeg',
      now,
    )
    .run();

  const statements = Object.entries(DEFAULT_DESTINATIONS).map(
    ([platform, destination]) =>
      env.DB.prepare(
        `INSERT INTO destinations (program_id, platform, status, public_url, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(program_id, platform) DO NOTHING`,
      ).bind(id, platform, destination.status, destination.publicUrl, now),
  );
  await env.DB.batch(statements);
  return json(
    { id, slug: fields.slug, feedPath: `/feed/${fields.slug}` },
    existing ? 200 : 201,
  );
}

export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get('slug')?.trim();
  if (!slug) return error('Informe o slug do programa.', 400);
  const program = await env.DB.prepare('SELECT * FROM programs WHERE slug = ?1')
    .bind(slug)
    .first();
  if (!program) return error('Programa não encontrado.', 404);
  return json(program);
}
