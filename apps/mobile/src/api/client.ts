import type { GetUserLeaguesResponse } from '@fantasyguru/contracts';

/**
 * The one route this stage consumes (build-plan.md S3 Decision 4: plain fetch, not a
 * data-fetching library -- one query does not earn the caching/retry conventions a library
 * buys, and adding one now is a dependency bought before there is anything to spend it on).
 *
 * This is the piece of Stage 3 that is pure logic rather than presentation, and the one
 * thing spec §5.1's "not the UI" carve-out leaves worth testing: mapping an HTTP outcome to
 * a UI state (build-plan.md S3 §3.4's four-row table), with no DOM involved.
 */

const DEFAULT_BASE_URL = 'https://fantasyguru-api.fly.dev';

/**
 * `EXPO_PUBLIC_*` vars are inlined at bundle time by Metro -- this is Expo's supported
 * mechanism for a client-visible config value, not a secret (there is nothing secret about
 * an API base URL for a public, unauthenticated route).
 */
function baseUrl(): string {
  return process.env.EXPO_PUBLIC_API_BASE_URL ?? DEFAULT_BASE_URL;
}

export type FetchUserLeaguesResult =
  | { status: 'ok'; data: GetUserLeaguesResponse }
  | { status: 'not_found' }
  | { status: 'invalid_username' }
  | { status: 'warming_up' }
  | { status: 'network_error' }
  | { status: 'unknown_error'; httpStatus: number };

export interface FetchUserLeaguesOptions {
  fetchImpl?: typeof fetch;
}

export async function fetchUserLeagues(
  username: string,
  options: FetchUserLeaguesOptions = {},
): Promise<FetchUserLeaguesResult> {
  const doFetch = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(`${baseUrl()}/v1/users/${encodeURIComponent(username)}/leagues`, {
      headers: { accept: 'application/json' },
    });
  } catch {
    // Covers both "no network" and "the API is unreachable" -- from the client's vantage
    // point these are indistinguishable, and build-plan.md S3 §3.4 treats them as one state.
    return { status: 'network_error' };
  }

  if (response.status === 200) {
    const data = (await response.json()) as GetUserLeaguesResponse;
    return { status: 'ok', data };
  }

  if (response.status === 404) return { status: 'not_found' };
  if (response.status === 400) return { status: 'invalid_username' };
  if (response.status === 503) return { status: 'warming_up' };

  return { status: 'unknown_error', httpStatus: response.status };
}
