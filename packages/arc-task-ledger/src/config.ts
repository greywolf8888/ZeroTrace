import { hashPayload } from '@zerotrace/evidence';
import { keccak256, type Abi } from 'viem';
import abiJson from './abi.json' with { type: 'json' };
import lock from './deployment.json' with { type: 'json' };
import navigation from './navigation.json' with { type: 'json' };
import { LedgerError, address, decimal } from './types.js';
import { USDC_NETWORK } from './usdc-log.js';

export const ABI = abiJson as Abi;
export const NAVIGATION = navigation;
export const DEPLOYMENT = {
  ...lock,
  adapter: address(lock.adapter),
  escrow: address(lock.escrow),
  usdcErc20: address(lock.usdcErc20),
  usdcSystemEmitter: address(lock.usdcSystemEmitter),
};
if (
  hashPayload(abiJson) !== lock.abiHash ||
  keccak256(lock.adapterCode as `0x${string}`) !== lock.adapterCodeHash
)
  throw new LedgerError('LOCK_INVALID', '协议锁文件完整性核验失败。');
if (
  DEPLOYMENT.usdcSystemEmitter !== USDC_NETWORK.systemEmitter ||
  DEPLOYMENT.usdcErc20 !== USDC_NETWORK.erc20Emitter
)
  throw new LedgerError('LOCK_INVALID', '任务协议与USDC网络登记不一致。');
export function configFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const defaultSource = lock.rpcCandidates.find((source) => source.alias === lock.defaultRpcAlias);
  if (!defaultSource) throw new LedgerError('LOCK_INVALID', '默认 RPC 来源未登记。');
  const rpcUrl = env.ARC_RPC_URL ?? defaultSource.url;
  const rpcHosts = lock.rpcCandidates.map((source) => new URL(source.url).hostname);
  const port = Number(env.ARC_API_PORT ?? 8087);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
    throw new LedgerError('CONFIG_INVALID', 'API 端口不合法。');
  const databaseUrl = env.ARC_DATABASE_URL;
  if (!databaseUrl)
    throw new LedgerError('STORAGE_UNAVAILABLE', '请配置本组件专用 ARC_DATABASE_URL。');
  const maxJobs = Number(env.ARC_MAX_JOBS ?? 1000);
  if (!Number.isSafeInteger(maxJobs) || maxJobs < 1 || maxJobs > 10000)
    throw new LedgerError('CONFIG_INVALID', '任务采集上限不合法。');
  const scanBudget = decimal(env.ARC_SCAN_BLOCK_BUDGET ?? '20000');
  const recentBudget = decimal(env.ARC_RECENT_BLOCK_BUDGET ?? '2000');
  const proofBudget = decimal(env.ARC_PROOF_BLOCK_BUDGET ?? '2000');
  if (BigInt(recentBudget) > 2000n || BigInt(proofBudget) > 2000n)
    throw new LedgerError('CONFIG_INVALID', '最新变更与补证单轮各最多2000区块。', 400);
  const historyFromBlock = env.ARC_HISTORY_FROM_BLOCK
    ? decimal(env.ARC_HISTORY_FROM_BLOCK)
    : undefined;
  const snapshotBlock = env.ARC_SNAPSHOT_BLOCK ? decimal(env.ARC_SNAPSHOT_BLOCK) : undefined;
  if (
    historyFromBlock !== undefined &&
    BigInt(historyFromBlock) < BigInt(lock.verifiedDeploymentBlock)
  )
    throw new LedgerError('CONFIG_INVALID', '历史窗口不能早于已验证部署。', 400);
  if (
    snapshotBlock !== undefined &&
    BigInt(snapshotBlock) < BigInt(historyFromBlock ?? lock.verifiedDeploymentBlock)
  )
    throw new LedgerError('CONFIG_INVALID', '固定目标不能早于历史窗口。', 400);
  const evidenceBlocks = (env.ARC_EVIDENCE_BLOCKS ?? '').split(',').filter(Boolean).map(decimal);
  if (evidenceBlocks.length > 10) throw new LedgerError('CONFIG_INVALID', '定点区块最多10个。');
  const dnsMode = env.ARC_DNS_MODE ?? 'system';
  if (!['system', 'google-doh'].includes(dnsMode))
    throw new LedgerError('CONFIG_INVALID', 'DNS 模式不合法。');
  if (BigInt(scanBudget) < 1n || BigInt(scanBudget) > 200000n)
    throw new LedgerError('CONFIG_INVALID', '历史扫描预算不合法。');
  return {
    rpcUrl,
    rpcHosts,
    port,
    databaseUrl,
    maxJobs,
    scanBudget,
    recentBudget,
    proofBudget,
    historyFromBlock,
    snapshotBlock,
    evidenceBlocks,
    dnsMode: dnsMode as 'system' | 'google-doh',
    providerAlias:
      env.ARC_PROVIDER_ALIAS ??
      lock.rpcCandidates.find((source) => source.url === rpcUrl)?.alias ??
      'arc-configured-provider',
  };
}
