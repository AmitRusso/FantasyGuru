import { normaliseNflState, normalisePlayers } from './normalise.js';
import type { NormalisedPlayersResult } from './normalise.js';
import type { NormalisedNflState, RawNflState, RawPlayersResponse } from './types.js';

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
}
