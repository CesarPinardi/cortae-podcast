const DEFAULT_API_BASE_URL = 'https://www.googleapis.com/youtube/v3';
const DEFAULT_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const MAX_RESPONSE_BYTES = 1_000_000;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export type YouTubeClientOptions = {
  apiBaseUrl?: string;
  tokenEndpoint?: string;
  clientId?: string;
  clientSecret?: string;
};

export type YouTubeChannel = {
  id: string;
  title: string;
};

export type YouTubeVideo = {
  id: string;
  channelId: string;
  title: string;
};

export type YouTubeErrorKind =
  | 'temporary'
  | 'revoked'
  | 'not_found'
  | 'invalid';

export class YouTubeApiError extends Error {
  readonly kind: YouTubeErrorKind;
  readonly status?: number;

  constructor(kind: YouTubeErrorKind, message: string, status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.name = 'YouTubeApiError';
  }
}

function validVideoId(value: string | undefined) {
  return value && VIDEO_ID.test(value) ? value : null;
}

export function parseYouTubeVideoId(sourceUrl: string) {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const hostname = url.hostname.toLowerCase();
  if (
    ![
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'music.youtube.com',
      'youtu.be',
    ].includes(hostname)
  )
    return null;

  if (hostname === 'youtu.be')
    return validVideoId(url.pathname.split('/').filter(Boolean)[0]);
  if (url.pathname === '/watch')
    return validVideoId(url.searchParams.get('v') ?? undefined);
  const segments = url.pathname.split('/').filter(Boolean);
  if (['live', 'shorts', 'embed', 'v'].includes(segments[0] ?? ''))
    return validVideoId(segments[1]);
  return null;
}

async function responseJson(response: Response) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES)
    throw new YouTubeApiError('temporary', 'Resposta externa excede o limite.');
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES)
    throw new YouTubeApiError('temporary', 'Resposta externa excede o limite.');
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new YouTubeApiError('temporary', 'Resposta externa inválida.');
  }
}

function apiUrl(
  options: YouTubeClientOptions,
  path: string,
  params: URLSearchParams,
) {
  const base = (options.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(/\/$/, '');
  return `${base}/${path}?${params.toString()}`;
}

function externalError(response: Response, payload: Record<string, unknown>) {
  const error = payload.error;
  const reason =
    typeof error === 'object' && error !== null && 'errors' in error
      ? (error as { errors?: Array<{ reason?: string }> }).errors?.[0]?.reason
      : undefined;
  if (response.status === 401)
    return new YouTubeApiError(
      'revoked',
      'Autorização do YouTube expirou.',
      401,
    );
  if (response.status === 404)
    return new YouTubeApiError('not_found', 'Vídeo não encontrado.', 404);
  if (
    response.status === 429 ||
    response.status >= 500 ||
    reason === 'quotaExceeded'
  )
    return new YouTubeApiError(
      'temporary',
      'YouTube indisponível no momento.',
      response.status,
    );
  if (response.status === 403)
    return new YouTubeApiError(
      'revoked',
      'Autorização do YouTube não permite esta operação.',
      403,
    );
  return new YouTubeApiError(
    'invalid',
    'Resposta do YouTube não aceita.',
    response.status,
  );
}

async function request(
  accessToken: string,
  path: string,
  params: URLSearchParams,
  options: YouTubeClientOptions,
) {
  const response = await fetch(apiUrl(options, path, params), {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
  });
  const payload = await responseJson(response);
  if (!response.ok) throw externalError(response, payload);
  return payload;
}

export async function listMyChannels(
  accessToken: string,
  options: YouTubeClientOptions = {},
) {
  const channels: YouTubeChannel[] = [];
  let pageToken = '';
  const seenTokens = new Set<string>();
  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams({
      part: 'snippet',
      mine: 'true',
      maxResults: '50',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const payload = await request(accessToken, 'channels', params, options);
    const items = Array.isArray(payload.items) ? payload.items : [];
    for (const item of items) {
      if (typeof item !== 'object' || item === null) continue;
      const id = 'id' in item && typeof item.id === 'string' ? item.id : '';
      const snippet =
        'snippet' in item &&
        typeof item.snippet === 'object' &&
        item.snippet !== null
          ? item.snippet
          : null;
      const title =
        snippet && 'title' in snippet && typeof snippet.title === 'string'
          ? snippet.title
          : '';
      if (id && title) channels.push({ id, title });
    }
    const next =
      typeof payload.nextPageToken === 'string' ? payload.nextPageToken : '';
    if (!next) return channels;
    if (seenTokens.has(next))
      throw new YouTubeApiError('temporary', 'Paginação do YouTube inválida.');
    seenTokens.add(next);
    pageToken = next;
  }
  throw new YouTubeApiError(
    'temporary',
    'Paginação do YouTube excedeu o limite.',
  );
}

export async function findVideo(
  accessToken: string,
  videoId: string,
  options: YouTubeClientOptions = {},
) {
  const params = new URLSearchParams({ part: 'snippet', id: videoId });
  const payload = await request(accessToken, 'videos', params, options);
  const item = Array.isArray(payload.items) ? payload.items[0] : null;
  if (!item || typeof item !== 'object') return null;
  const id = 'id' in item && typeof item.id === 'string' ? item.id : '';
  const snippet =
    'snippet' in item &&
    typeof item.snippet === 'object' &&
    item.snippet !== null
      ? item.snippet
      : null;
  const channelId =
    snippet && 'channelId' in snippet && typeof snippet.channelId === 'string'
      ? snippet.channelId
      : '';
  const title =
    snippet && 'title' in snippet && typeof snippet.title === 'string'
      ? snippet.title
      : '';
  return id && channelId && title ? { id, channelId, title } : null;
}

export async function refreshAccessToken(
  refreshToken: string,
  options: YouTubeClientOptions,
) {
  if (!options.clientId || !options.clientSecret)
    throw new YouTubeApiError(
      'temporary',
      'Credenciais OAuth não configuradas.',
    );
  const response = await fetch(
    options.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: options.clientId,
        client_secret: options.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    },
  );
  const payload = await responseJson(response);
  if (!response.ok) {
    const code = typeof payload.error === 'string' ? payload.error : '';
    if (code === 'invalid_grant')
      throw new YouTubeApiError(
        'revoked',
        'Autorização do YouTube foi revogada.',
        response.status,
      );
    throw new YouTubeApiError(
      'temporary',
      'Não foi possível renovar autorização do YouTube.',
      response.status,
    );
  }
  const accessToken =
    typeof payload.access_token === 'string' ? payload.access_token : '';
  const expiresIn = Number(payload.expires_in);
  if (!accessToken || !Number.isInteger(expiresIn) || expiresIn <= 0)
    throw new YouTubeApiError(
      'temporary',
      'Resposta de renovação OAuth inválida.',
    );
  return {
    accessToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}
