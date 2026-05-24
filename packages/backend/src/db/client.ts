import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';
import { loadEnv } from '../config/env.js';

type Db = PostgresJsDatabase<typeof schema>;

let cached: Db | null = null;

function getDb(): Db {
  if (cached) return cached;
  const { url } = loadEnv().database;
  if (!url) throw new Error('DATABASE_URL is not set — see .env.example');
  cached = drizzle(postgres(url, { max: 5 }), { schema });
  return cached;
}

// proxy so call sites can `import { db }` and use it synchronously —
// the real handle is built on first access, after dotenv has run.
export const db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = getDb();
    const value = Reflect.get(real, prop);
    return typeof value === 'function' ? value.bind(real) : value;
  },
});

export { schema };

export function logDbError(scope: string, err: unknown): void {
  console.error(`[db:${scope}]`, err instanceof Error ? err.message : err);
}
