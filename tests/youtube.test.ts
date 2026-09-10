import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  findVideo,
  listMyChannels,
  parseYouTubeVideoId,
} from '../lib/server/youtube.ts';

void test('extrai somente IDs de URLs YouTube conhecidas', () => {
  assert.equal(
    parseYouTubeVideoId('https://www.youtube.com/watch?v=jrLKTOvlYuE'),
    'jrLKTOvlYuE',
  );
  assert.equal(
    parseYouTubeVideoId('https://youtu.be/jrLKTOvlYuE?t=10'),
    'jrLKTOvlYuE',
  );
  assert.equal(
    parseYouTubeVideoId('https://www.youtube.com/live/jrLKTOvlYuE'),
    'jrLKTOvlYuE',
  );
  assert.equal(
    parseYouTubeVideoId('http://www.youtube.com/watch?v=jrLKTOvlYuE'),
    null,
  );
  assert.equal(
    parseYouTubeVideoId('https://youtube.com.evil/watch?v=jrLKTOvlYuE'),
    null,
  );
  assert.equal(
    parseYouTubeVideoId('https://www.youtube.com/watch?v=short'),
    null,
  );
});

void test('cliente YouTube pagina canais e consulta vídeo com respostas simuladas', async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    requests.push(url);
    if (url.includes('/channels?') && !url.includes('pageToken=next'))
      return Response.json({
        items: [{ id: 'channel-a', snippet: { title: 'Canal A' } }],
        nextPageToken: 'next',
      });
    if (url.includes('/channels?') && url.includes('pageToken=next'))
      return Response.json({
        items: [{ id: 'channel-b', snippet: { title: 'Canal B' } }],
      });
    if (url.includes('/videos?'))
      return Response.json({
        items: [
          {
            id: 'jrLKTOvlYuE',
            snippet: { channelId: 'channel-a', title: 'Live' },
          },
        ],
      });
    return new Response('{}', { status: 404 });
  };
  try {
    assert.deepEqual(
      await listMyChannels('token', {
        apiBaseUrl: 'https://fake.test/youtube',
      }),
      [
        { id: 'channel-a', title: 'Canal A' },
        { id: 'channel-b', title: 'Canal B' },
      ],
    );
    assert.deepEqual(
      await findVideo('token', 'jrLKTOvlYuE', {
        apiBaseUrl: 'https://fake.test/youtube',
      }),
      { id: 'jrLKTOvlYuE', channelId: 'channel-a', title: 'Live' },
    );
    assert.equal(requests.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
