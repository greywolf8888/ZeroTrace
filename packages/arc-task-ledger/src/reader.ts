import { lookup } from 'node:dns';
import { Agent, fetch as pinnedFetch } from 'undici';
import { SafeJsonRpcTransport, type JsonRpcTransport } from '@zerotrace/chain-adapters/transport';
import { isPrivateOrReservedIp } from '@zerotrace/chain-adapters/security';
import {
  decodeFunctionResult,
  encodeFunctionData,
  keccak256,
  toFunctionSelector,
  type AbiFunction,
} from 'viem';
import { ABI, DEPLOYMENT, type configFromEnv } from './config.js';
import { assertMeta, rawEvidence } from './protocol.js';
import { createPublicDns } from './public-dns.js';
import {
  LedgerError,
  hex,
  type Snapshot,
  type RawMeta,
  type Receipt,
  type RawLog,
  type StoredEvidence,
} from './types.js';

const READ_METHODS = new Set([
  'eth_chainId',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getCode',
  'eth_call',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_getLogs',
  'eth_getStorageAt',
  'eth_getBalance',
]);
const SELECTORS = new Set(
  ABI.filter((item): item is AbiFunction => item.type === 'function').map((item) =>
    toFunctionSelector(item),
  ),
);
export function assertReadRequest(method: string, params: readonly unknown[]): void {
  if (!READ_METHODS.has(method))
    throw new LedgerError('METHOD_DENIED', '仅允许已登记的只读链方法。', 403);
  if (method === 'eth_call') {
    const call = params[0] as { to?: string; data?: string };
    if (
      call?.to?.toLowerCase() !== DEPLOYMENT.adapter ||
      !SELECTORS.has(call?.data?.slice(0, 10) as `0x${string}`)
    )
      throw new LedgerError('CALL_DENIED', '仅允许已锁定部署 ABI 的 view 调用。', 403);
  }
  if (
    method === 'eth_getStorageAt' &&
    (params[0] !== DEPLOYMENT.escrow ||
      params[1] !== '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc')
  )
    throw new LedgerError('STORAGE_READ_DENIED', '仅允许已登记代理的标准实现槽核验。', 403);
  if (method === 'eth_getLogs') {
    const query = params[0] as { address?: string; fromBlock?: string; toBlock?: string };
    if (
      query?.address?.toLowerCase() !== DEPLOYMENT.adapter ||
      query.fromBlock === undefined ||
      query.toBlock === undefined ||
      BigInt(query.toBlock) < BigInt(query.fromBlock) ||
      BigInt(query.toBlock) - BigInt(query.fromBlock) >= 2000n
    )
      throw new LedgerError('LOG_RANGE_DENIED', '日志必须限定本部署与受控区间。', 403);
  }
}
export class ArcReader {
  readonly evidence: StoredEvidence[] = [];
  readonly dispatcher?: Agent;
  readonly publicDns: ReturnType<typeof createPublicDns> | undefined;
  readonly transport: JsonRpcTransport;
  requests = 0;
  responseBytes = 0;
  constructor(
    config: Pick<ReturnType<typeof configFromEnv>, 'rpcUrl' | 'rpcHosts' | 'providerAlias'> & {
      dnsMode?: 'system' | 'google-doh';
    },
    testTransport?: JsonRpcTransport,
  ) {
    if (testTransport) {
      this.publicDns = undefined;
      this.transport = testTransport;
      return;
    }
    // 安全核验作用于实际连接使用的 DNS 结果，避免“检查后再次解析”的重绑定窗口。
    this.publicDns = config.dnsMode === 'google-doh' ? createPublicDns(config.rpcHosts) : undefined;
    const publicDns = this.publicDns;
    this.dispatcher = new Agent({
      connect: {
        lookup(hostname, options, callback) {
          if (publicDns) {
            void publicDns
              .resolve(hostname)
              .then((entries) => {
                if (entries.some((e) => isPrivateOrReservedIp(e.address)))
                  throw new LedgerError('PRIVATE_NETWORK_BLOCKED', '连接地址不是公网。');
                if (options.all) callback(null, entries);
                else callback(null, entries[0]!.address, entries[0]!.family);
              })
              .catch((error) => callback(error, '', 4));
            return;
          }
          lookup(hostname, { all: true }, (error, entries) => {
            if (error) {
              callback(error, '', 4);
              return;
            }
            if (entries.length === 0 || entries.some((e) => isPrivateOrReservedIp(e.address))) {
              callback(new Error('PRIVATE_NETWORK_BLOCKED'), '', 4);
              return;
            }
            if (options.all) callback(null, entries);
            else callback(null, entries[0]!.address, entries[0]!.family);
          });
        },
      },
    });
    const dispatcher = this.dispatcher;
    const secureFetch: typeof fetch = async (input, init) => {
      const response = await pinnedFetch(input.toString(), { ...init, dispatcher } as Parameters<
        typeof pinnedFetch
      >[1]);
      let bytes = 0;
      const body = (response.body as unknown as ReadableStream<Uint8Array> | null)?.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            bytes += chunk.byteLength;
            if (bytes > 4000000)
              throw new LedgerError('RESPONSE_SIZE_LIMIT', '链响应超过读取上限。');
            controller.enqueue(chunk);
          },
        }),
      );
      return new Response(body as ReadableStream<Uint8Array> | null, {
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers.entries()],
      });
    };
    this.transport = new SafeJsonRpcTransport({
      endpointId: config.providerAlias,
      baseUrl: config.rpcUrl,
      policy: {
        allowedHosts: config.rpcHosts,
        allowPrivateNetworks: false,
        ...(publicDns ? { resolveHostname: (hostname) => publicDns.resolve(hostname) } : {}),
      },
      timeoutMs: 12000,
      maxResponseBytes: 4000000,
      resilience: { requestsPerSecond: 2, maxAttempts: 2, cacheTtlMs: 0 },
      fetchImplementation: secureFetch,
    });
  }
  async read<T>(method: string, params: readonly unknown[] = []): Promise<T> {
    assertReadRequest(method, params);
    this.requests++;
    const result = await this.transport.request<T>(method, params, { cacheMode: 'bypass' });
    this.responseBytes += Buffer.byteLength(JSON.stringify(result));
    return result;
  }
  observe(raw: unknown, snapshot: Snapshot, locator: string, summary: string): StoredEvidence {
    const evidence = rawEvidence(raw, snapshot, locator, summary);
    this.evidence.push(evidence);
    return evidence;
  }
  async anchor(targetBlock?: string): Promise<Snapshot> {
    const chain = await this.read<string>('eth_chainId');
    if (BigInt(chain) !== 5042n)
      throw new LedgerError('WRONG_CHAIN', '数据源不是 Arc 主网 5042。', 409);
    const finalized = await this.read<{ number: string; hash: string; parentHash: string } | null>(
      'eth_getBlockByNumber',
      ['finalized', false],
    );
    if (!finalized || !/^0x[\da-fA-F]{64}$/.test(finalized.hash))
      throw new LedgerError('FINALITY_UNAVAILABLE', '无法读取可核验的 finalized 区块。');
    if (targetBlock !== undefined && BigInt(targetBlock) > BigInt(finalized.number))
      throw new LedgerError('TARGET_NOT_FINALIZED', '固定目标尚未达到来源声明的最终区块。', 409);
    const block = targetBlock === undefined ? finalized : await this.block(targetBlock);
    const snapshot: Snapshot = {
      chainId: '5042',
      blockNumber: BigInt(block.number).toString(),
      blockHash: block.hash.toLowerCase(),
      observedAt: new Date().toISOString(),
      finality: 'FINALIZED',
      sourceSet: [this.transport.endpointId],
    };
    this.observe(
      { chainId: chain, finalized, block },
      snapshot,
      'eth_chainId+eth_getBlockByNumber:finalized',
      '目标链与固定最终区块。',
    );
    if (this.publicDns)
      this.observe(
        this.publicDns.observations,
        snapshot,
        'public-dns:https',
        '本进程公网解析来源；私网/保留地址继续拒绝，TLS 主机核验保留。',
      );
    return snapshot;
  }
  async block(height: string): Promise<{ number: string; hash: string }> {
    const result = await this.read<{ number: string; hash: string } | null>(
      'eth_getBlockByNumber',
      [hex(height), false],
    );
    if (!result || BigInt(result.number) !== BigInt(height))
      throw new LedgerError('BLOCK_UNAVAILABLE', '无法核验指定区块。');
    return result;
  }
  async call(functionName: string, args: readonly unknown[], snapshot: Snapshot): Promise<unknown> {
    const data = encodeFunctionData({ abi: ABI, functionName, args });
    const raw = await this.read<`0x${string}`>('eth_call', [
      { to: DEPLOYMENT.adapter, data },
      hex(snapshot.blockNumber),
    ]);
    this.observe(
      {
        functionName,
        args: args.map((a) => (typeof a === 'bigint' ? a.toString() : a)),
        result: raw,
      },
      snapshot,
      `eth_call:${functionName}`,
      '固定区块合约只读状态。',
    );
    return decodeFunctionResult({ abi: ABI, functionName, data: raw });
  }
  async verifyDeployment(snapshot: Snapshot): Promise<void> {
    const receipt = await this.read<Receipt & { contractAddress: string }>(
      'eth_getTransactionReceipt',
      [DEPLOYMENT.deploymentTransaction],
    );
    if (
      !receipt ||
      receipt.status !== '0x1' ||
      receipt.contractAddress?.toLowerCase() !== DEPLOYMENT.adapter ||
      BigInt(receipt.blockNumber).toString() !== DEPLOYMENT.verifiedDeploymentBlock
    )
      throw new LedgerError('DEPLOYMENT_UNVERIFIED', '部署回执与源码验证来源不一致。', 409);
    if ((await this.block(BigInt(receipt.blockNumber).toString())).hash !== receipt.blockHash)
      throw new LedgerError('SOURCE_CONFLICT', '部署回执区块摘要不一致。', 409);
    this.observe(receipt, snapshot, 'deployment-receipt', '部署回执与 Sourcify 部署记录交叉核验。');
    for (const [target, expected] of [
      [DEPLOYMENT.adapter, DEPLOYMENT.adapterCode],
      [DEPLOYMENT.escrow, DEPLOYMENT.escrowCode],
      [DEPLOYMENT.escrowImplementation.toLowerCase(), DEPLOYMENT.implementationCode],
    ]) {
      const code = await this.read<`0x${string}`>('eth_getCode', [
        target,
        hex(snapshot.blockNumber),
      ]);
      this.observe(
        { target, code },
        snapshot,
        `eth_getCode:${target}`,
        '链上代码原始观察；版本不符时保留并隔离。',
      );
      if (!code || code === '0x' || keccak256(code) !== keccak256(expected as `0x${string}`))
        throw new LedgerError(
          'VERSION_QUARANTINED',
          '链上字节码与锁定版本不一致，解析已隔离。',
          409,
        );
    }
    const implementation = await this.read<string>('eth_getStorageAt', [
      DEPLOYMENT.escrow,
      '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
      hex(snapshot.blockNumber),
    ]);
    if (
      `0x${implementation.slice(-40)}`.toLowerCase() !==
      DEPLOYMENT.escrowImplementation.toLowerCase()
    )
      throw new LedgerError('VERSION_QUARANTINED', '代理实现地址已变化。', 409);
    this.observe(
      { implementation },
      snapshot,
      'escrow:EIP1967-implementation',
      '代理实现槽与已锁定版本核验。',
    );
    const usdc = await this.call('usdc', [], snapshot);
    const escrow = await this.call('agenticCommerce', [], snapshot);
    const fee = await this.call('feeBps', [], snapshot);
    if (
      String(usdc).toLowerCase() !== DEPLOYMENT.usdcErc20 ||
      String(escrow).toLowerCase() !== DEPLOYMENT.escrow ||
      typeof fee !== 'bigint' ||
      fee > 10000n
    )
      throw new LedgerError('DEPLOYMENT_UNVERIFIED', '部署 view 配置与锁定来源不一致。', 409);
    if ((await this.block(snapshot.blockNumber)).hash !== snapshot.blockHash)
      throw new LedgerError('SOURCE_CONFLICT', '同高度状态锚点变化，冻结确认。', 409);
  }
  async enumerate(
    snapshot: Snapshot,
    maxJobs: number,
  ): Promise<{ metas: RawMeta[]; total: string; errors: string[] }> {
    const total = String(await this.call('totalBounties', [], snapshot));
    const metas: RawMeta[] = [];
    const ids = new Set<string>();
    const errors: string[] = [];
    const count = BigInt(total) < BigInt(maxJobs) ? BigInt(total) : BigInt(maxJobs);
    for (let index = 0n; index < count; index++) {
      try {
        const id = String(await this.call('allJobIds', [index], snapshot));
        if (ids.has(id)) throw new Error('重复编号');
        ids.add(id);
        const decoded = await this.call('getBountyMeta', [BigInt(id)], snapshot);
        const meta = JSON.parse(
          JSON.stringify(decoded, (_key, value: unknown) =>
            typeof value === 'bigint' ? value.toString() : value,
          ),
        ) as RawMeta;
        assertMeta(meta, id);
        metas.push(meta);
      } catch {
        errors.push(`枚举位置 ${index} 未能完整核验。`);
      }
    }
    if (count < BigInt(total)) errors.push('达到任务枚举预算，范围不完整。');
    if ((await this.block(snapshot.blockNumber)).hash !== snapshot.blockHash)
      throw new LedgerError('SOURCE_CONFLICT', '固定高度状态读取前后摘要变化。', 409);
    return { metas, total, errors };
  }
  async logs(from: string, to: string): Promise<RawLog[]> {
    const logs = await this.read<RawLog[]>('eth_getLogs', [
      { address: DEPLOYMENT.adapter, fromBlock: hex(from), toBlock: hex(to) },
    ]);
    if (!Array.isArray(logs) || logs.length >= 10000)
      throw new LedgerError('LOG_PAGE_CAP', '日志达到单窗口上限，不能视为完整。');
    for (const log of logs)
      if (
        log.address.toLowerCase() !== DEPLOYMENT.adapter ||
        log.removed ||
        BigInt(log.blockNumber) < BigInt(from) ||
        BigInt(log.blockNumber) > BigInt(to)
      )
        throw new LedgerError('LOG_CONFLICT', '返回日志不属于受控范围。', 409);
    return logs;
  }
  async close(): Promise<void> {
    await this.dispatcher?.close();
    await this.publicDns?.close();
  }
}
