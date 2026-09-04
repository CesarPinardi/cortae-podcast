import assert from 'node:assert/strict';

const baseUrl = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
const slug = `fluxo-audio-${Date.now()}`;
const coverBytes = new Uint8Array(26);
coverBytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
const coverView = new DataView(coverBytes.buffer);
coverView.setUint32(8, 13);
coverBytes.set(new TextEncoder().encode('IHDR'), 12);
coverView.setUint32(16, 1400);
coverView.setUint32(20, 1400);
coverBytes[24] = 8;
coverBytes[25] = 2;
const audioBytes = new Uint8Array(128).fill(1);
audioBytes.set(new TextEncoder().encode('ID3'));

async function responseJson(response) {
  const body = await response.json();
  if (!response.ok)
    throw new Error(`${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function createEpisode(programId, suffix) {
  return responseJson(
    await fetch(`${baseUrl}/api/episodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        programId,
        sourceUrl: 'https://www.youtube.com/watch?v=fixture',
        title: `Episódio ${suffix}`,
        description: 'Episódio usado pelo teste externo do fluxo de áudio.',
        kind: 'full',
        audioName: `${suffix}.mp3`,
        mimeType: 'audio/mpeg',
        sizeBytes: audioBytes.byteLength,
        duration: 120,
      }),
    }),
  );
}

const programForm = new FormData();
programForm.set('title', 'Programa de teste');
programForm.set('description', 'Programa usado pelo teste externo do Cortaê.');
programForm.set('author', 'Cortaê');
programForm.set('language', 'pt-BR');
programForm.set('category', 'Tecnologia');
programForm.set('email', 'teste@example.com');
programForm.set('explicit', 'false');
programForm.set('slug', slug);
programForm.set(
  'cover',
  new File([coverBytes], 'cover.png', { type: 'image/png' }),
);
const program = await responseJson(
  await fetch(`${baseUrl}/api/programs`, {
    method: 'POST',
    body: programForm,
  }),
);

const missingAudio = await createEpisode(program.id, 'sem-audio');
await fetch(`${baseUrl}/api/episodes/${missingAudio.guid}`, {
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ publishAt: new Date(Date.now() + 60_000).toISOString() }),
});
const missingSchedule = await fetch(
  `${baseUrl}/api/episodes/${missingAudio.guid}/schedule`,
  { method: 'POST' },
);
assert.equal(missingSchedule.status, 422);

const episode = await createEpisode(program.id, 'real');
const invalidUpload = await fetch(
  `${baseUrl}/api/episodes/${episode.guid}/audio`,
  {
    method: 'POST',
    headers: {
      'content-type': 'audio/mpeg',
      'x-audio-duration-seconds': '321',
    },
    body: 'isto não é áudio',
  },
);
assert.equal(invalidUpload.status, 415);

const uploaded = await responseJson(
  await fetch(`${baseUrl}/api/episodes/${episode.guid}/audio`, {
    method: 'POST',
    headers: {
      'content-type': 'audio/mpeg',
      'x-audio-duration-seconds': '321',
    },
    body: audioBytes,
  }),
);
assert.equal(uploaded.sizeBytes, audioBytes.byteLength);
assert.equal(uploaded.mimeType, 'audio/mpeg');
assert.equal(uploaded.duration, 321);

const persisted = await responseJson(
  await fetch(`${baseUrl}/api/episodes/${episode.guid}`),
);
assert.equal(persisted.duration, 321);
assert.equal(persisted.audioKey, uploaded.audioKey);

const published = await responseJson(
  await fetch(`${baseUrl}/api/episodes/${episode.guid}/publish`, {
    method: 'POST',
  }),
);
assert.equal(published.status, 'published');

const mediaUrl = `${baseUrl}${uploaded.mediaPath}`;
const head = await fetch(mediaUrl, { method: 'HEAD' });
assert.equal(head.status, 200);
assert.equal(head.headers.get('content-type'), 'audio/mpeg');
assert.equal(head.headers.get('content-length'), String(audioBytes.byteLength));

const range = await fetch(mediaUrl, { headers: { range: 'bytes=0-2' } });
assert.equal(range.status, 206);
assert.equal(Buffer.from(await range.arrayBuffer()).toString(), 'ID3');
const invalidRange = await fetch(mediaUrl, {
  headers: { range: 'bytes=999-1000' },
});
assert.equal(invalidRange.status, 416);
assert.equal((await fetch(`${baseUrl}/media/audio/ausente.mp3`)).status, 404);

console.log('Fluxo HTTP de áudio final passou.');
