import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    include: ['test/**/*.test.ts'],
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/watertruck_test',
      JWT_SECRET: 'test-secret',
      PUSH_ENABLED: 'false',
      APP_TIMEZONE: 'America/Edmonton',
    },
  },
});
