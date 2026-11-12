import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgres://app@localhost:5433/placement_test',
      JWT_SECRET: 'test-secret-test-secret-test-secret',
      OFFICER_INVITE_CODE: 'TEST-INVITE',
      BCRYPT_ROUNDS: '4',
    },
  },
});
