import { it, expect, vi } from 'vitest';
import { ArcReader } from '../../../packages/arc-task-ledger/src/reader.js';
import { transactionCollector } from '../../../packages/arc-task-ledger/src/transaction-reader.js';
import { LedgerError } from '../../../packages/arc-task-ledger/src/types.js';
import { verifierObservation } from '../fixtures/verifier-observation.js';
import type { JsonRpcTransport } from '@zerotrace/chain-adapters/transport';
const config = {
  rpcUrl: 'https://rpc.mainnet.arc.io',
  rpcHosts: ['rpc.mainnet.arc.io'],
  providerAlias: 'test-only',
};
function transport(
  fn: (method: string, params: readonly unknown[]) => unknown | Promise<unknown>,
): JsonRpcTransport {
  return {
    endpointId: 'test-only',
    request: async <T>(m: string, p: readonly unknown[] = []) => (await fn(m, p)) as T,
    requestSourced: async <T>(m: string, p: readonly unknown[] = []) => ({
      value: (await fn(m, p)) as T,
      endpointId: 'test-only',
    }),
  };
}
it('同一交易进行中的强制与普通请求合并，缓存不发RPC，显式重查绕过完成缓存', async () => {
  const o = verifierObservation();
  const fn = vi.fn(async (m: string) => {
    await Promise.resolve();
    if (m === 'eth_chainId') return o.raw.chainId;
    if (m === 'eth_getTransactionByHash') return o.raw.transaction;
    if (m === 'eth_getTransactionReceipt') return o.raw.receipt;
    if (m === 'eth_getBlockByNumber') return o.raw.blockBefore;
    throw Error('test-only unexpected method');
  });
  const factory = vi.fn(() => new ArcReader(config, transport(fn), { maxRequests: 24 }));
  const collect = transactionCollector(config, factory);
  const values = await Promise.all([
    collect(o.transactionHash),
    collect(o.transactionHash, true),
    collect(o.transactionHash),
  ]);
  expect(values.every((x) => x.acquisition.state === 'READY')).toBe(true);
  expect(factory).toHaveBeenCalledTimes(1);
  expect(fn).toHaveBeenCalledTimes(6);
  expect((await collect(o.transactionHash)).metrics.cacheHit).toBe(true);
  expect((await collect(o.transactionHash)).metrics.rpcRequests).toBe(0);
  expect((await collect(o.transactionHash)).originalAcquisitionMetrics?.rpcRequests).toBe(6);
  expect(fn).toHaveBeenCalledTimes(6);
  await collect(o.transactionHash, true);
  expect(factory).toHaveBeenCalledTimes(2);
  expect(fn).toHaveBeenCalledTimes(12);
});
it('次数与响应体预算触发LIMIT_REACHED；429/来源失败保留原因不产生0金额', async () => {
  const o = verifierObservation();
  const limited = transactionCollector(
    config,
    () =>
      new ArcReader(
        config,
        transport(() => o.raw.chainId),
        { maxRequests: 1 },
      ),
  );
  expect(await limited(o.transactionHash)).toMatchObject({
    acquisition: { state: 'LIMIT_REACHED', facts: null },
    collectionError: 'RPC_REQUEST_LIMIT',
  });
  const oversized = transactionCollector(
    config,
    () =>
      new ArcReader(
        config,
        transport(() => 'x'.repeat(200)),
        { maxResponseBytes: 100 },
      ),
  );
  expect(await oversized(o.transactionHash)).toMatchObject({
    acquisition: { state: 'LIMIT_REACHED', facts: null },
    collectionError: 'RESPONSE_SIZE_LIMIT',
  });
  for (const code of ['HTTP_429', 'SOURCE_UNAVAILABLE', 'READ_DEADLINE']) {
    const collect = transactionCollector(
      config,
      () =>
        new ArcReader(
          config,
          transport(() => {
            throw new LedgerError(code, '仅测试来源失败');
          }),
          { maxRequests: 24 },
        ),
    );
    const result = await collect(o.transactionHash);
    expect(result.collectionError).toBe(code);
    expect(result.acquisition.facts).toBeNull();
    expect(result.acquisition.state).toBe(
      code === 'READ_DEADLINE' ? 'LIMIT_REACHED' : 'UNAVAILABLE',
    );
  }
});
