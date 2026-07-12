import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    fileParallelism: false, // tests share one Postgres database
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgres://dev:dev@localhost:5432/zenfinance_test',
      JWT_SECRET: 'test-jwt-secret-0123456789abcdef0123456789abcdef',
      ADMIN_SECRET: 'test-admin-secret-0123456789abcdef0123456789ab',
      SUPPORT_EMAIL: 'support@rushingtechnologies.com',
      TOKEN_ENC_KEY: 'a3f1c2d4e5b6a7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2',
      TRANSACTION_PROVIDER: 'mock',
      ENRICHMENT_PROVIDER: 'mock',
    },
  },
});
