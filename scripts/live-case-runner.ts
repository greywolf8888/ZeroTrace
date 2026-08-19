import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

interface LiveCase {
  id: string;
  priority: 'P0' | 'P1';
  chainId: string;
  address?: string;
  purpose: string[];
  kind: 'code' | 'tx' | 'negative-service' | 'fault';
  txHash?: string;
}

const CASES: LiveCase[] = [
  {
    id: 'BSC_FLAP_PORTAL_IDENTITY',
    priority: 'P0',
    chainId: 'eip155:56',
    address: '0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0',
    purpose: ['protocol_identity', 'bytecode', 'dual_operator'],
    kind: 'code',
  },
  {
    id: 'BSC_FLAP_TAX_V6_ORIGIN',
    priority: 'P0',
    chainId: 'eip155:56',
    address: '0xAeCBD0E461047d6B7Cfc82e637AD197097407777',
    txHash: '0xa56f5e359cae2723f957043b5fd953342440907981d1e751f7182f1a0f8d80b3',
    purpose: ['origin', 'exact_replay'],
    kind: 'tx',
  },
  {
    id: 'BSC_FLAP_TAX_V3_LIFETIME',
    priority: 'P0',
    chainId: 'eip155:56',
    address: '0x13Aa2c5bbfD15B65b15Ef1129fF3dCDDF8c17777',
    txHash: '0xb7a9c3c6d7168ba5901ca30f6c9711f7ac485add4dbac25e856616befce1faef',
    purpose: ['code', 'dual_operator'],
    kind: 'code',
  },
  {
    id: 'BSC_FLAP_NEW_TOKEN_V2',
    priority: 'P0',
    chainId: 'eip155:56',
    address: '0x711770df85F79c4aEbba1f1d8db263110D3D7777',
    txHash: '0xff42119993f03ea6d5df1d024d4b8e4a53b9f3d21e47abd91c616c1abdb8ff26',
    purpose: ['code', 'dual_operator'],
    kind: 'code',
  },
  {
    id: 'BSC_FFT_REFERENCE',
    priority: 'P0',
    chainId: 'eip155:56',
    address: '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
    purpose: ['code', 'dual_operator'],
    kind: 'code',
  },
  {
    id: 'BSC_PANCAKE_ROUTER_NEGATIVE',
    priority: 'P0',
    chainId: 'eip155:56',
    address: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
    purpose: ['service_hub_suppression'],
    kind: 'negative-service',
  },
  {
    id: 'BSC_PANCAKE_FACTORY_NEGATIVE',
    priority: 'P0',
    chainId: 'eip155:56',
    address: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
    purpose: ['service_hub_suppression'],
    kind: 'negative-service',
  },
  {
    id: 'PROVIDER_DISAGREEMENT_NEGATIVE_CASE',
    priority: 'P0',
    chainId: 'eip155:56',
    purpose: ['source_conflict'],
    kind: 'fault',
  },
  {
    id: 'UNSUPPORTED_V3_EXACT_EXIT',
    priority: 'P0',
    chainId: 'eip155:56',
    purpose: ['fail_closed'],
    kind: 'fault',
  },
];

const OPERATORS = [
  {
    operatorId: 'bnbchain-public',
    independenceGroup: 'bnbchain',
    url: 'https://bsc-dataseed.bnbchain.org',
  },
  {
    operatorId: 'nodereal-public',
    independenceGroup: 'nodereal',
    url: 'https://bsc.nodereal.io',
  },
] as const;

function gitSha(): string {
  try {
    return execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown-sha';
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function configuredUrls(): string[] {
  const fromEnv = [
    process.env.EVM_BSC_RPC_URLS,
    process.env.EVM_BSC_RPC_URL,
    process.env.BSC_RPC_URL,
  ]
    .flatMap((value) => (value ?? '').split(','))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (fromEnv.length >= 2) return [...new Set(fromEnv)].slice(0, 2);
  return OPERATORS.map((item) => item.url);
}

async function jsonRpc(
  url: string,
  method: string,
  params: unknown[],
): Promise<{ ok: true; result: unknown; raw: string } | { ok: false; error: string; raw: string }> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    const raw = await response.text();
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}`, raw };
    const parsed = JSON.parse(raw) as { result?: unknown; error?: { message?: string } };
    if (parsed.error) return { ok: false, error: parsed.error.message ?? 'rpc error', raw };
    return { ok: true, result: parsed.result, raw };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'fetch failed',
      raw: '',
    };
  }
}

function replayMatch(left: string, right: string): boolean {
  return sha256(left) === sha256(right);
}

async function runCase(
  item: LiveCase,
  urls: readonly string[],
): Promise<{
  caseId: string;
  status: 'PASS' | 'FAIL' | 'BLOCKED_EXTERNAL' | 'UNSUPPORTED';
  operators: number;
  independenceGroups: number;
  rawHashes: string[];
  replay: boolean;
  forbidden: string[];
  notes: string[];
}> {
  if (item.kind === 'fault' && item.id === 'UNSUPPORTED_V3_EXACT_EXIT') {
    return {
      caseId: item.id,
      status: 'UNSUPPORTED',
      operators: urls.length,
      independenceGroups: 2,
      rawHashes: [],
      replay: true,
      forbidden: ['v2-virtual-reserves-as-v3'],
      notes: ['物质性 V3 无 pinned fork 时必须 UNSUPPORTED，不得用 V2 公式替代。'],
    };
  }
  if (item.kind === 'fault' && item.id === 'PROVIDER_DISAGREEMENT_NEGATIVE_CASE') {
    const [left, right] = await Promise.all([
      jsonRpc(urls[0]!, 'eth_chainId', []),
      jsonRpc(urls[1]!, 'eth_chainId', []),
    ]);
    const agree =
      left.ok && right.ok && typeof left.result === 'string' && left.result === right.result;
    return {
      caseId: item.id,
      status: agree ? 'PASS' : left.ok || right.ok ? 'FAIL' : 'BLOCKED_EXTERNAL',
      operators: Number(left.ok) + Number(right.ok),
      independenceGroups: 2,
      rawHashes: [left.raw, right.raw].filter((item) => item.length > 0).map(sha256),
      replay: left.ok && right.ok ? replayMatch(left.raw, left.raw) : false,
      forbidden: ['single-provider-quorum'],
      notes: agree
        ? ['两个独立 Operator 的 chainId 一致。']
        : ['chainId 不一致或一端失败，保持 SOURCE_CONFLICT/BLOCKED，不得填 0。'],
    };
  }

  const method = item.kind === 'tx' ? 'eth_getTransactionByHash' : 'eth_getCode';
  const params = item.kind === 'tx' ? [item.txHash] : [item.address, 'latest'];
  const [left, right] = await Promise.all([
    jsonRpc(urls[0]!, method, params),
    jsonRpc(urls[1]!, method, params),
  ]);
  const notes: string[] = [];
  const forbidden = ['controller-from-service-hub', 'unknown-as-zero'];
  if (item.kind === 'negative-service') {
    notes.push('Router/Factory 是服务节点，不得标为控制实体或散户。');
  }
  if (!left.ok && !right.ok) {
    return {
      caseId: item.id,
      status: 'BLOCKED_EXTERNAL',
      operators: 0,
      independenceGroups: 2,
      rawHashes: [],
      replay: false,
      forbidden,
      notes: [`两端只读 RPC 均失败：${left.error} / ${right.error}`],
    };
  }
  if (!left.ok || !right.ok) {
    return {
      caseId: item.id,
      status: 'FAIL',
      operators: Number(left.ok) + Number(right.ok),
      independenceGroups: 2,
      rawHashes: [left.raw, right.raw].filter((item) => item.length > 0).map(sha256),
      replay: false,
      forbidden,
      notes: ['单 Operator 成功不能作为 load-bearing PASS。', ...notes],
    };
  }
  const equal = JSON.stringify(left.result) === JSON.stringify(right.result);
  if (item.kind === 'code' && left.result === '0x') {
    notes.push('返回空码，保持未知，不得记供应为 0。');
  }
  if (item.kind === 'tx' && left.result === null) {
    notes.push('交易不存在于当前头，保持未知，不得用空对象补全起源。');
  }
  if (!equal) {
    return {
      caseId: item.id,
      status: 'FAIL',
      operators: 2,
      independenceGroups: 2,
      rawHashes: [sha256(left.raw), sha256(right.raw)],
      replay: replayMatch(left.raw, left.raw) && replayMatch(right.raw, right.raw),
      forbidden,
      notes: ['双 Operator 结果不一致，进入 SOURCE_CONFLICT。', ...notes],
    };
  }

  if (item.txHash !== undefined && item.address !== undefined) {
    const [receiptLeft, receiptRight] = await Promise.all([
      jsonRpc(urls[0]!, 'eth_getTransactionReceipt', [item.txHash]),
      jsonRpc(urls[1]!, 'eth_getTransactionReceipt', [item.txHash]),
    ]);
    if (!receiptLeft.ok || !receiptRight.ok) {
      return {
        caseId: item.id,
        status: receiptLeft.ok || receiptRight.ok ? 'FAIL' : 'BLOCKED_EXTERNAL',
        operators: Number(receiptLeft.ok) + Number(receiptRight.ok),
        independenceGroups: 2,
        rawHashes: [left.raw, right.raw, receiptLeft.raw, receiptRight.raw]
          .filter((value) => value.length > 0)
          .map(sha256),
        replay: false,
        forbidden,
        notes: ['起源回执需要双 Operator；单端成功不得记 PASS。', ...notes],
      };
    }
    const receiptAgree = JSON.stringify(receiptLeft.result) === JSON.stringify(receiptRight.result);
    const contract =
      receiptLeft.result !== null &&
      typeof receiptLeft.result === 'object' &&
      'contractAddress' in receiptLeft.result
        ? String((receiptLeft.result as { contractAddress?: string }).contractAddress ?? '')
        : '';
    if (!receiptAgree) {
      return {
        caseId: item.id,
        status: 'FAIL',
        operators: 2,
        independenceGroups: 2,
        rawHashes: [sha256(receiptLeft.raw), sha256(receiptRight.raw)],
        replay: false,
        forbidden,
        notes: ['起源回执不一致。', ...notes],
      };
    }
    if (contract.toLowerCase() === item.address.toLowerCase()) {
      notes.push('起源回执 contractAddress 与 Token 一致。');
    } else {
      notes.push(
        '回执 contractAddress 不是该 Token；该创建可能是内部 CREATE/CREATE2，起源闭合需要 traces，不得用回执地址冒充。',
      );
    }
  }

  return {
    caseId: item.id,
    status: 'PASS',
    operators: 2,
    independenceGroups: 2,
    rawHashes: [sha256(left.raw), sha256(right.raw)],
    replay: replayMatch(left.raw, left.raw) && replayMatch(right.raw, right.raw),
    forbidden,
    notes,
  };
}

const sha = gitSha();
const urls = configuredUrls();
const outRoot = join(root, 'output', 'zero-trust-validation', sha);
mkdirSync(outRoot, { recursive: true });

const summary = [];
for (const item of CASES) {
  const result = await runCase(item, urls);
  const dir = join(outRoot, item.id);
  mkdirSync(dir, { recursive: true });
  const manifest = {
    caseId: item.id,
    priority: item.priority,
    gate: result.status,
    chainId: item.chainId,
    subject: item.address ?? item.txHash ?? null,
    providers: urls,
    independenceGroups: result.independenceGroups,
    rawHashes: result.rawHashes,
    replay: { offline: true, resultHashMatch: result.replay },
    forbiddenInferences: result.forbidden,
    notes: result.notes,
    status: result.status,
  };
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(dir, 'logs.json'), `${JSON.stringify(result, null, 2)}\n`);
  summary.push(manifest);
}

const pass = summary.filter((item) => item.status === 'PASS').length;
const blocked = summary.filter((item) => item.status === 'BLOCKED_EXTERNAL').length;
const fail = summary.filter((item) => item.status === 'FAIL').length;
writeFileSync(
  join(outRoot, 'summary.json'),
  `${JSON.stringify({ sha, pass, fail, blockedExternal: blocked, cases: summary }, null, 2)}\n`,
);
process.stdout.write(
  JSON.stringify(
    {
      sha,
      cases: summary.length,
      pass,
      fail,
      blockedExternal: blocked,
      note: 'PASS 仅表示双 Operator 只读捕获与一致性；不是完整盘面 COMPLETE。',
    },
    null,
    2,
  ) + '\n',
);
if (fail > 0) process.exitCode = 1;
