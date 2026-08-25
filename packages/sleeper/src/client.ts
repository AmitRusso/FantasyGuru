import {
  normaliseLeague,
  normaliseLeagues,
  normaliseLeagueUsers,
  normaliseMatchups,
  normaliseNflState,
  normalisePlayers,
  normaliseRosters,
  normaliseUser,
} from './normalise.js';
import type {
  NormalisedLeaguesResult,
  NormalisedLeagueUsersResult,
  NormalisedMatchupsResult,
  NormalisedPlayersResult,
  NormalisedRostersResult,
} from './normalise.js';
import type {
  NormalisedLeague,
  NormalisedNflState,
  NormalisedUser,
  RawNflState,
  RawPlayersResponse,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.sleeper.app/v1';

/** Sleeper is undocumented in parts and unauthenticated everywhere; a UA is basic courtesy. */
const USER_AGENT = 'FantasyGuru/0.1 (+https://github.com/fantasyguru)';

export interface SleeperClientOptions {
  baseUrl?: string;
  /** The players payload is ~5MB; 30s is generous but a hung socket must not hold the job. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class SleeperApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
    this.name = 'SleeperApiError';
  }
}

export class SleeperClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SleeperClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new SleeperApiError(
        `Sleeper ${path} responded ${response.status}`,
        response.status,
        path,
      );
    }

    return (await response.json()) as T;
  }

  /**
   * `GET /v1/players/nfl` -- 14.6MB and 12,222 players, measured 24 Aug 2026. Spec §2.2
   * estimates "roughly 5MB and 11k players"; it is about three times that.
   *
   * Spec §2.2: fetch this ONCE GLOBALLY, never per user and never per request. It is the
   * single most consequential caching decision in the app. The only caller is Loop A.
   */
  async getPlayers(): Promise<NormalisedPlayersResult> {
    const raw = await this.get<RawPlayersResponse>('/players/nfl');
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new SleeperApiError(
        'Sleeper /players/nfl did not return an object',
        200,
        '/players/nfl',
      );
    }
    return normalisePlayers(raw);
  }

  /** `GET /v1/state/nfl` -- the current season and week. */
  async getNflState(): Promise<NormalisedNflState> {
    return normaliseNflState(await this.get<RawNflState>('/state/nfl'));
  }

  /**
   * `GET /v1/user/{username}` -- username to `user_id` (spec §2.1 step 2).
   *
   * Returns `null` for an unknown username rather than throwing: CONFIRMED live 25 Aug 2026
   * that Sleeper answers with HTTP 200 and a body of `null`, not a 404. This is the
   * most-travelled error path in the product -- a typo'd username -- and callers must be
   * able to distinguish "no such user" from a real failure.
   */
  async getUser(username: string): Promise<NormalisedUser | null> {
    return normaliseUser(await this.get<unknown>(`/user/${encodeURIComponent(username)}`));
  }

  /**
   * `GET /v1/user/{userId}/leagues/nfl/{season}` -- every league a user is in (spec §2.1
   * step 3).
   *
   * CONFIRMED live 25 Aug 2026 that each entry is the FULL league object -- identical in
   * shape to `getLeague()` below. build-plan.md S2 Decision 1: this is why the routine sweep
   * never needs a standalone per-league fetch to get settings.
   */
  async getUserLeagues(userId: string, season: string): Promise<NormalisedLeaguesResult> {
    return normaliseLeagues(
      await this.get<unknown>(
        `/user/${encodeURIComponent(userId)}/leagues/nfl/${encodeURIComponent(season)}`,
      ),
    );
  }

  /**
   * `GET /v1/league/{id}` -- standalone league fetch.
   *
   * NOT called by the routine sweep (build-plan.md S2 Decision 1) -- `getUserLeagues` already
   * returns this same shape for every league a synced user belongs to. This exists for
   * debugging and as a fallback to refresh a single league with no currently-active member.
   */
  async getLeague(leagueId: string): Promise<NormalisedLeague | null> {
    return normaliseLeague(await this.get<unknown>(`/league/${encodeURIComponent(leagueId)}`));
  }

  /**
   * `GET /v1/league/{id}/rosters` -- `starters[]`, the alarm's actual input.
   */
  async getLeagueRosters(leagueId: string): Promise<NormalisedRostersResult> {
    return normaliseRosters(
      await this.get<unknown>(`/league/${encodeURIComponent(leagueId)}/rosters`),
    );
  }

  /** `GET /v1/league/{id}/users` -- display names. Fetched on demand, not swept. */
  async getLeagueUsers(leagueId: string): Promise<NormalisedLeagueUsersResult> {
    return normaliseLeagueUsers(
      await this.get<unknown>(`/league/${encodeURIComponent(leagueId)}/users`),
    );
  }

  /**
   * `GET /v1/league/{id}/matchups/{week}` -- CONFIRMED live to diverge from `rosters.starters`
   * for a past week (build-plan.md S2 §2.8, item 3). Fetched on demand for the live
   * scoreboard, not read by the alarm.
   */
  async getLeagueMatchups(leagueId: string, week: number): Promise<NormalisedMatchupsResult> {
    return normaliseMatchups(
      await this.get<unknown>(`/league/${encodeURIComponent(leagueId)}/matchups/${week}`),
    );
  }
}
