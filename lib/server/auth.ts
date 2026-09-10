import { env } from 'cloudflare:workers';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { error, json } from '@/lib/server/http';
import {
  listMyChannels,
  refreshAccessToken,
  type YouTubeClientOptions,
  YouTubeApiError,
} from '@/lib/server/youtube';

export const SESSION_COOKIE = '__Host-cortae_session';
export const CSRF_COOKIE = '__Host-cortae_csrf';
const SESSION_DAYS = 30;
const OAUTH_STATE_MINUTES = 10;
const CONNECTION_GRACE_MS = 60_000;

type OAuthStateRow = {
  state_hash: string;
  code_verifier_ciphertext: string;
  nonce: string;
  expires_at: string;
};

export type YoutubeConnection = {
  id: string;
  userId: string;
  channelId: string;
  channelTitle: string;
  accessTokenCiphertext: string;
  refreshTokenCiphertext: string | null;
  accessTokenExpiresAt: string;
  revokedAt: string | null;
};

type SessionRow = {
  id_hash: string;
  user_id: string;
  google_sub: string;
  email: string | null;
  display_name: string | null;
  csrf_hash: string;
  expires_at: string;
  revoked_at: string | null;
  active_connection_id: string | null;
  connection_id: string | null;
  channel_id: string | null;
  channel_title: string | null;
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
  access_token_expires_at: string | null;
  connection_revoked_at: string | null;
};

export type AuthContext = {
  sessionHash: string;
  userId: string;
  googleSub: string;
  email: string | null;
  displayName: string | null;
  csrfHash: string;
  connection: YoutubeConnection | null;
};

export type AuthResult =
  | { context: AuthContext; response?: never }
  | { context?: never; response: Response };

export class AuthProviderError extends Error {
  readonly kind: 'temporary' | 'invalid' | 'revoked';

  constructor(kind: 'temporary' | 'invalid' | 'revoked', message: string) {
    super(message);
    this.kind = kind;
    this.name = 'AuthProviderError';
  }
}

function base64Url(bytes: Uint8Array) {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64Url(value);
}

async function hash(value: string) {
  return base64Url(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
  );
}

function constantTimeEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let result = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1)
    result |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return result === 0;
}

async function encryptionKey() {
  const encoded = env.AUTH_ENCRYPTION_KEY?.trim();
  if (!encoded)
    throw new AuthProviderError(
      'temporary',
      'Chave de criptografia não configurada.',
    );
  let raw: Uint8Array;
  try {
    raw = fromBase64Url(encoded);
  } catch {
    throw new AuthProviderError('temporary', 'Chave de criptografia inválida.');
  }
  if (raw.byteLength !== 32)
    throw new AuthProviderError('temporary', 'Chave de criptografia inválida.');
  const buffer = new ArrayBuffer(raw.byteLength);
  new Uint8Array(buffer).set(raw);
  return crypto.subtle.importKey('raw', buffer, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptSecret(value: string) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await encryptionKey(),
      new TextEncoder().encode(value),
    ),
  );
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv);
  combined.set(ciphertext, iv.length);
  return base64Url(combined);
}

export async function decryptSecret(value: string) {
  let combined: Uint8Array;
  try {
    combined = fromBase64Url(value);
  } catch {
    throw new AuthProviderError('temporary', 'Credencial armazenada inválida.');
  }
  if (combined.length <= 12)
    throw new AuthProviderError('temporary', 'Credencial armazenada inválida.');
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: combined.slice(0, 12) },
      await encryptionKey(),
      combined.slice(12),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new AuthProviderError('temporary', 'Credencial armazenada inválida.');
  }
}

export function getCookie(request: Request, name: string) {
  const header = request.headers.get('cookie') ?? '';
  for (const item of header.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name)
      return item.slice(separator + 1).trim();
  }
  return null;
}

function cookie(name: string, value: string, maxAge: number) {
  return `${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function csrfCookie(value: string, maxAge: number) {
  return `${CSRF_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; Secure; SameSite=Lax`;
}

export function clearAuthCookies() {
  const headers = new Headers();
  headers.append('set-cookie', cookie(SESSION_COOKIE, '', 0));
  headers.append('set-cookie', csrfCookie('', 0));
  return headers;
}

export function trustedOrigin(request: Request) {
  const configured = env.APP_ORIGIN?.trim();
  const origin = configured || new URL(request.url).origin;
  const url = new URL(origin);
  if (
    url.protocol !== 'https:' &&
    !['localhost', '127.0.0.1'].includes(url.hostname)
  )
    throw new AuthProviderError('temporary', 'APP_ORIGIN precisa usar HTTPS.');
  return url.origin;
}

function redirectUri(request: Request) {
  return new URL('/api/auth/callback', `${trustedOrigin(request)}/`).toString();
}

export function youtubeClientOptions(): YouTubeClientOptions {
  return {
    apiBaseUrl: env.YOUTUBE_API_BASE_URL,
    tokenEndpoint: env.GOOGLE_TOKEN_URL,
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  };
}

function requiredOAuthConfig() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)
    throw new AuthProviderError(
      'temporary',
      'Credenciais Google não configuradas.',
    );
  return youtubeClientOptions();
}

function jsonAuthError(message: string, status: number) {
  const response = error(message, status);
  response.headers.set('cache-control', 'no-store');
  return response;
}

function connectionFromRow(row: SessionRow): YoutubeConnection | null {
  if (
    !row.connection_id ||
    !row.channel_id ||
    !row.channel_title ||
    !row.access_token_ciphertext ||
    !row.access_token_expires_at
  )
    return null;
  return {
    id: row.connection_id,
    userId: row.user_id,
    channelId: row.channel_id,
    channelTitle: row.channel_title,
    accessTokenCiphertext: row.access_token_ciphertext,
    refreshTokenCiphertext: row.refresh_token_ciphertext,
    accessTokenExpiresAt: row.access_token_expires_at,
    revokedAt: row.connection_revoked_at,
  };
}

async function sessionRow(request: Request) {
  const raw = getCookie(request, SESSION_COOKIE);
  if (!raw) return null;
  const sessionHash = await hash(raw);
  const row = await env.DB.prepare(
    `SELECT s.id_hash, s.user_id, s.active_connection_id, s.csrf_hash, s.expires_at, s.revoked_at,
       u.google_sub, u.email, u.display_name,
       c.id AS connection_id, c.channel_id, c.channel_title, c.access_token_ciphertext,
       c.refresh_token_ciphertext, c.access_token_expires_at, c.revoked_at AS connection_revoked_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN youtube_connections c ON c.id = s.active_connection_id AND c.user_id = s.user_id
     WHERE s.id_hash = ?1`,
  )
    .bind(sessionHash)
    .first<SessionRow>();
  if (!row || row.revoked_at || Date.parse(row.expires_at) <= Date.now())
    return null;
  await env.DB.prepare('UPDATE sessions SET last_used_at=?1 WHERE id_hash=?2')
    .bind(new Date().toISOString(), sessionHash)
    .run();
  return row;
}

export async function getAuthContext(
  request: Request,
): Promise<AuthContext | null> {
  const row = await sessionRow(request);
  if (!row) return null;
  return {
    sessionHash: row.id_hash,
    userId: row.user_id,
    googleSub: row.google_sub,
    email: row.email,
    displayName: row.display_name,
    csrfHash: row.csrf_hash,
    connection:
      row.connection_revoked_at || row.active_connection_id === null
        ? null
        : connectionFromRow(row),
  };
}

export async function requireAuth(
  request: Request,
  options: { csrf?: boolean; channel?: boolean } = {},
): Promise<AuthResult> {
  const context = await getAuthContext(request);
  if (!context)
    return { response: jsonAuthError('Autenticação necessária.', 401) };
  if (options.csrf) {
    let originMatches = true;
    const origin = request.headers.get('origin');
    if (origin) {
      try {
        originMatches = origin === trustedOrigin(request);
      } catch {
        originMatches = false;
      }
    }
    const header = request.headers.get('x-csrf-token');
    const cookieToken = getCookie(request, CSRF_COOKIE);
    if (
      !originMatches ||
      !header ||
      !cookieToken ||
      !constantTimeEqual(header, cookieToken) ||
      !constantTimeEqual(await hash(cookieToken), context.csrfHash)
    )
      return { response: jsonAuthError('Token CSRF inválido.', 403) };
  }
  if (options.channel && !context.connection)
    return {
      response: jsonAuthError('Conecte e selecione um canal do YouTube.', 403),
    };
  return { context };
}

export async function createSession(
  userId: string,
  connectionId: string | null,
) {
  const sessionToken = randomToken();
  const csrfToken = randomToken();
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + SESSION_DAYS * 86_400_000,
  ).toISOString();
  const sessionHash = await hash(sessionToken);
  await env.DB.prepare(
    `INSERT INTO sessions (id_hash, user_id, active_connection_id, csrf_hash, expires_at, revoked_at, created_at, last_used_at)
     VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?6)`,
  )
    .bind(
      sessionHash,
      userId,
      connectionId,
      await hash(csrfToken),
      expiresAt,
      now.toISOString(),
    )
    .run();
  const headers = new Headers();
  headers.append(
    'set-cookie',
    cookie(SESSION_COOKIE, sessionToken, SESSION_DAYS * 86_400),
  );
  headers.append('set-cookie', csrfCookie(csrfToken, SESSION_DAYS * 86_400));
  return { headers, csrfToken };
}

export async function rotateCsrf(context: AuthContext) {
  const csrfToken = randomToken();
  await env.DB.prepare('UPDATE sessions SET csrf_hash=?1 WHERE id_hash=?2')
    .bind(await hash(csrfToken), context.sessionHash)
    .run();
  const headers = new Headers();
  headers.append('set-cookie', csrfCookie(csrfToken, SESSION_DAYS * 86_400));
  return { headers, csrfToken };
}

export async function listConnections(userId: string) {
  const result = await env.DB.prepare(
    `SELECT id, channel_id, channel_title, revoked_at
     FROM youtube_connections WHERE user_id=?1 ORDER BY channel_title, channel_id`,
  )
    .bind(userId)
    .all<{
      id: string;
      channel_id: string;
      channel_title: string;
      revoked_at: string | null;
    }>();
  return result.results.map((row) => ({
    id: row.id,
    channelId: row.channel_id,
    channelTitle: row.channel_title,
    revoked: Boolean(row.revoked_at),
  }));
}

export async function createOAuthState() {
  const state = randomToken();
  const verifier = randomToken(48);
  const nonce = randomToken();
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + OAUTH_STATE_MINUTES * 60_000,
  ).toISOString();
  await env.DB.prepare(
    `INSERT INTO oauth_states (state_hash, code_verifier_ciphertext, nonce, expires_at, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(
      await hash(state),
      await encryptSecret(verifier),
      nonce,
      expiresAt,
      now.toISOString(),
    )
    .run();
  return { state, verifier, nonce };
}

export async function consumeOAuthState(state: string) {
  const stateHash = await hash(state);
  const row = await env.DB.prepare(
    'SELECT state_hash, code_verifier_ciphertext, nonce, expires_at FROM oauth_states WHERE state_hash=?1',
  )
    .bind(stateHash)
    .first<OAuthStateRow>();
  if (!row || Date.parse(row.expires_at) <= Date.now()) return null;
  const deleted = await env.DB.prepare(
    'DELETE FROM oauth_states WHERE state_hash=?1 AND expires_at=?2',
  )
    .bind(stateHash, row.expires_at)
    .run();
  if (deleted.meta.changes !== 1) return null;
  return {
    verifier: await decryptSecret(row.code_verifier_ciphertext),
    nonce: row.nonce,
  };
}

export async function codeChallenge(verifier: string) {
  return base64Url(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    ),
  );
}

export async function buildAuthorizationUrl(
  request: Request,
  state: string,
  verifier: string,
  nonce: string,
) {
  const config = requiredOAuthConfig();
  const url = new URL(
    env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
  );
  url.search = new URLSearchParams({
    client_id: config.clientId ?? '',
    redirect_uri: redirectUri(request),
    response_type: 'code',
    scope: 'openid email https://www.googleapis.com/auth/youtube.readonly',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    nonce,
    code_challenge: await codeChallenge(verifier),
    code_challenge_method: 'S256',
  }).toString();
  return url;
}

async function providerJson(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function exchangeCode(
  request: Request,
  code: string,
  verifier: string,
) {
  const config = requiredOAuthConfig();
  const response = await fetch(
    config.tokenEndpoint || 'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId ?? '',
        client_secret: config.clientSecret ?? '',
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri(request),
        code_verifier: verifier,
      }),
    },
  );
  const payload = await providerJson(response);
  if (!response.ok) {
    const codeValue = typeof payload.error === 'string' ? payload.error : '';
    throw new AuthProviderError(
      response.status >= 500
        ? 'temporary'
        : codeValue === 'invalid_grant'
          ? 'invalid'
          : 'temporary',
      'Não foi possível concluir login Google.',
    );
  }
  const accessToken =
    typeof payload.access_token === 'string' ? payload.access_token : '';
  const idToken = typeof payload.id_token === 'string' ? payload.id_token : '';
  const refreshToken =
    typeof payload.refresh_token === 'string' ? payload.refresh_token : null;
  const expiresIn = Number(payload.expires_in);
  if (
    !accessToken ||
    !idToken ||
    !Number.isInteger(expiresIn) ||
    expiresIn <= 0
  )
    throw new AuthProviderError('temporary', 'Resposta OAuth inválida.');
  return {
    accessToken,
    idToken,
    refreshToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

export async function verifyGoogleIdToken(idToken: string, nonce: string) {
  const config = requiredOAuthConfig();
  try {
    const jwks = createRemoteJWKSet(
      new URL(
        env.GOOGLE_JWKS_URL || 'https://www.googleapis.com/oauth2/v3/certs',
      ),
    );
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: config.clientId,
    });
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.nonce !== 'string' ||
      !constantTimeEqual(payload.nonce, nonce)
    )
      throw new Error('invalid claims');
    return {
      sub: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : null,
      displayName: typeof payload.name === 'string' ? payload.name : null,
    };
  } catch {
    throw new AuthProviderError('invalid', 'Identidade Google inválida.');
  }
}

export async function upsertUser(identity: {
  sub: string;
  email: string | null;
  displayName: string | null;
}) {
  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE google_sub=?1',
  )
    .bind(identity.sub)
    .first<{ id: string }>();
  const id = existing?.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, display_name, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5)
     ON CONFLICT(google_sub) DO UPDATE SET email=excluded.email, display_name=excluded.display_name, updated_at=excluded.updated_at`,
  )
    .bind(id, identity.sub, identity.email, identity.displayName, now)
    .run();
  return id;
}

export async function upsertYoutubeConnection(
  userId: string,
  channel: { id: string; title: string },
  token: {
    accessToken: string;
    refreshToken: string | null;
    expiresAt: string;
  },
) {
  const existing = await env.DB.prepare(
    'SELECT id, refresh_token_ciphertext FROM youtube_connections WHERE user_id=?1 AND channel_id=?2',
  )
    .bind(userId, channel.id)
    .first<{ id: string; refresh_token_ciphertext: string | null }>();
  const id = existing?.id ?? crypto.randomUUID();
  const refreshCiphertext = token.refreshToken
    ? await encryptSecret(token.refreshToken)
    : (existing?.refresh_token_ciphertext ?? null);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO youtube_connections
       (id, user_id, channel_id, channel_title, access_token_ciphertext, refresh_token_ciphertext,
        access_token_expires_at, revoked_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?8)
     ON CONFLICT(user_id, channel_id) DO UPDATE SET channel_title=excluded.channel_title,
       access_token_ciphertext=excluded.access_token_ciphertext,
       refresh_token_ciphertext=excluded.refresh_token_ciphertext,
       access_token_expires_at=excluded.access_token_expires_at,
       revoked_at=NULL, updated_at=excluded.updated_at`,
  )
    .bind(
      id,
      userId,
      channel.id,
      channel.title,
      await encryptSecret(token.accessToken),
      refreshCiphertext,
      token.expiresAt,
      now,
    )
    .run();
  return id;
}

export async function revokeConnection(connection: YoutubeConnection) {
  try {
    const token = await decryptSecret(connection.accessTokenCiphertext);
    await fetch(
      env.GOOGLE_REVOKE_URL || 'https://oauth2.googleapis.com/revoke',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
      },
    );
  } catch {
    // Local revocation still closes access when provider is unavailable.
  }
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE youtube_connections SET revoked_at=?, updated_at=? WHERE id=?',
    ).bind(now, now, connection.id),
    env.DB.prepare(
      'UPDATE sessions SET active_connection_id=NULL WHERE active_connection_id=?',
    ).bind(connection.id),
  ]);
}

export async function markConnectionRevoked(connectionId: string) {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE youtube_connections SET revoked_at=?, updated_at=? WHERE id=? AND revoked_at IS NULL',
    ).bind(now, now, connectionId),
    env.DB.prepare(
      'UPDATE sessions SET active_connection_id=NULL WHERE active_connection_id=?',
    ).bind(connectionId),
  ]);
}

export async function usableConnection(connection: YoutubeConnection) {
  if (connection.revokedAt)
    throw new AuthProviderError('revoked', 'Reconecte o canal do YouTube.');
  let accessToken = await decryptSecret(connection.accessTokenCiphertext);
  let expiresAt = connection.accessTokenExpiresAt;
  if (Date.parse(expiresAt) <= Date.now() + CONNECTION_GRACE_MS) {
    if (!connection.refreshTokenCiphertext) {
      await markConnectionRevoked(connection.id);
      throw new AuthProviderError('revoked', 'Reconecte o canal do YouTube.');
    }
    const refreshToken = await decryptSecret(connection.refreshTokenCiphertext);
    let refreshed;
    try {
      refreshed = await refreshAccessToken(
        refreshToken,
        youtubeClientOptions(),
      );
    } catch (cause) {
      if (cause instanceof YouTubeApiError && cause.kind === 'revoked') {
        await markConnectionRevoked(connection.id);
        throw new AuthProviderError('revoked', 'Reconecte o canal do YouTube.');
      }
      throw new AuthProviderError(
        'temporary',
        'YouTube indisponível no momento.',
      );
    }
    accessToken = refreshed.accessToken;
    expiresAt = refreshed.expiresAt;
    await env.DB.prepare(
      'UPDATE youtube_connections SET access_token_ciphertext=?1, access_token_expires_at=?2, updated_at=?3 WHERE id=?4 AND revoked_at IS NULL',
    )
      .bind(
        await encryptSecret(accessToken),
        expiresAt,
        new Date().toISOString(),
        connection.id,
      )
      .run();
  }
  let channels;
  try {
    channels = await listMyChannels(accessToken, youtubeClientOptions());
  } catch (cause) {
    if (cause instanceof YouTubeApiError && cause.kind === 'revoked') {
      await markConnectionRevoked(connection.id);
      throw new AuthProviderError('revoked', 'Reconecte o canal do YouTube.');
    }
    throw new AuthProviderError(
      'temporary',
      'YouTube indisponível no momento.',
    );
  }
  if (!channels.some((channel) => channel.id === connection.channelId)) {
    await markConnectionRevoked(connection.id);
    throw new AuthProviderError(
      'revoked',
      'Canal não está mais disponível na conta Google.',
    );
  }
  return { accessToken, expiresAt, channelId: connection.channelId };
}

export function providerFailureResponse(cause: unknown) {
  if (cause instanceof AuthProviderError && cause.kind === 'revoked')
    return jsonAuthError(cause.message, 503);
  return jsonAuthError(
    'Não foi possível validar o canal agora. Tente novamente.',
    503,
  );
}

export function redirectWithError(request: Request, code: string) {
  const url = new URL(`${trustedOrigin(request)}/`);
  url.searchParams.set('auth_error', code);
  return new Response(null, {
    status: 303,
    headers: { location: url.toString(), 'cache-control': 'no-store' },
  });
}

export function redirectWithSuccess(request: Request) {
  const url = new URL(`${trustedOrigin(request)}/`);
  url.searchParams.set('auth', 'connected');
  return new Response(null, {
    status: 303,
    headers: { location: url.toString(), 'cache-control': 'no-store' },
  });
}

export function sessionJson(
  context: AuthContext,
  connections: Array<{
    id: string;
    channelId: string;
    channelTitle: string;
    revoked: boolean;
  }>,
  csrfToken: string,
) {
  return json(
    {
      authenticated: true,
      user: {
        id: context.userId,
        email: context.email,
        displayName: context.displayName,
      },
      channel: context.connection
        ? {
            id: context.connection.id,
            channelId: context.connection.channelId,
            title: context.connection.channelTitle,
          }
        : null,
      channels: connections,
      csrfToken,
    },
    200,
    { 'cache-control': 'no-store' },
  );
}
