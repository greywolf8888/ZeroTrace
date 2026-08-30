import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SqdEvmLogReader, SqdPortalClient } from '@zerotrace/chain-adapters';
import {
  planCorpusIngestion,
  selectProviders,
  defaultBscPublicCatalog,
} from '@zerotrace/provider-plane';
import { PANCAKE_V2_BSC_DEPLOYMENT } from '@zerotrace/platform-adapters';

import { buildCorpusCandidateRecords, type CorpusCodeObservation } from './corpus-records.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FACTORY = PANCAKE_V2_BSC_DEPLOYMENT.factory;
const PAIR_CREATED = '0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9';
const SKIP = new Set([
  '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
  '0x55d398326f99059ff775485246999027b3197955',
  '0xe9e7cea3dedca5984780bafc599bd69add087d56',
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
  '0x10ed43c718714eb63d5aa57b78b54704e256024e',
  FACTORY.toLowerCase(),
]);

function topicAddress(topic: string): string {
  return `0x${topic.slice(-40).toLowerCase()}`;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

const plan = planCorpusIngestion({
  tokenCount: 50,
  bulkAvailable: true,
  keyedArchiveAvailable: false,
  traceAvailable: false,
});

const catalog = defaultBscPublicCatalog();
const snapshots = [];
for (const record of catalog) {
  try {
    const chainId = await rpc(record.endpointRef, 'eth_chainId', []);
    snapshots.push({
      providerId: record.providerId,
      chainIdOk: chainId === '0x38',
    });
  } catch {
    snapshots.push({ providerId: record.providerId, chainIdOk: false });
  }
}
const selection = selectProviders(
  catalog,
  {
    chainId: 'eip155:56',
    method: 'eth_getCode',
    params: ['0x0000000000000000000000000000000000000000', 'latest'],
    loadBearing: true,
  },
  snapshots.map((item) => ({
    providerId: item.providerId,
    operatorId: item.providerId,
    endpointRef: catalog.find((record) => record.providerId === item.providerId)?.endpointRef ?? '',
    probedAt: new Date().toISOString(),
    chainIdOk: item.chainIdOk,
    finalizedOk: false,
    historicalCodeOk: false,
    historicalCallOk: false,
    smallLogsOk: 'POLICY_DENIED' as const,
    traceOk: 'UNCONFIGURED' as const,
    batchOk: false,
    maxResponseBytes: 2_000_000,
  })),
);
const urls = selection.selected.map((item) => item.endpointRef);

async function rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(8_000),
  });
  const parsed = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (parsed.error) throw new Error(parsed.error.message ?? 'rpc');
  return parsed.result;
}

const portalUrl = process.env.SQD_PORTAL_URL ?? 'https://portal.sqd.dev';
const tokens: string[] = [];
let head = 0;
let windowFrom = 0;
let bulkError: string | undefined;

try {
  if (urls[0] === undefined) throw new Error('no public anchor operator');
  const headHex = (await rpc(urls[0], 'eth_blockNumber', [])) as string;
  head = Number.parseInt(headHex, 16);
  windowFrom = Math.max(0, head - 8_000);
  const source = new SqdPortalClient({
    portalUrl,
    dataset: 'binance-mainnet',
    policy: { allowedHosts: ['portal.sqd.dev'], allowPrivateNetworks: false },
    timeoutMs: 30_000,
    maxRangeBlocks: 5_000,
    requestsPerSecond: 2,
  });
  const reader = new SqdEvmLogReader({
    source,
    maxRangeBlocks: 5_000,
    maxResults: 5_000,
    includeAllBlocks: false,
  });
  let cursor = windowFrom;
  while (tokens.length < 50 && cursor <= head) {
    const to = Math.min(head, cursor + 1_999);
    const observation = await reader.getLogsObservation({
      address: FACTORY,
      fromBlock: String(cursor),
      toBlock: String(to),
      topics: [PAIR_CREATED],
    });
    for (const item of observation.value) {
      const token0 = item.topics[1] === undefined ? undefined : topicAddress(item.topics[1]);
      const token1 = item.topics[2] === undefined ? undefined : topicAddress(item.topics[2]);
      for (const token of [token0, token1]) {
        if (token === undefined || SKIP.has(token) || tokens.includes(token)) continue;
        tokens.push(token);
        if (tokens.length >= 50) break;
      }
      if (tokens.length >= 50) break;
    }
    cursor = to + 1;
  }
} catch (error) {
  bulkError = error instanceof Error ? error.message : 'sqd bulk failed';
}

const observations = new Map<string, CorpusCodeObservation[]>();
for (const token of tokens) {
  const values: CorpusCodeObservation[] = [];
  for (const [index, url] of urls.slice(0, 2).entries()) {
    const providerId = selection.selected[index]?.providerId ?? `operator-${index + 1}`;
    try {
      const code = await rpc(url, 'eth_getCode', [token, 'latest']);
      values.push(
        typeof code === 'string'
          ? { providerId, state: 'KNOWN', code }
          : { providerId, state: 'UNAVAILABLE', errorCode: 'INVALID_RESPONSE' },
      );
    } catch {
      values.push({ providerId, state: 'UNAVAILABLE', errorCode: 'PROVIDER_DOWN' });
    }
  }
  observations.set(token, values);
}
const records = buildCorpusCandidateRecords(tokens, observations);

const document = {
  schemaVersion: 'zerotrace-live-corpus-v1',
  capturedAt: new Date().toISOString(),
  head: head === 0 ? null : `0x${head.toString(16)}`,
  window: { fromBlock: windowFrom, toBlock: head },
  reviewed: false,
  deployment: {
    chainId: PANCAKE_V2_BSC_DEPLOYMENT.chainId,
    factory: PANCAKE_V2_BSC_DEPLOYMENT.factory,
    sourceRevision: PANCAKE_V2_BSC_DEPLOYMENT.sourceRevision,
    registryObservedAt: PANCAKE_V2_BSC_DEPLOYMENT.registryObservedAt,
  },
  queryPlan: plan,
  source: bulkError === undefined ? 'BULK_DATASET' : 'BLOCKED_NO_BULK',
  bulkError,
  note:
    bulkError === undefined
      ? 'Token 候选来自 SQD bulk PairCreated，再用两个独立公共 Operator 复核 bytecode。未经分析员核验，不得记 G12 PASS。禁止对公共节点逐 Token 扫描 eth_getLogs。'
      : `SQD bulk 不可用：${bulkError}。拒绝回退到公共 RPC 全量 getLogs。Corpus 保持未完成，不得记 G12 PASS。`,
  candidatesDiscovered: tokens.length,
  candidatesRecorded: records.length,
  records,
  // Backward-compatible token list for the existing resume tools. The records above are
  // authoritative and preserve unavailable, empty-code, rejected and undetermined states.
  tokens: records.map((record) => ({ token: record.token })),
};

const defaultOutput = join(
  root,
  'output',
  'corpus-runs',
  `token-corpus-${document.capturedAt.replaceAll(':', '-').replaceAll('.', '-')}.json`,
);
const outputPath = resolve(root, argument('--output') ?? defaultOutput);
if (existsSync(outputPath)) {
  throw new Error(`Corpus output already exists and will not be overwritten: ${outputPath}`);
}
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(
  `${JSON.stringify(
    {
      collected: records.length,
      agreed: records.filter((item) => item.verification === 'AGREED_CONTRACT').length,
      unavailable: records.filter((item) => item.verification === 'UNAVAILABLE').length,
      reviewed: false,
      source: document.source,
      bulkError,
      outputPath,
    },
    null,
    2,
  )}\n`,
);
