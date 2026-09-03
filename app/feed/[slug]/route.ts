import { escapeXml, formatDuration, formatRfc2822 } from '@/lib/podcast';
import { absoluteUrl } from '@/lib/server/http';
import { findPublishedEpisodes, findProgram } from '@/lib/server/podcast-db';

function feedXml(
  request: Request,
  program: Awaited<ReturnType<typeof findProgram>>,
  episodes: Awaited<ReturnType<typeof findPublishedEpisodes>>,
) {
  if (!program) return '';
  const base = new URL(request.url).origin;
  const coverUrl = absoluteUrl(request, `/media/${program.coverKey}`);
  const items = episodes
    .map((episode) => {
      const enclosureUrl = absoluteUrl(request, `/media/${episode.audioKey}`);
      return `\n    <item>\n      <title>${escapeXml(episode.title)}</title>\n      <description>${escapeXml(episode.description)}</description>\n      <guid isPermaLink="false">${escapeXml(episode.guid)}</guid>\n      <pubDate>${formatRfc2822(episode.publishedAt)}</pubDate>\n      <enclosure url="${escapeXml(enclosureUrl)}" length="${episode.sizeBytes}" type="${escapeXml(episode.mimeType)}" />\n      <itunes:duration>${formatDuration(episode.duration)}</itunes:duration>\n      <itunes:explicit>${episode.explicit ? 'true' : 'false'}</itunes:explicit>\n      <itunes:episodeType>${episode.kind}</itunes:episodeType>${episode.season ? `\n      <itunes:season>${escapeXml(episode.season)}</itunes:season>` : ''}${episode.number ? `\n      <itunes:episode>${escapeXml(episode.number)}</itunes:episode>` : ''}\n    </item>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/">\n  <channel>\n    <title>${escapeXml(program.title)}</title>\n    <link>${escapeXml(`${base}/podcast/${program.slug}`)}</link>\n    <description>${escapeXml(program.description)}</description>\n    <language>${escapeXml(program.language)}</language>\n    <itunes:author>${escapeXml(program.author)}</itunes:author>\n    <itunes:owner><itunes:name>${escapeXml(program.author)}</itunes:name><itunes:email>${escapeXml(program.email)}</itunes:email></itunes:owner>\n    <itunes:category text="${escapeXml(program.category)}" />\n    <itunes:image href="${escapeXml(coverUrl)}" />\n    <itunes:explicit>${program.explicit ? 'true' : 'false'}</itunes:explicit>${items}\n  </channel>\n</rss>`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> | { slug: string } },
) {
  const { slug } = await Promise.resolve(context.params);
  const program = await findProgram(slug);
  if (!program) return new Response('Feed não encontrado.', { status: 404 });
  const episodes = await findPublishedEpisodes(
    program.id,
    new Date().toISOString(),
  );
  const xml = feedXml(request, program, episodes);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(xml),
  );
  const etag = `"${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}"`;
  if (request.headers.get('if-none-match') === etag)
    return new Response(null, { status: 304, headers: { etag } });
  return new Response(xml, {
    headers: {
      'cache-control':
        'public, max-age=60, s-maxage=300, stale-while-revalidate=86400',
      'content-type': 'application/rss+xml; charset=utf-8',
      etag,
      'last-modified': new Date().toUTCString(),
    },
  });
}
