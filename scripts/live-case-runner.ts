import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

interface LiveCase {
  id: string;
  priority: 'P0' | 'P1';
  chain?: string;
  chain_id?: string;
  token?: string;
  subject?: string;
}

const cases: LiveCase[] = [
  {
    id: 'BSC_FLAP_PORTAL_IDENTITY',
    priority: 'P0',
    chain: 'EVM',
    chain_id: 'eip155:56',
    subject: '0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0',
  },
  {
    id: 'BSC_FLAP_TAX_V6_ORIGIN',
    priority: 'P0',
    chain: 'EVM',
    chain_id: 'eip155:56',
    token: '0xAeCBD0E461047d6B7Cfc82e637AD197097407777',
  },
  {
    id: 'BSC_FLAP_TAX_V3_HISTORY',
    priority: 'P0',
    chain: 'EVM',
    chain_id: 'eip155:56',
    token: '0x13Aa2c5bbfD15B65b15Ef1129fF3dCDDF8c17777',
  },
  {
    id: 'BSC_PANCAKE_V2_NEGATIVE_CONTROL',
    priority: 'P0',
    chain: 'EVM',
    chain_id: 'eip155:56',
    subject: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
  },
  { id: 'PROVIDER_DISAGREEMENT_NEGATIVE_CASE', priority: 'P0' },
  { id: 'UNSUPPORTED_V3_EXACT_EXIT', priority: 'P0' },
];

function gitSha(): string {
  try {
    return execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown-sha';
  }
}

function providerUrls(): string[] {
  return [process.env.ZERO_TRACE_BSC_RPC_URL, process.env.ZERO_TRACE_BSC_RPC_URL_SECONDARY].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
}

const sha = gitSha();
const urls = providerUrls();
const outRoot = join(root, 'output', 'zero-trust-validation', sha);
mkdirSync(outRoot, { recursive: true });

const summary = cases.map((item) => {
  const dir = join(outRoot, item.id);
  mkdirSync(dir, { recursive: true });
  const blocked = urls.length === 0;
  const gate = blocked ? 'BLOCKED_EXTERNAL' : 'NOT_RUN';
  const manifest = {
    caseId: item.id,
    priority: item.priority,
    gate,
    reason: blocked
      ? 'BSC RPC URLs are not configured; live capture was not executed and is not recorded as PASS.'
      : 'Live runner is present but this invocation did not complete a dual-provider capture.',
    providersConfigured: urls.length,
    token: item.token ?? null,
    subject: item.subject ?? null,
    chainId: item.chain_id ?? null,
  };
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    join(dir, 'logs.json'),
    `${JSON.stringify({ gate, note: 'No synthetic zeros were written for missing RPC.' }, null, 2)}\n`,
  );
  return manifest;
});

writeFileSync(join(outRoot, 'summary.json'), `${JSON.stringify({ sha, summary }, null, 2)}\n`);
process.stdout.write(
  JSON.stringify(
    {
      sha,
      cases: summary.length,
      blockedExternal: summary.filter((item) => item.gate === 'BLOCKED_EXTERNAL').length,
      pass: 0,
    },
    null,
    2,
  ) + '\n',
);
