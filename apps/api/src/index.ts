import * as Sentry from '@sentry/node';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';

/**
 * Entry point. Spec §5.2: "You need to know about a broken sync before Sunday, not during it."
 */

async function main(): Promise<void> {
  const config = loadConfig();

  // Before the server, so a crash during boot is still reported.
  if (config.SENTRY_DSN) {
    Sentry.init({
      dsn: config.SENTRY_DSN,
      environment: config.NODE_ENV,
      tracesSampleRate: 0.1,
    });
  }

  const server = await buildServer({ config });

  // Fly sends SIGTERM and waits. Draining matters here: a machine replaced mid-sync must
  // release its advisory lock rather than leave the next run turning itself away.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      server.log.info({ signal }, 'shutting down');
      void server.close().then(() => process.exit(0));
    });
  }

  await server.listen({ port: config.PORT, host: config.HOST });
}

main().catch((error: unknown) => {
  Sentry.captureException(error);
  console.error('fatal: api failed to start', error);
  process.exit(1);
});
