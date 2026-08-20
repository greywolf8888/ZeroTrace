import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { redactSecret } from '@zerotrace/provider-plane';

import { loadConfig } from '../apps/api/src/config.js';
import { buildProviderPlaneBindings } from '../apps/api/src/provider-slots.js';
import { loadWorkspaceEnv } from '../apps/api/src/workspace-env.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FLAP_ORIGIN_TX = '0xa56f5e359cae2723f957043b5fd953342440907981d1e751f7182f1a0f8d80b3';
const TRACE_ATTEMPTS: ReadonlyArray<{ method: string; params: unknown[] }> = [
  { method: 'debug_traceTransaction', params: [FLAP_ORIGIN_TX, { tracer: 'callTracer' }] },
  { method: 'debug_jsTraceTransaction', params: [FLAP_ORIGIN_TX, { tracer: 'callTracer' }] },
  { method: 'trace_transaction', params: [FLAP_ORIGIN_TX] },
];

loadWorkspaceEnv(root);
const config = loadConfig(process.env);
const plane = buildProviderPlaneBindings(config);
const secrets = plane.secrets;

interface RpcProbe {
  ok: boolean;
  error?: string;
  resultType?: string;
}

async function rpc(
  url: string,
  method: string,
  params: unknown[],
  timeoutMs: number,
): Promise<RpcProbe> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const raw = redactSecret(await response.text(), secrets);
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    const parsed = JSON.parse(raw) as { result?: unknown; error?: { message?: string } };
    if (parsed.error) {
      return { ok: false, error: redactSecret(parsed.error.message ?? 'rpc error', secrets) };
    }
    const resultType = Array.isArray(parsed.result)
      ? 'array'
      : parsed.result === null
        ? 'null'
        : typeof parsed.result;
    return { ok: true, resultType };
  } catch (error) {
    return {
      ok: false,
      error: redactSecret(error instanceof Error ? error.message : 'fetch failed', secrets),
    };
  }
}

function upsertEnv(key: string, value: string): void {
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) return;
  const current = readFileSync(envPath, 'utf8');
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  const next = pattern.test(current)
    ? current.replace(pattern, line)
    : `${current.trimEnd()}\n${line}\n`;
  writeFileSync(envPath, next);
}

const keyed = plane.bindings.filter((item) =>
  plane.records.some(
    (record) =>
      record.providerId === item.providerId &&
      record.forensicGrade === 'FREE_KEYED' &&
      record.chainId === `eip155:${config.bscChainId}`,
  ),
);

const snapshots = [];
let boundTraceProviderId: string | undefined;
let boundTraceMethod: string | undefined;

for (const binding of keyed) {
  const record = plane.records.find((item) => item.providerId === binding.providerId);
  const chainId = await rpc(binding.fetchUrl, 'eth_chainId', [], 15_000);
  const historicalCode = await rpc(
    binding.fetchUrl,
    'eth_getCode',
    ['0x0000000000000000000000000000000000000000', '0x1'],
    20_000,
  );
  const smallLogs = await rpc(
    binding.fetchUrl,
    'eth_getLogs',
    [
      {
        fromBlock: 'latest',
        toBlock: 'latest',
        address: '0x0000000000000000000000000000000000000000',
      },
    ],
    20_000,
  );
  const traceAttempts = [];
  let traceOk = false;
  for (const attempt of TRACE_ATTEMPTS) {
    const probed = await rpc(binding.fetchUrl, attempt.method, attempt.params, 60_000);
    traceAttempts.push({
      method: attempt.method,
      ok: probed.ok,
      ...(probed.error === undefined ? {} : { error: probed.error }),
      ...(probed.resultType === undefined ? {} : { resultType: probed.resultType }),
    });
    if (probed.ok) {
      traceOk = true;
      if (boundTraceProviderId === undefined) {
        boundTraceProviderId = binding.providerId;
        boundTraceMethod = attempt.method;
        if (config.providerSlotStatus.BSC_TRACE_RPC_URL === 'UNCONFIGURED') {
          upsertEnv('BSC_TRACE_RPC_URL', binding.fetchUrl);
        }
      }
      break;
    }
  }
  snapshots.push({
    providerId: binding.providerId,
    operatorId: binding.operatorId,
    endpointRef: binding.endpointRef,
    forensicGrade: record?.forensicGrade,
    probedAt: new Date().toISOString(),
    chainIdOk: chainId.ok,
    historicalCodeOk: historicalCode.ok,
    smallLogsOk: smallLogs.ok,
    traceOk,
    traceAttempts,
    ...(chainId.error === undefined ? {} : { chainIdError: chainId.error }),
    ...(historicalCode.error === undefined ? {} : { historicalCodeError: historicalCode.error }),
    ...(smallLogs.error === undefined ? {} : { smallLogsError: smallLogs.error }),
  });
}

if (boundTraceProviderId === undefined) {
  const extraCandidates = ['https://bsc.drpc.org', 'https://1rpc.io/bnb'];
  for (const url of extraCandidates) {
    for (const attempt of TRACE_ATTEMPTS) {
      const probed = await rpc(url, attempt.method, attempt.params, 20_000);
      if (!probed.ok) continue;
      boundTraceProviderId = url;
      boundTraceMethod = attempt.method;
      if (config.providerSlotStatus.BSC_TRACE_RPC_URL === 'UNCONFIGURED') {
        upsertEnv('BSC_TRACE_RPC_URL', url);
      }
      snapshots.push({
        providerId: 'extra-public-trace',
        operatorId: 'extra-public-trace',
        endpointRef: url,
        forensicGrade: 'TRACE_SLOT',
        probedAt: new Date().toISOString(),
        chainIdOk: true,
        historicalCodeOk: false,
        smallLogsOk: 'POLICY_DENIED',
        traceOk: true,
        traceAttempts: [{ method: attempt.method, ok: true, resultType: probed.resultType }],
        note: '文档化公共端点探测到 TRACE；按通用 TRACE_SLOT 绑定。',
      });
      break;
    }
    if (boundTraceProviderId !== undefined) break;
  }
}

const document = {
  schemaVersion: 'zerotrace-provider-capability-keyed-v1',
  probedAt: new Date().toISOString(),
  note: '配置声明不能代替探测。密钥已脱敏。TRACE 仅在探测成功后写入通用 BSC_TRACE_RPC_URL。',
  slots: config.providerSlotStatus,
  boundTrace:
    boundTraceProviderId === undefined
      ? { status: 'UNCONFIGURED' }
      : {
          status: 'PROBED_OK',
          providerId: boundTraceProviderId,
          method: boundTraceMethod,
        },
  snapshots,
};

writeFileSync(
  join(root, 'docs/terminal-market-structure/provider-capability-snapshot-keyed.json'),
  `${JSON.stringify(document, null, 2)}\n`,
);
process.stdout.write(
  `${JSON.stringify(
    {
      keyedProviders: keyed.length,
      chainIdOk: snapshots.filter((item) => item.chainIdOk === true).length,
      historicalCodeOk: snapshots.filter((item) => item.historicalCodeOk === true).length,
      smallLogsOk: snapshots.filter((item) => item.smallLogsOk === true).length,
      boundTrace: document.boundTrace,
    },
    null,
    2,
  )}\n`,
);
