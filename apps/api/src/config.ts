import { z } from 'zod';

/**
 * Fail at boot, not at 03:00.
 *
 * Everything Stage 2+ needs is declared here but optional, so a missing Redis URL cannot stop
 * Stage 1's sync from running -- while a missing DATABASE_URL or INTERNAL_SECRET stops the
 * process immediately, which is the correct behaviour for both.
 */

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  /** Gate 1 on the internal routes: manual triggers and the acceptance test (spec §1.1). */
  INTERNAL_SECRET: z.string().min(16, 'INTERNAL_SECRET must be at least 16 characters'),

  /** Gate 2: QStash signs its calls. Both keys exist because Upstash rotates them. */
  QSTASH_CURRENT_SIGNING_KEY: z.string().optional(),
  QSTASH_NEXT_SIGNING_KEY: z.string().optional(),

  /** Provisioned in Stage 1, first read in Stage 2 (spec §1). */
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  SENTRY_DSN: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }

  return parsed.data;
}
