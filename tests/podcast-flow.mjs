import assert from 'node:assert/strict';

const baseUrl = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
const authCookie = process.env.TEST_AUTH_COOKIE;
const csrfToken = process.env.TEST_CSRF_TOKEN;
const authHeaders = (cookie = authCookie, token = csrfToken) =>
  cookie && token ? { cookie, 'x-csrf-token': token } : {};

// TEST_BASE_URL: servidor HTTP do teste (padrão http://localhost:3000).
// TEST_AUTH_COOKIE e TEST_CSRF_TOKEN: sessão válida para o fluxo completo.
// TEST_AUTH_COOKIE_A/B e TEST_CSRF_TOKEN_A/B: duas sessões válidas, cada uma
// ligada a um canal distinto, para o cenário opcional de isolamento.
// TEST_CROSS_PROGRAM_ID, TEST_CROSS_PROGRAM_SLUG e TEST_CROSS_EPISODE_GUID:
// fixture pertencente à sessão A usado nas tentativas da sessão B.

async function expectStatus(label, response, expected) {
  assert.equal(
    response.status,
    expected,
    `${label}: esperado ${expected}, recebido ${response.status}`,
  );
}

async function assertAnonymousProtection() {
  const protectedRoutes = /** @type {Array<[string, string, RequestInit]>} */ ([
    ['program POST', '/api/programs', { method: 'POST' }],
    ['program GET', '/api/programs?slug=visitante', {}],
    [
      'program PATCH',
      '/api/programs/fixture',
      { method: 'PATCH', headers: { 'content-type': 'multipart/form-data' } },
    ],
    ['episode POST', '/api/episodes', { method: 'POST' }],
    ['episode GET', '/api/episodes/fixture', {}],
    [
      'episode PATCH',
      '/api/episodes/fixture',
      { method: 'PATCH', headers: { 'content-type': 'application/json' } },
    ],
    ['upload POST', '/api/episodes/fixture/audio', { method: 'POST' }],
    [
      'source verify POST',
      '/api/youtube/verify',
      { method: 'POST', headers: { 'content-type': 'application/json' } },
    ],
    ['publish POST', '/api/episodes/fixture/publish', { method: 'POST' }],
    ['schedule POST', '/api/episodes/fixture/schedule', { method: 'POST' }],
    ['schedule DELETE', '/api/episodes/fixture/schedule', { method: 'DELETE' }],
  ]);
  for (const [label, path, init] of protectedRoutes)
    await expectStatus(
      `visitante ${label}`,
      await fetch(`${baseUrl}${path}`, init),
      401,
    );
}

await assertAnonymousProtection();

if (!authCookie || !csrfToken) {
  console.log('Guardas HTTP anônimas passaram; sessão não configurada.');
} else {
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
      headers: { 'content-type': 'application/json', ...authHeaders() },
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
    headers: authHeaders(),
    body: programForm,
  }),
);

const privateProgram = await responseJson(
  await fetch(`${baseUrl}/api/programs?slug=${encodeURIComponent(slug)}`, {
    headers: authHeaders(),
  }),
);
assert.equal(privateProgram.id, program.id);

const missingAudio = await createEpisode(program.id, 'sem-audio');
await fetch(`${baseUrl}/api/episodes/${missingAudio.guid}`, {
  method: 'PATCH',
  headers: { 'content-type': 'application/json', ...authHeaders() },
  body: JSON.stringify({
    publishAt: new Date(Date.now() + 60_000).toISOString(),
  }),
});
const missingSchedule = await fetch(
  `${baseUrl}/api/episodes/${missingAudio.guid}/schedule`,
  { method: 'POST', headers: authHeaders() },
);
assert.equal(missingSchedule.status, 422);

const episode = await createEpisode(program.id, 'real');
const invalidUpload = await fetch(
  `${baseUrl}/api/episodes/${episode.guid}/audio`,
  {
    method: 'POST',
    headers: {
      ...authHeaders(),
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
      ...authHeaders(),
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
  await fetch(`${baseUrl}/api/episodes/${episode.guid}`, {
    headers: authHeaders(),
  }),
);
assert.equal(persisted.duration, 321);
assert.equal(persisted.audioKey, uploaded.audioKey);

const published = await responseJson(
  await fetch(`${baseUrl}/api/episodes/${episode.guid}/publish`, {
    method: 'POST',
    headers: authHeaders(),
  }),
);
assert.equal(published.status, 'published');

const feedResponse = await fetch(`${baseUrl}/feed/${program.slug}`);
assert.equal(feedResponse.status, 200);
assert.match(await feedResponse.text(), new RegExp(episode.title));

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
}

const cookieA = process.env.TEST_AUTH_COOKIE_A;
const csrfA = process.env.TEST_CSRF_TOKEN_A;
const cookieB = process.env.TEST_AUTH_COOKIE_B;
const csrfB = process.env.TEST_CSRF_TOKEN_B;
const crossProgramId = process.env.TEST_CROSS_PROGRAM_ID;
const crossProgramSlug = process.env.TEST_CROSS_PROGRAM_SLUG;
const crossEpisodeGuid = process.env.TEST_CROSS_EPISODE_GUID;

if (authCookie) {
  await expectStatus(
    'sessão sem CSRF',
    await fetch(`${baseUrl}/api/programs`, {
      method: 'POST',
      headers: { cookie: authCookie },
    }),
    403,
  );
}

if (
  cookieA &&
  csrfA &&
  cookieB &&
  csrfB &&
  crossProgramId &&
  crossProgramSlug &&
  crossEpisodeGuid
) {
  const headersA = authHeaders(cookieA, csrfA);
  const headersB = authHeaders(cookieB, csrfB);
  await expectStatus(
    'sessão A lê programa fixture',
    await fetch(
      `${baseUrl}/api/programs?slug=${encodeURIComponent(crossProgramSlug)}`,
      { headers: headersA },
    ),
    200,
  );
  await expectStatus(
    'sessão A lê episódio fixture',
    await fetch(`${baseUrl}/api/episodes/${crossEpisodeGuid}`, {
      headers: headersA,
    }),
    200,
  );
  const crossRoutes = /** @type {Array<[string, string, RequestInit]>} */ ([
    [
      'program GET',
      `/api/programs?slug=${encodeURIComponent(crossProgramSlug)}`,
      {},
    ],
    [
      'episode POST',
      '/api/episodes',
      {
        method: 'POST',
        headers: { ...headersB, 'content-type': 'application/json' },
        body: JSON.stringify({
          programId: crossProgramId,
          sourceUrl: 'https://www.youtube.com/watch?v=fixture',
          title: 'Tentativa cruzada',
          description: 'Tentativa cruzada sem autorização do proprietário.',
          kind: 'full',
          mimeType: 'audio/mpeg',
          sizeBytes: 128,
          duration: 120,
        }),
      },
    ],
    ['episode GET', `/api/episodes/${crossEpisodeGuid}`, {}],
    [
      'episode PATCH',
      `/api/episodes/${crossEpisodeGuid}`,
      {
        method: 'PATCH',
        headers: { ...headersB, 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Tentativa cruzada' }),
      },
    ],
    [
      'upload POST',
      `/api/episodes/${crossEpisodeGuid}/audio`,
      { method: 'POST' },
    ],
    [
      'source verify POST',
      '/api/youtube/verify',
      {
        method: 'POST',
        headers: { ...headersB, 'content-type': 'application/json' },
        body: JSON.stringify({
          programId: crossProgramId,
          sourceUrl: 'https://www.youtube.com/watch?v=fixture',
        }),
      },
    ],
    [
      'publish POST',
      `/api/episodes/${crossEpisodeGuid}/publish`,
      { method: 'POST' },
    ],
    [
      'schedule POST',
      `/api/episodes/${crossEpisodeGuid}/schedule`,
      { method: 'POST' },
    ],
    [
      'schedule DELETE',
      `/api/episodes/${crossEpisodeGuid}/schedule`,
      { method: 'DELETE' },
    ],
  ]);
  for (const [label, path, init] of crossRoutes) {
    const headers = new Headers(init.headers);
    for (const [name, value] of Object.entries(headersB))
      headers.set(name, value);
    const requestInit = {
      ...init,
      headers,
    };
    await expectStatus(
      `sessão B não acessa ${label}`,
      await fetch(`${baseUrl}${path}`, requestInit),
      404,
    );
  }
  console.log('Isolamento HTTP entre duas sessões passou.');
}
