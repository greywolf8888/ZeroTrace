import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const files = [
  'apps/web/src/App.tsx',
  'apps/web/src/app/AppShell.tsx',
  'apps/web/src/i18n/zh-CN.ts',
  'apps/web/src/workspaces/token-analyze.tsx',
  'apps/web/src/workspaces/workstation-status.tsx',
  'apps/web/src/workspaces/shell/part-01.tsx',
  'apps/web/src/workspaces/shell/part-03.tsx',
  'apps/web/src/workspaces/shell/part-09.tsx',
  'apps/web/src/workspaces/shell/part-11.tsx',
  'apps/web/src/workspaces/shell/part-21.tsx',
  'apps/web/src/workspaces/shell/use-control-campaign.ts',
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
  '接口文档',
  '>开发者能力<',
  '可回放 Snapshot',
  'Snapshot 位置',
  'Evidence 闭包',
  'Evidence 绑定',
  'Evidence 分数',
  'Evidence 条目',
  'Evidence 数',
  'PostgreSQL 报告',
  'Token 盘面分析',
  'Token 地址',
  'Token 余额',
  '链 ID',
  '活动 ID',
  'Jaccard',
  'FINALIZED。',
  'PARTIAL 结果',
  '分录 JSON',
  'outpoint、',
  "health?.status ?? '检查中'",
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
  JSON.stringify(
    {
      forbidden_user_facing_terms: 0,
      production_language_files: files.length,
      diagnostic_navigation_default: 'disabled',
    },
    null,
    2,
  ) + '\n',
);
