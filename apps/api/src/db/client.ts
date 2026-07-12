import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env.js';
import * as schema from './schema.js';

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
});

// pg-pool emits 'error' for faults on idle clients (e.g. the DB terminates a
// connection). Without a listener, Node treats it as an uncaught exception
// and kills the whole process — so a transient DB blip would take down every
// in-flight request and the sync worker with it. Log and let the pool recover.
pool.on('error', (err) => {
  console.error('[db] pool error on idle client:', err.message);
});

export const db = drizzle(pool, { schema });

export type Db = typeof db;
