import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const workspacePackages = [
  'action-semantics',
  'chain-adapters',
  'capture-scheduler',
  'claim-audit',
  'data-quality',
  'entity-engine',
  'evidence',
  'identifiers',
  'ingestion',
  'platform-adapters',
  'rv',
  'schemas',
  'storage',
  'token-flow-engine',
  'funding-settlement-engine',
  'cluster-position-engine',
  'candidate-discovery',
  'behavior-engine',
  'campaign-engine',
  'forensic-evidence',
];

export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      workspacePackages.map((name) => [
        `@zerotrace/${name}`,
        fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url)),
      ]),
    ),
  },
  test: {
    testTimeout: 15_000,
    hookTimeout: 15_000,
    exclude: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['packages/*/src/**/*.ts', 'services/*/src/**/*.ts', 'apps/api/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/test-fixtures/**',
        'packages/chain-adapters/src/index.ts',
        'apps/api/src/server.ts',
        'services/ingest-worker/src/cli.ts',
        // Semantic worker CLI modules are process bootstraps only; their configuration,
        // handlers, and worker loops remain included and are covered independently.
        'services/semantic-worker/src/*-cli.ts',
        'services/semantic-worker/src/cli.ts',
      ],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
