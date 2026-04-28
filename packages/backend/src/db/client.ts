import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

// ---------------------------------------------------------------------------
// Lazy db handle — `process.env.DATABASE_URL` is read on first use, not at
// module-import time, so dotenv.config() in index.ts has a chance to run.
// ---------------------------------------------------------------------------

type Db = PostgresJsDatabase<typeof schema>;

let _db: Db | null = null;

function getDb(): Db {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set — see .env.example');
  }
  const client = postgres(url, { max: 5 });
  _db = drizzle(client, { schema });
  return _db;
}

// Proxy that forwards all property access to the lazily-created Drizzle
// instance. Lets call sites use `db.select()...` without awaiting init.
export const db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop as string];
    return typeof value === 'function' ? (value as Function).bind(real) : value;
    void receiver;
  },
});

export { schema };

/** Logs a DB write failure without crashing the engine. */
export function logDbError(scope: string, err: unknown): void {
  // eslint-disable-next-line no-console
  console.error(`[db:${scope}]`, err instanceof Error ? err.message : err);
}
