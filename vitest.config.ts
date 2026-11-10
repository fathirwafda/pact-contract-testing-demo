import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['services/**/test/**/*.test.ts'],
          exclude: ['**/*.verify.test.ts'],
        },
      },
      {
        test: {
          name: 'consumer',
          include: ['consumers/**/test/**/*.pact.test.ts'],
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'provider',
          include: ['services/**/test/**/*.verify.test.ts'],
          testTimeout: 120_000,
        },
      },
    ],
  },
});
