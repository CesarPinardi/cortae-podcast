export type EpisodeStatus =
  | 'draft'
  | 'processing'
  | 'ready'
  | 'scheduled'
  | 'published'
  | 'failed';
export type EpisodeKind = 'full' | 'trailer' | 'bonus';
export type DestinationStatus =
  | 'not_connected'
  | 'sent'
  | 'available'
  | 'problem';

export type Program = {
  id?: string;
  title: string;
  description: string;
  author: string;
  language: string;
  category: string;
  explicit: boolean;
  email: string;
  coverName: string;
  coverValid: boolean;
  coverUrl: string;
  slug: string;
  coverKey?: string;
  updatedAt?: string;
};

export type Episode = {
  guid: string;
  title: string;
  description: string;
  status: EpisodeStatus;
  kind: EpisodeKind;
  season: string;
  number: string;
  explicit: boolean;
  publishAt: string;
  timezone: string;
  publishedAt: string;
  audioName: string;
  mimeType: string;
  sizeBytes: number;
  duration: number;
  enclosureUrl: string;
  programId?: string;
  sourceUrl?: string;
  audioKey?: string;
  updatedAt?: string;
};

export type Destination = {
  status: DestinationStatus;
  publicUrl: string;
};

export const DEFAULT_PROGRAM: Program = {
  title: 'Cortaê Entrevistas',
  description:
    'Conversas sem corte sobre criação, trabalho e as ideias que movem a internet.',
  author: 'Cortaê Studio',
  language: 'pt-BR',
  category: 'Sociedade e cultura',
  explicit: false,
  email: 'podcast@cortae.app',
  coverName: 'capa-demo.jpg',
  coverValid: true,
  coverUrl: '',
  slug: 'cortae-entrevistas',
};

export const DEFAULT_DESTINATIONS: Record<string, Destination> = {
  spotify: { status: 'not_connected', publicUrl: '' },
  apple: { status: 'not_connected', publicUrl: '' },
  amazon: { status: 'not_connected', publicUrl: '' },
  youtube: { status: 'not_connected', publicUrl: '' },
};

export function createEpisode(
  title: string,
  audioName: string,
  duration: number,
  sizeBytes: number,
  mimeType: string,
): Episode {
  const guid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `cortae-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const extension =
    mimeType === 'audio/aac' ? 'aac' : mimeType === 'audio/wav' ? 'wav' : 'mp3';

  return {
    guid,
    title,
    description: 'Um novo episódio do Cortaê Entrevistas.',
    status: 'ready',
    kind: 'full',
    season: '',
    number: '',
    explicit: false,
    publishAt: '',
    timezone: 'America/Sao_Paulo',
    publishedAt: '',
    audioName: `${audioName || 'episodio'}.${extension}`,
    mimeType: mimeType.startsWith('audio/') ? mimeType : 'audio/mpeg',
    sizeBytes,
    duration,
    enclosureUrl: '',
  };
}

export function slugify(value: string) {
  return (
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 72) || 'meu-podcast'
  );
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

export function formatDuration(total: number) {
  const seconds = Math.max(0, Math.round(total));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours ? `${hours}:` : ''}${String(minutes).padStart(hours ? 2 : 1, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function formatRfc2822(iso: string) {
  return new Date(iso).toUTCString();
}

export function escapeXml(value: string | null | undefined) {
  return (value ?? '').replace(
    /[<>&'"]/g,
    (character) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        "'": '&apos;',
        '"': '&quot;',
      })[character] ?? character,
  );
}

export function feedUrl(program: Program) {
  return `/feed/${slugify(program.slug || program.title)}`;
}

export function buildFeedXml(program: Program, episode: Episode | null) {
  const item =
    episode?.status === 'published' &&
    episode.publishedAt &&
    new Date(episode.publishedAt).getTime() <= Date.now()
      ? `\n    <item>\n      <title>${escapeXml(episode.title)}</title>\n      <description>${escapeXml(episode.description)}</description>\n      <guid isPermaLink="false">${escapeXml(episode.guid)}</guid>\n      <pubDate>${formatRfc2822(episode.publishedAt)}</pubDate>\n      <enclosure url="${escapeXml(episode.enclosureUrl)}" length="${episode.sizeBytes}" type="${escapeXml(episode.mimeType)}" />\n      <itunes:duration>${formatDuration(episode.duration)}</itunes:duration>\n      <itunes:explicit>${episode.explicit ? 'true' : 'false'}</itunes:explicit>\n      <itunes:episodeType>${episode.kind}</itunes:episodeType>${episode.season ? `\n      <itunes:season>${escapeXml(episode.season)}</itunes:season>` : ''}${episode.number ? `\n      <itunes:episode>${escapeXml(episode.number)}</itunes:episode>` : ''}\n    </item>`
      : '';

  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/">\n  <channel>\n    <title>${escapeXml(program.title)}</title>\n    <link>https://cortae.app/podcast/${escapeXml(slugify(program.slug || program.title))}</link>\n    <description>${escapeXml(program.description)}</description>\n    <language>${escapeXml(program.language)}</language>\n    <itunes:author>${escapeXml(program.author)}</itunes:author>\n    <itunes:owner><itunes:name>${escapeXml(program.author)}</itunes:name><itunes:email>${escapeXml(program.email)}</itunes:email></itunes:owner>\n    <itunes:category text="${escapeXml(program.category)}" />\n    <itunes:image href="${escapeXml(program.coverUrl)}" />\n    <itunes:explicit>${program.explicit ? 'true' : 'false'}</itunes:explicit>${item}\n  </channel>\n</rss>`;
}

export function validateProgram(program: Program) {
  const errors: string[] = [];
  if (program.title.trim().length < 2)
    errors.push('Informe o título do programa.');
  if (program.description.trim().length < 10)
    errors.push('Escreva uma descrição com pelo menos 10 caracteres.');
  if (!program.author.trim()) errors.push('Informe o autor do programa.');
  if (!program.language) errors.push('Escolha o idioma do programa.');
  if (!program.category) errors.push('Escolha uma categoria.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(program.email))
    errors.push('Informe um e-mail de verificação válido.');
  if (!program.coverValid)
    errors.push('Adicione uma capa JPG ou PNG quadrada entre 1400 e 3000 px.');
  return errors;
}

export function validateEpisode(episode: Episode, program: Program) {
  const errors = validateProgram(program);
  if (episode.title.trim().length < 2)
    errors.push('Informe o título do episódio.');
  if (episode.description.trim().length < 10)
    errors.push('Escreva uma descrição para o episódio.');
  if (!episode.audioName || episode.sizeBytes <= 0)
    errors.push('O áudio final não está disponível.');
  if (!episode.mimeType.startsWith('audio/'))
    errors.push('O arquivo precisa ter um tipo de áudio válido.');
  if (episode.duration <= 0)
    errors.push('A duração do áudio precisa ser maior que zero.');
  if (
    episode.status === 'scheduled' &&
    (!episode.publishAt || Number.isNaN(new Date(episode.publishAt).getTime()))
  )
    errors.push('Informe uma data e hora válidas para o agendamento.');
  return errors;
}
