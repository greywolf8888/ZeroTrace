import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const files = [
  'apps/web/src/App.tsx',
  'apps/web/src/app/AppShell.tsx',
  'apps/web/src/InvestigationGraph.tsx',
  'apps/web/src/workspaces/forensic.tsx',
  'apps/web/src/workspaces/token-analyze.tsx',
  'apps/web/src/i18n/zh-CN.ts',
];

const forbidden = [
  'Market Reality',
  'Intelligence Search',
  'Entity Intelligence',
  'Control Rights',
  'Control Campaigns',
  'Claim Audit',
  'Scenario Lab',
  'Data Health',
  'Capability ledger',
  'Platform adapter boundaries',
  'ZeroTrace company icon',
  'See control, liquidity, and realizable value',
  'Trace an on-chain subject',
  'No pinned version',
  'Provenance Pending',
  'Primary nav',
  'aria-label="Primary"',
];

const hits: string[] = [];
for (const file of files) {
  const text = readFileSync(join(root, file), 'utf8');
  for (const phrase of forbidden) {
    if (text.includes(phrase)) hits.push(`${file}: ${phrase}`);
  }
}

if (hits.length > 0) {
  process.stderr.write(`ui-chinese-check failed:\n${hits.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(
  JSON.stringify({ user_visible_english_scan: 0, files: files.length }, null, 2) + '\n',
);
