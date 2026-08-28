import path from 'node:path';
import process from 'node:process';

const rootDir = path.resolve(import.meta.dirname, '..');

export function getConfig(overrides = {}) {
  return {
    rootDir,
    host: overrides.host ?? process.env.HOST ?? '127.0.0.1',
    port: Number(overrides.port ?? process.env.PORT ?? 4173),
    databasePath: path.resolve(rootDir, overrides.databasePath ?? process.env.DATABASE_PATH ?? 'data/beto.sqlite'),
    sessionTtlHours: Number(overrides.sessionTtlHours ?? process.env.SESSION_TTL_HOURS ?? 12),
    isProduction: (overrides.nodeEnv ?? process.env.NODE_ENV) === 'production'
  };
}
