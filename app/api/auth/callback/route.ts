import {
  consumeOAuthState,
  clearOAuthStateCookie,
  createSession,
  exchangeCode,
  matchesOAuthStateCookie,
  redirectWithError,
  redirectWithSuccess,
  upsertUser,
  upsertYoutubeConnection,
  verifyGoogleIdToken,
  youtubeClientOptions,
} from '@/lib/server/auth';
import { listMyChannels } from '@/lib/server/youtube';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const finish = (response: Response) => {
    response.headers.append('set-cookie', clearOAuthStateCookie());
    return response;
  };
  if (url.searchParams.get('error'))
    return finish(redirectWithError(request, 'access_denied'));
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  if (!state || !code || !matchesOAuthStateCookie(request, state))
    return finish(redirectWithError(request, 'invalid_callback'));
  const oauthState = await consumeOAuthState(state).catch(() => null);
  if (!oauthState) return finish(redirectWithError(request, 'invalid_callback'));

  try {
    const token = await exchangeCode(request, code, oauthState.verifier);
    const identity = await verifyGoogleIdToken(token.idToken, oauthState.nonce);
    const userId = await upsertUser(identity);
    const channels = await listMyChannels(
      token.accessToken,
      youtubeClientOptions(),
    );
    if (!channels.length)
      return finish(redirectWithError(request, 'no_channel'));
    const connectionIds = [];
    for (const channel of channels)
      connectionIds.push(
        await upsertYoutubeConnection(userId, channel, {
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          expiresAt: token.expiresAt,
        }),
      );
    const session = await createSession(
      userId,
      connectionIds.length === 1 ? connectionIds[0] : null,
    );
    const response = finish(redirectWithSuccess(request));
    for (const value of session.headers.getSetCookie())
      response.headers.append('set-cookie', value);
    return response;
  } catch {
    return finish(redirectWithError(request, 'provider_unavailable'));
  }
}
