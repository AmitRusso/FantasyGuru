import { timingSafeEqual } from 'node:crypto';
import { Receiver } from '@upstash/qstash';
import type { FastifyRequest } from 'fastify';
import type { Config } from './config.js';

/**
 * Two gates on the internal routes (spec §1.1, build-plan.md S1 §1.3).
 *
 *   1. QStash signature -- how the scheduler calls in.
 *   2. A shared secret header -- how a human triggers a run, and how the Stage 1 acceptance
 *      test works at all.
 *
 * Either passes. Neither is optional: "the scheduled route must be idempotent and gated
 * behind a shared secret."
 */

export const INTERNAL_SECRET_HEADER = 'x-internal-secret';
export const QSTASH_SIGNATURE_HEADER = 'upstash-signature';

export type AuthResult = { ok: true; via: 'secret' | 'qstash' } | { ok: false; reason: string };

/** Constant-time, and length-safe -- timingSafeEqual throws on a length mismatch. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface AuthRequest extends FastifyRequest {
  rawBody?: string;
}

export async function authenticateInternalRequest(
  request: AuthRequest,
  config: Config,
): Promise<AuthResult> {
  const providedSecret = request.headers[INTERNAL_SECRET_HEADER];
  if (typeof providedSecret === 'string' && providedSecret.length > 0) {
    return secretMatches(providedSecret, config.INTERNAL_SECRET)
      ? { ok: true, via: 'secret' }
      : { ok: false, reason: 'invalid internal secret' };
  }

  const signature = request.headers[QSTASH_SIGNATURE_HEADER];
  if (typeof signature === 'string' && signature.length > 0) {
    if (!config.QSTASH_CURRENT_SIGNING_KEY || !config.QSTASH_NEXT_SIGNING_KEY) {
      return { ok: false, reason: 'qstash signing keys not configured' };
    }

    const receiver = new Receiver({
      currentSigningKey: config.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: config.QSTASH_NEXT_SIGNING_KEY,
    });

    try {
      // The URL is not asserted: Fly terminates TLS and rewrites the host, so the URL this
      // process sees is not the one QStash signed. Signature over the body plus the
      // rotating key pair is the check that matters.
      const valid = await receiver.verify({
        signature,
        body: request.rawBody ?? '',
      });
      return valid
        ? { ok: true, via: 'qstash' }
        : { ok: false, reason: 'invalid qstash signature' };
    } catch (error) {
      return { ok: false, reason: `qstash verification failed: ${(error as Error).message}` };
    }
  }

  return { ok: false, reason: 'no credentials presented' };
}
