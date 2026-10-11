import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../factory.js';
import { resolveDatabaseUrl, validateAppConfig } from './config.js';
import { createDatabase, initialize } from './database.js';
import { createLogger } from './logger.js';

export async function start() {
  const config = validateAppConfig(process.env);
  const logger = createLogger(config.logLevel);
  const database = createDatabase(resolveDatabaseUrl());

  try {
    await database.$connect();
    await initialize(database);
    const app = createApp(database, logger, {
      corsOrigins: config.corsOrigins,
      rateLimit: { windowMs: 60_000, limit: config.rateLimitMax },
    });

    const server = await new Promise<Server>((resolve, reject) => {
      const listener = app.listen(config.apiPort, '0.0.0.0', () => resolve(listener));
      listener.once('error', reject);
    });

    logger.info('Taskly API started', {
      port: (server.address() as AddressInfo).port,
      env: config.nodeEnv,
    });

    const shutdown = async (signal: NodeJS.Signals) => {
      logger.warn('Shutting down API server', { signal });
      const timeout = setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
      timeout.unref();

      await new Promise<void>((resolve, reject) => {
        server.close(async (error) => {
          if (error) {
            reject(error);
            return;
          }

          try {
            await database.$disconnect();
            logger.info('Database disconnected');
            resolve();
          } catch (closeError) {
            logger.error('Database close failed', { error: closeError });
            process.exitCode = 1;
            resolve();
          }
        });
      }).catch((error) => {
        logger.error('Shutdown failed', { error });
        process.exitCode = 1;
      });

      clearTimeout(timeout);
    };

    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
    return { server, database };
  } catch (error) {
    logger.error('Failed to start Taskly API', { error });
    await database.$disconnect().catch(() => undefined);
    throw error;
  }
}
