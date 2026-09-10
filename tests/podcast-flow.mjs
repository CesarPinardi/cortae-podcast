import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER_ENTRY = resolve(
  REPO_ROOT,
  'node_modules/wrangler/bin/wrangler.js',
);
const CONFIG_PATH = resolve(REPO_ROOT, 'dist/server/wrangler.json');
const VIDEO_A = 'jrLKTOvlYuE';
const VIDEO_B = 'AbCdEf12345';
const AUDIO_BYTES = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(125, 1)]);
const COVER_BYTES = (() => {
  const bytes = new Uint8Array(26);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set(new TextEncoder().encode('IHDR'), 12);
  view.setUint32(16, 1400);
  view.setUint32(20, 1400);
  bytes[24] = 8;
  bytes[25] = 2;
  return bytes;
})();

const identities = [
  {
    key: 'a',
    sub: 'google-test-a',
    email: 'owner-a@example.com',
    displayName: 'Owner A',
    accessToken: 'access-token-a',
    refreshToken: 'refresh-token-a',
    channelId: 'channel-a',
    channelTitle: 'Canal A',
  },
  {
    key: 'b',
    sub: 'google-test-b',
    email: 'owner-b@example.com',
    displayName: 'Owner B',
    accessToken: 'access-token-b',
    refreshToken: 'refresh-token-b',
    channelId: 'channel-b',
    channelTitle: 'Canal B',
  },
];

const videos = new Map([
  [VIDEO_A, { channelId: 'channel-a', title: 'Fixture A' }],
  [VIDEO_B, { channelId: 'channel-b', title: 'Fixture B' }],
]);

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader('content-type', 'application/json');
  response.setHeader('content-length', Buffer.byteLength(payload));
  response.end(payload);
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

function listen(server, port = 0) {
  return new Promise((resolvePort, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Não foi possível descobrir a porta local.'));
        return;
      }
      resolvePort(address.port);
    });
  });
}

async function closeServer(server) {
  if (!server.listening) return;
  server.closeAllConnections?.();
  await new Promise((resolveClose, reject) => {
    server.close((error) => {
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
      else resolveClose();
    });
  });
}

function runProcess(command, args, options) {
  return new Promise((resolveProcess, reject) => {
    const child = spawn(command, args, options);
    let output = '';
    for (const stream of [child.stdout, child.stderr])
      stream?.on('data', (chunk) => {
        output = `${output}${chunk}`.slice(-20_000);
      });
    child.once('error', reject);
    child.once('close', (code, signal) =>
      resolveProcess({ code, signal, output }),
    );
  });
}

function startWorker(args, options) {
  const child = spawn(process.execPath, [WRANGLER_ENTRY, ...args], options);
  let output = '';
  for (const stream of [child.stdout, child.stderr])
    stream?.on('data', (chunk) => {
      output = `${output}${chunk}`.slice(-20_000);
    });
  return { child, output: () => output };
}

async function waitForWorker(baseUrl, worker) {
  const deadline = Date.now() + 30_000;
  let lastError = 'sem resposta';
  while (Date.now() < deadline) {
    if (worker.child.exitCode !== null)
      throw new Error(
        `Worker encerrou durante inicialização (${worker.child.exitCode}).\n${worker.output()}`,
      );
    try {
      const response = await fetch(`${baseUrl}/api/auth/session`);
      if (response.status === 200) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Worker não iniciou: ${lastError}.\n${worker.output()}`);
}

function videoUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function formForProgram(slug, title) {
  const form = new FormData();
  form.set('title', title);
  form.set('description', 'Programa usado pelo smoke test do Cortaê.');
  form.set('author', 'Cortaê');
  form.set('language', 'pt-BR');
  form.set('category', 'Tecnologia');
  form.set('email', 'teste@example.com');
  form.set('explicit', 'false');
  form.set('slug', slug);
  form.set('cover', new File([COVER_BYTES], 'cover.png', { type: 'image/png' }));
  return form;
}

async function expectStatus(label, response, expected) {
  const body = await response.clone().text();
  assert.equal(
    response.status,
    expected,
    `${label}: esperado ${expected}, recebido ${response.status}; ${body}`,
  );
}

async function readJson(response, label) {
  const body = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`${label}: resposta não é JSON: ${body}`);
  }
  assert.equal(
    response.ok,
    true,
    `${label}: HTTP ${response.status}: ${JSON.stringify(parsed)}`,
  );
  return parsed;
}

function createClient(baseUrl) {
  const cookies = new Map();
  let csrfToken = '';

  function storeCookies(response) {
    for (const value of response.headers.getSetCookie()) {
      const separator = value.indexOf('=');
      if (separator < 0) continue;
      const name = value.slice(0, separator);
      const cookieValue = value.slice(separator + 1).split(';', 1)[0];
      if (cookieValue) cookies.set(name, cookieValue);
      else cookies.delete(name);
    }
  }

  async function request(path, init = {}, csrf = false) {
    const headers = new Headers(init.headers);
    const cookie = [...cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
    if (cookie) headers.set('cookie', cookie);
    if (csrf) {
      assert.ok(csrfToken, 'cliente autenticado sem token CSRF');
      headers.set('x-csrf-token', csrfToken);
    }
    const url = path.startsWith('http') ? path : `${baseUrl}${path}`;
    const response = await fetch(url, {
      ...init,
      headers,
      redirect: 'manual',
    });
    storeCookies(response);
    return response;
  }

  async function login() {
    const authorizationStart = await request('/api/auth/google');
    await expectStatus('início OAuth', authorizationStart, 302);
    const authorizationUrl = authorizationStart.headers.get('location');
    assert.ok(authorizationUrl, 'OAuth não retornou URL de autorização');
    const providerAuthorization = await fetch(authorizationUrl, {
      redirect: 'manual',
    });
    await expectStatus(
      'autorização Google simulada',
      providerAuthorization,
      302,
    );
    const callbackUrl = providerAuthorization.headers.get('location');
    assert.ok(callbackUrl, 'Google simulado não retornou callback');
    const callback = await request(callbackUrl);
    await expectStatus('callback OAuth', callback, 303);
    const session = await readJson(
      await request('/api/auth/session'),
      'sessão autenticada',
    );
    assert.equal(session.authenticated, true);
    assert.ok(session.channel, 'sessão não selecionou canal único');
    assert.ok(session.csrfToken, 'sessão não retornou token CSRF');
    csrfToken = session.csrfToken;
    return session;
  }

  return { login, request };
}

async function createProgram(client, slug, title) {
  return readJson(
    await client.request(
      '/api/programs',
      { method: 'POST', body: formForProgram(slug, title) },
      true,
    ),
    `criação do programa ${slug}`,
  );
}

async function verifySource(client, programId, videoId) {
  return readJson(
    await client.request(
      '/api/youtube/verify',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ programId, sourceUrl: videoUrl(videoId) }),
      },
      true,
    ),
    `verificação do vídeo ${videoId}`,
  );
}

async function createEpisode(client, programId, videoId, suffix, verificationId) {
  const body = {
    programId,
    sourceUrl: videoUrl(videoId),
    title: `Episódio ${suffix}`,
    description: 'Episódio usado pelo smoke test do fluxo autenticado.',
    kind: 'full',
    audioName: `${suffix}.mp3`,
    mimeType: 'audio/mpeg',
    sizeBytes: AUDIO_BYTES.byteLength,
    duration: 120,
  };
  if (verificationId) body.verificationId = verificationId;
  return readJson(
    await client.request(
      '/api/episodes',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      true,
    ),
    `criação do episódio ${suffix}`,
  );
}

async function anonymousFlow(client) {
  const session = await readJson(
    await client.request('/api/auth/session'),
    'sessão anônima',
  );
  assert.equal(session.authenticated, false);
  const protectedRoutes = /** @type {Array<[string, string, RequestInit]>} */ ([
    ['program POST', '/api/programs', { method: 'POST' }],
    ['program GET', '/api/programs?slug=visitante', {}],
    [
      'program PATCH',
      '/api/programs/not-owned',
      { method: 'PATCH', headers: { 'content-type': 'multipart/form-data' } },
    ],
    ['episode POST', '/api/episodes', { method: 'POST' }],
    ['episode GET', '/api/episodes/not-owned', {}],
    [
      'episode PATCH',
      '/api/episodes/not-owned',
      { method: 'PATCH', headers: { 'content-type': 'application/json' } },
    ],
    ['upload POST', '/api/episodes/not-owned/audio', { method: 'POST' }],
    [
      'source verify POST',
      '/api/youtube/verify',
      { method: 'POST', headers: { 'content-type': 'application/json' } },
    ],
    ['publish POST', '/api/episodes/not-owned/publish', { method: 'POST' }],
    ['schedule POST', '/api/episodes/not-owned/schedule', { method: 'POST' }],
    [
      'schedule DELETE',
      '/api/episodes/not-owned/schedule',
      { method: 'DELETE' },
    ],
  ]);
  for (const [label, path, init] of protectedRoutes)
    await expectStatus(
      `visitante ${label}`,
      await client.request(path, init),
      401,
    );
  console.log('Fluxo anônimo passou.');
}

async function runFlow(mockBaseUrl, tempDir) {
  const environmentFile = join(tempDir, 'worker.env');
  const workerPortProbe = createServer();
  const workerPort = await listen(workerPortProbe);
  await closeServer(workerPortProbe);
  const workerBaseUrl = `http://127.0.0.1:${workerPort}`;
  const encryptionKey = Buffer.alloc(32).toString('base64url');
  await writeFile(
    environmentFile,
    [
      `APP_ORIGIN=${workerBaseUrl}`,
      'GOOGLE_CLIENT_ID=integration-client',
      'GOOGLE_CLIENT_SECRET=integration-secret',
      `AUTH_ENCRYPTION_KEY=${encryptionKey}`,
      `GOOGLE_AUTH_URL=${mockBaseUrl}/authorize`,
      `GOOGLE_TOKEN_URL=${mockBaseUrl}/token`,
      `GOOGLE_JWKS_URL=${mockBaseUrl}/jwks`,
      `GOOGLE_REVOKE_URL=${mockBaseUrl}/revoke`,
      `YOUTUBE_API_BASE_URL=${mockBaseUrl}/youtube/v3`,
    ].join('\n'),
  );

  const toolEnvironment = {
    ...process.env,
    CI: '1',
    MINIFLARE_REGISTRY_PATH: join(tempDir, 'registry'),
    WRANGLER_LOG_PATH: join(tempDir, 'logs'),
    WRANGLER_WRITE_LOGS: 'false',
  };
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const build = await runProcess(npmCommand, ['run', 'build'], {
    cwd: REPO_ROOT,
    env: toolEnvironment,
    stdio: 'inherit',
  });
  assert.equal(build.code, 0, `build falhou: ${build.output}`);
  await readFile(CONFIG_PATH);

  const migration = await runProcess(
    process.execPath,
    [
      WRANGLER_ENTRY,
      'd1',
      'migrations',
      'apply',
      'DB',
      '--local',
      '--persist-to',
      tempDir,
      '--config',
      CONFIG_PATH,
    ],
    { cwd: REPO_ROOT, env: toolEnvironment, stdio: 'inherit' },
  );
  assert.equal(migration.code, 0, `migrações D1 falharam: ${migration.output}`);

  const worker = startWorker(
    [
      'dev',
      '--local',
      '--config',
      CONFIG_PATH,
      '--persist-to',
      tempDir,
      '--ip',
      '127.0.0.1',
      '--port',
      String(workerPort),
      '--env-file',
      environmentFile,
      '--show-interactive-dev-session=false',
      '--log-level',
      'error',
    ],
    { cwd: REPO_ROOT, env: toolEnvironment, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  try {
    await waitForWorker(workerBaseUrl, worker);
    const visitor = createClient(workerBaseUrl);
    await anonymousFlow(visitor);

    const clientA = createClient(workerBaseUrl);
    const sessionA = await clientA.login();
    assert.equal(sessionA.user.email, 'owner-a@example.com');
    assert.equal(sessionA.channel.channelId, 'channel-a');
    const slugA = `smoke-a-${Date.now()}`;
    const programA = await createProgram(clientA, slugA, 'Programa A');
    assert.equal(programA.slug, slugA);

    await expectStatus(
      'leitura privada do programa A',
      await clientA.request(`/api/programs?slug=${encodeURIComponent(slugA)}`),
      200,
    );
    await expectStatus(
      'PATCH de programa A',
      await clientA.request(
        `/api/programs/${programA.id}`,
        { method: 'PATCH', body: formForProgram(slugA, 'Programa A editado') },
        true,
      ),
      200,
    );

    const verificationA = await verifySource(clientA, programA.id, VIDEO_A);
    assert.equal(verificationA.videoId, VIDEO_A);
    assert.equal(verificationA.channelId, 'channel-a');
    const episode = await createEpisode(
      clientA,
      programA.id,
      VIDEO_A,
      'real',
      verificationA.verificationId,
    );
    const missingAudio = await createEpisode(
      clientA,
      programA.id,
      VIDEO_A,
      'sem-audio',
    );
    await expectStatus(
      'agendamento sem áudio',
      await clientA.request(
        `/api/episodes/${missingAudio.guid}/schedule`,
        { method: 'POST' },
        true,
      ),
      422,
    );

    await expectStatus(
      'upload inválido',
      await clientA.request(
        `/api/episodes/${episode.guid}/audio`,
        {
          method: 'POST',
          headers: {
            'content-type': 'audio/mpeg',
            'x-audio-duration-seconds': '321',
          },
          body: 'isto não é áudio',
        },
        true,
      ),
      415,
    );
    const uploaded = await readJson(
      await clientA.request(
        `/api/episodes/${episode.guid}/audio`,
        {
          method: 'POST',
          headers: {
            'content-type': 'audio/mpeg',
            'x-audio-duration-seconds': '321',
          },
          body: AUDIO_BYTES,
        },
        true,
      ),
      'upload válido',
    );
    assert.equal(uploaded.sizeBytes, AUDIO_BYTES.byteLength);
    assert.equal(uploaded.mimeType, 'audio/mpeg');
    assert.equal(uploaded.duration, 321);

    const persisted = await readJson(
      await clientA.request(`/api/episodes/${episode.guid}`),
      'episódio persistido',
    );
    assert.equal(persisted.status, 'ready');
    assert.equal(persisted.audioKey, uploaded.audioKey);
    await expectStatus(
      'PATCH de episódio A',
      await clientA.request(
        `/api/episodes/${episode.guid}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: 'Episódio A editado',
            description: 'Descrição atualizada do episódio A no smoke test.',
            status: 'ready',
          }),
        },
        true,
      ),
      200,
    );
    const publishAt = new Date(Date.now() + 120_000).toISOString();
    await expectStatus(
      'preparação de agendamento A',
      await clientA.request(
        `/api/episodes/${episode.guid}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ publishAt, status: 'ready' }),
        },
        true,
      ),
      200,
    );
    const scheduled = await readJson(
      await clientA.request(
        `/api/episodes/${episode.guid}/schedule`,
        { method: 'POST' },
        true,
      ),
      'agendamento A',
    );
    assert.equal(scheduled.status, 'scheduled');
    const unscheduled = await readJson(
      await clientA.request(
        `/api/episodes/${episode.guid}/schedule`,
        { method: 'DELETE' },
        true,
      ),
      'cancelamento de agendamento A',
    );
    assert.equal(unscheduled.status, 'draft');
    const published = await readJson(
      await clientA.request(
        `/api/episodes/${episode.guid}/publish`,
        { method: 'POST' },
        true,
      ),
      'publicação A',
    );
    assert.equal(published.status, 'published');

    await expectStatus(
      'mutação autenticada sem CSRF',
      await clientA.request('/api/programs', { method: 'POST' }),
      403,
    );
    const feed = await visitor.request(`/feed/${programA.slug}`);
    await expectStatus('feed público anônimo', feed, 200);
    assert.match(await feed.text(), /Episódio A editado/);
    const mediaUrl = `${workerBaseUrl}${uploaded.mediaPath}`;
    await expectStatus(
      'HEAD da mídia publicada',
      await visitor.request(mediaUrl, { method: 'HEAD' }),
      200,
    );
    const range = await visitor.request(mediaUrl, {
      headers: { range: 'bytes=0-2' },
    });
    await expectStatus('range da mídia publicada', range, 206);
    assert.equal(Buffer.from(await range.arrayBuffer()).toString(), 'ID3');
    await expectStatus(
      'range inválido da mídia',
      await visitor.request(mediaUrl, { headers: { range: 'bytes=999-1000' } }),
      416,
    );
    await expectStatus(
      'mídia ausente',
      await visitor.request(`${workerBaseUrl}/media/audio/ausente.mp3`),
      404,
    );
    console.log('Fluxo autenticado A e feed público passaram.');

    const clientB = createClient(workerBaseUrl);
    const sessionB = await clientB.login();
    assert.equal(sessionB.user.email, 'owner-b@example.com');
    assert.equal(sessionB.channel.channelId, 'channel-b');
    const slugB = `smoke-b-${Date.now()}`;
    const programB = await createProgram(clientB, slugB, 'Programa B');
    const verificationB = await verifySource(clientB, programB.id, VIDEO_B);
    assert.equal(verificationB.channelId, 'channel-b');

    await expectStatus(
      'sessão B rejeita vídeo do canal A',
      await clientB.request(
        '/api/youtube/verify',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            programId: programB.id,
            sourceUrl: videoUrl(VIDEO_A),
          }),
        },
        true,
      ),
      403,
    );

    const crossProgramForm = formForProgram(slugA, 'Tentativa cruzada');
    const crossRoutes = /** @type {Array<[string, string, RequestInit, boolean]>} */ ([
      [
        'program GET',
        `/api/programs?slug=${encodeURIComponent(slugA)}`,
        {},
        false,
      ],
      [
        'program PATCH',
        `/api/programs/${programA.id}`,
        { method: 'PATCH', body: crossProgramForm },
        true,
      ],
      [
        'episode POST',
        '/api/episodes',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            programId: programA.id,
            sourceUrl: videoUrl(VIDEO_A),
            title: 'Tentativa cruzada',
            description: 'Tentativa cruzada sem autorização do proprietário.',
            kind: 'full',
            mimeType: 'audio/mpeg',
            sizeBytes: AUDIO_BYTES.byteLength,
            duration: 120,
          }),
        },
        true,
      ],
      ['episode GET', `/api/episodes/${episode.guid}`, {}, false],
      [
        'episode PATCH',
        `/api/episodes/${episode.guid}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Tentativa cruzada' }),
        },
        true,
      ],
      [
        'upload POST',
        `/api/episodes/${episode.guid}/audio`,
        {
          method: 'POST',
          headers: {
            'content-type': 'audio/mpeg',
            'x-audio-duration-seconds': '321',
          },
          body: AUDIO_BYTES,
        },
        true,
      ],
      [
        'source verify POST',
        '/api/youtube/verify',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            programId: programA.id,
            sourceUrl: videoUrl(VIDEO_A),
          }),
        },
        true,
      ],
      [
        'publish POST',
        `/api/episodes/${episode.guid}/publish`,
        { method: 'POST' },
        true,
      ],
      [
        'schedule POST',
        `/api/episodes/${episode.guid}/schedule`,
        { method: 'POST' },
        true,
      ],
      [
        'schedule DELETE',
        `/api/episodes/${episode.guid}/schedule`,
        { method: 'DELETE' },
        true,
      ],
    ]);
    for (const [label, path, init, csrf] of crossRoutes)
      await expectStatus(
        `sessão B não acessa ${label}`,
        await clientB.request(path, init, csrf),
        404,
      );
    console.log('Isolamento A/B passou, incluindo PATCH de programa.');
  } finally {
    if (worker.child.exitCode === null) worker.child.kill('SIGTERM');
    await new Promise((resolveExit) => {
      if (worker.child.exitCode !== null) resolveExit();
      else worker.child.once('close', resolveExit);
    });
    assert.equal(worker.child.exitCode, 0, `Worker falhou:\n${worker.output()}`);
  }
}

async function main() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);
  Object.assign(publicJwk, { alg: 'RS256', kid: 'integration-key', use: 'sig' });
  const transactions = new Map();
  const mockErrors = [];
  let authorizationCount = 0;
  let tokenRequests = 0;
  let youtubeRequests = 0;

  const mockServer = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://mock.local');
      if (url.pathname === '/authorize') {
        const identity = identities[authorizationCount];
        authorizationCount += 1;
        const state = url.searchParams.get('state');
        const nonce = url.searchParams.get('nonce');
        const challenge = url.searchParams.get('code_challenge');
        const redirectUri = url.searchParams.get('redirect_uri');
        if (!identity || !state || !nonce || !challenge || !redirectUri) {
          sendJson(response, 400, { error: 'invalid_authorization_request' });
          return;
        }
        const code = `code-${identity.key}`;
        transactions.set(code, { identity, challenge, nonce, redirectUri });
        response.statusCode = 302;
        response.setHeader(
          'location',
          `${redirectUri}?code=${code}&state=${encodeURIComponent(state)}`,
        );
        response.end();
        return;
      }
      if (url.pathname === '/token' && request.method === 'POST') {
        tokenRequests += 1;
        const body = new URLSearchParams(await requestBody(request));
        const transaction = transactions.get(body.get('code'));
        const verifier = body.get('code_verifier') ?? '';
        const challenge = createHash('sha256')
          .update(verifier)
          .digest('base64url');
        if (!transaction || challenge !== transaction.challenge) {
          sendJson(response, 400, { error: 'invalid_grant' });
          return;
        }
        const idToken = await new SignJWT({
          email: transaction.identity.email,
          name: transaction.identity.displayName,
          nonce: transaction.nonce,
        })
          .setProtectedHeader({ alg: 'RS256', kid: 'integration-key' })
          .setIssuer('https://accounts.google.com')
          .setAudience('integration-client')
          .setSubject(transaction.identity.sub)
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(privateKey);
        sendJson(response, 200, {
          access_token: transaction.identity.accessToken,
          refresh_token: transaction.identity.refreshToken,
          expires_in: 3600,
          id_token: idToken,
        });
        return;
      }
      if (url.pathname === '/jwks') {
        sendJson(response, 200, { keys: [publicJwk] });
        return;
      }
      if (url.pathname === '/revoke') {
        await requestBody(request);
        response.statusCode = 200;
        response.end();
        return;
      }
      if (url.pathname.startsWith('/youtube/v3/')) {
        youtubeRequests += 1;
        const token = (request.headers.authorization ?? '').replace(
          /^Bearer\s+/i,
          '',
        );
        const identity = identities.find(
          (candidate) => candidate.accessToken === token,
        );
        if (!identity) {
          sendJson(response, 401, { error: { status: 'UNAUTHENTICATED' } });
          return;
        }
        if (url.pathname.endsWith('/channels')) {
          sendJson(response, 200, {
            items: [
              {
                id: identity.channelId,
                snippet: { title: identity.channelTitle },
              },
            ],
          });
          return;
        }
        if (url.pathname.endsWith('/videos')) {
          const videoId = url.searchParams.get('id');
          const video = videoId ? videos.get(videoId) : null;
          if (!video) {
            sendJson(response, 404, { error: { status: 'NOT_FOUND' } });
            return;
          }
          sendJson(response, 200, {
            items: [
              {
                id: videoId,
                snippet: { channelId: video.channelId, title: video.title },
              },
            ],
          });
          return;
        }
      }
      sendJson(response, 404, { error: 'not_found' });
    })().catch((error) => {
      mockErrors.push(error instanceof Error ? error.message : String(error));
      if (!response.headersSent) sendJson(response, 500, { error: 'mock_failure' });
      else response.destroy();
    });
  });

  const mockPort = await listen(mockServer);
  const mockBaseUrl = `http://127.0.0.1:${mockPort}`;
  const tempDir = await mkdtemp(join(tmpdir(), 'cortae-podcast-flow-'));
  try {
    await runFlow(mockBaseUrl, tempDir);
    assert.equal(authorizationCount, 2, 'OAuth não criou exatamente duas sessões');
    assert.equal(tokenRequests, 2, 'OAuth não trocou exatamente dois códigos');
    assert.ok(youtubeRequests >= 10, 'smoke test não exercitou YouTube suficiente');
    assert.deepEqual(mockErrors, [], `mock externo falhou: ${mockErrors.join('; ')}`);
    console.log('Smoke test Worker/D1/R2 + Google/YouTube passou.');
  } finally {
    await closeServer(mockServer);
    await rm(tempDir, { recursive: true, force: true });
  }
}

await main();
