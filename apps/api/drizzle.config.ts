import { defineConfig } from 'drizzle-kit';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

for (const candidate of [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../.env'),
  path.resolve(process.cwd(), '../../.env'),
]) {
  if (!existsSync(candidate)) continue;
  for (const line of readFileSync(candidate, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = rest.join('=').replace(/^['"]|['"]$/g, '');
  }
  break;
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://dev:dev@localhost:5432/zenfinance',
  },
});
