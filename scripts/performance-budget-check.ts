import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(root, 'docs/terminal-market-structure/性能基线.json');

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as {
  hardware?: string;
  notes?: string;
};

if (baseline.hardware === 'unmeasured' || baseline.hardware === undefined) {
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'NOT_RUN',
        reason: baseline.notes ?? '尚未在固定硬件、固定 SHA 和真实主网案件上测量性能预算。',
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = 2;
  process.exit();
}

process.stdout.write(
  `${JSON.stringify({ status: 'PASS', hardware: baseline.hardware }, null, 2)}\n`,
);
