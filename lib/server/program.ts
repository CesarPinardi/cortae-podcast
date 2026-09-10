import { slugify } from '@/lib/podcast';
import { safeSegment } from '@/lib/server/http';

export const MAX_COVER_BYTES = 15 * 1024 * 1024;

export function formFields(form: FormData) {
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

export function validateProgramFields(
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

export async function validateCover(cover: File | null) {
  if (!cover) return [];
  const bytes = new Uint8Array(await cover.arrayBuffer());
  let width = 0;
  let height = 0;
  let transparent = false;
  if (
    cover.type === 'image/png' &&
    bytes.length >= 26 &&
    bytes
      .slice(0, 8)
      .every(
        (value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index],
      )
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    width = view.getUint32(16);
    height = view.getUint32(20);
    transparent = bytes[25] === 4 || bytes[25] === 6;
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset);
      const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
      if (type === 'tRNS') transparent = true;
      offset += 12 + length;
    }
  } else if (
    cover.type === 'image/jpeg' &&
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8
  ) {
    for (let offset = 2; offset + 9 < bytes.length;) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      while (bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset++];
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (marker === 0xda || offset + 1 >= bytes.length) break;
      const length = (bytes[offset] << 8) | bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length) break;
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        height = (bytes[offset + 3] << 8) | bytes[offset + 4];
        width = (bytes[offset + 5] << 8) | bytes[offset + 6];
        break;
      }
      offset += length;
    }
  }
  const errors: string[] = [];
  if (!width || !height)
    errors.push('A capa precisa ser um JPG ou PNG válido.');
  else if (width !== height || width < 1400 || width > 3000)
    errors.push('A capa precisa ser quadrada entre 1400 e 3000 px.');
  if (transparent) errors.push('A capa não pode ter transparência.');
  return errors;
}

export function coverKey(programId: string, filename: string) {
  return `covers/${programId}/${crypto.randomUUID()}-${safeSegment(filename)}`;
}
