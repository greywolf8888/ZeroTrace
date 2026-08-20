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
  'storage-plane',
  'token-flow-engine',
  'funding-settlement-engine',
  'cluster-position-engine',
  'candidate-discovery',
  'behavior-engine',
  'campaign-engine',
  'forensic-evidence',
  'asset-ledger',
  'supply-reality-engine',
  'identity-intelligence',
  'campaign-intelligence',
  'capital-intelligence',
  'market-reality-engine',
  'casework',
  'workflow-core',
  'llm-gateway',
  'source-registry',
  'provider-scheduler',
  'provider-plane',
  'platform-auth',
  'terminal-pipeline',
  'local-index',
  'token-market-capture',
];

// The differential suite launches the Rust authority and is intentionally kept
// out of broad JavaScript-only runs. Its dedicated gate must still be able to
// select the suite; a permanent exclude made `test:formula:diff` a dead script.
const runsTerminalFormulaGate = process.argv.some((argument) =>
  argument.replaceAll('\\', '/').includes('evals/terminal-formulas'),
);

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
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/tests/e2e/**',
      ...(runsTerminalFormulaGate ? [] : ['evals/terminal-formulas/**']),
    ],
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
