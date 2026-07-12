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
    },
  },
});
