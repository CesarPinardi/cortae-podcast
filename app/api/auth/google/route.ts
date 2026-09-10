import { error } from '@/lib/server/http';
import {
  buildAuthorizationUrl,
  createOAuthState,
  oauthStateCookie,
} from '@/lib/server/auth';

export async function GET(request: Request) {
  try {
    const { state, verifier, nonce } = await createOAuthState();
    const location = await buildAuthorizationUrl(
      request,
      state,
      verifier,
      nonce,
    );
    const response = new Response(null, {
      status: 302,
      headers: { location: location.toString(), 'cache-control': 'no-store' },
    });
    response.headers.append('set-cookie', oauthStateCookie(state));
    return response;
  } catch (cause) {
    return error(
      cause instanceof Error ? cause.message : 'Login Google indisponível.',
      503,
    );
  }
}
