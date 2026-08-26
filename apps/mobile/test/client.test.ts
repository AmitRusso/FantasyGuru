import { describe, expect, it } from 'vitest';
import { fetchUserLeagues } from '../src/api/client.js';

/**
 * build-plan.md S3 §3.9: "Not the UI" (spec §5.1) -- but the mapping from an HTTP outcome to
 * a UI state (S3 §3.4's four-row table) is pure logic, not presentation, and is the one part
 * of this stage's client genuinely worth pinning down.
 */

function fakeFetch(status: number, body: unknown = {}): typeof fetch {
  return (() =>
    Promise.resolve(new Response(JSON.stringify(body), { status }))) as unknown as typeof fetch;
}

function throwingFetch(): typeof fetch {
  return (() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch;
}

describe('fetchUserLeagues', () => {
  it('maps 200 to ok, with the response body attached', async () => {
    const payload = { userId: 'u1', sleeperUserId: 's1', leagues: [] };
    const result = await fetchUserLeagues('someone', { fetchImpl: fakeFetch(200, payload) });
    expect(result).toEqual({ status: 'ok', data: payload });
  });

  it('maps 404 to not_found -- Sleeper itself answers unknown usernames with 200/null, not this', async () => {
    const result = await fetchUserLeagues('nobody', {
      fetchImpl: fakeFetch(404, { error: 'unknown Sleeper username' }),
    });
    expect(result).toEqual({ status: 'not_found' });
  });

  it('maps 400 to invalid_username', async () => {
    const result = await fetchUserLeagues('x'.repeat(65), {
      fetchImpl: fakeFetch(400, { error: 'invalid username' }),
    });
    expect(result).toEqual({ status: 'invalid_username' });
  });

  it('maps 503 to warming_up -- Loop A has not run yet', async () => {
    const result = await fetchUserLeagues('someone', {
      fetchImpl: fakeFetch(503, { error: 'service warming up, try again shortly' }),
    });
    expect(result).toEqual({ status: 'warming_up' });
  });

  it('maps a thrown fetch (no network, or the API unreachable) to network_error', async () => {
    const result = await fetchUserLeagues('someone', { fetchImpl: throwingFetch() });
    expect(result).toEqual({ status: 'network_error' });
  });

  it('maps an unexpected status to unknown_error, carrying the status for diagnostics', async () => {
    const result = await fetchUserLeagues('someone', { fetchImpl: fakeFetch(500, {}) });
    expect(result).toEqual({ status: 'unknown_error', httpStatus: 500 });
  });

  it('URL-encodes the username into the path', async () => {
    let capturedUrl = '';
    const fetchImpl = ((url: string) => {
      capturedUrl = url;
      return Promise.resolve(
        new Response(JSON.stringify({ userId: 'u', sleeperUserId: 's', leagues: [] }), {
          status: 200,
        }),
      );
    }) as unknown as typeof fetch;

    await fetchUserLeagues('weird user/name', { fetchImpl });
    expect(capturedUrl).toContain(encodeURIComponent('weird user/name'));
  });
});
