import { describe, it, expect, vi } from 'vitest';
import { encodeFunctionResult } from 'viem';
import type { JsonRpcTransport } from '@zerotrace/chain-adapters/transport';
import { ArcReader, assertReadRequest } from '../../../packages/arc-task-ledger/src/reader.js';
import { ABI, DEPLOYMENT } from '../../../packages/arc-task-ledger/src/config.js';
import { HASH, meta, snapshot } from '../fixtures/helpers.js';
const config = {
  rpcUrl: 'https://rpc.mainnet.arc.io',
  rpcHosts: ['rpc.mainnet.arc.io'],
  providerAlias: 'test-only',
};
it('固定历史目标不能超过finalized，实际读取与证据保留该高度', async () => {
  const reader = new ArcReader(
    config,
    fakeTransport((method, params) => {
      if (method === 'eth_chainId') return '0x13b2';
      if (method === 'eth_getBlockByNumber')
        return { number: params[0] === 'finalized' ? '0x20' : params[0], hash: HASH };
      throw new Error('test-only');
    }),
  );
  await expect(reader.anchor('33')).rejects.toMatchObject({ code: 'TARGET_NOT_FINALIZED' });
  expect((await reader.anchor('31')).blockNumber).toBe('31');
  expect(reader.evidence.at(-1)?.raw).toMatchObject({
    finalized: { number: '0x20' },
    block: { number: '0x1f' },
  });
  await reader.close();
});
function fakeTransport(
  fn: (method: string, params: readonly unknown[]) => unknown,
): JsonRpcTransport {
  return {
    endpointId: 'test-only',
    request: async <T>(method: string, params: readonly unknown[] = []) => fn(method, params) as T,
    requestSourced: async <T>(method: string, params: readonly unknown[] = []) => ({
      value: fn(method, params) as T,
      endpointId: 'test-only',
    }),
  };
}
function stateResponse(ids: string[], failId?: string) {
  return fakeTransport((method, params) => {
    if (method === 'eth_getBlockByNumber') return { number: '0x14fb180', hash: HASH };
    const call = params[0] as { data: string };
    const selector = call.data.slice(0, 10);
    const names = ['totalBounties', 'allJobIds', 'getBountyMeta'];
    const abi = ABI.find((i) => i.type === 'function' && i.name === names[0]);
    void abi;
    // 从已锁定 ABI 编码真实字节布局；测试 transport 仅存在 test 目录。
    const index = BigInt('0x' + (call.data.slice(10) || '0'));
    if (call.data.length === 10)
      return encodeFunctionResult({
        abi: ABI,
        functionName: 'totalBounties',
        result: BigInt(ids.length),
      });
    if (index < BigInt(ids.length))
      return encodeFunctionResult({
        abi: ABI,
        functionName: 'allJobIds',
        result: BigInt(ids[Number(index)]!),
      });
    if (String(index) === failId) throw new Error('provider failure');
    const m = meta({ jobId: String(index) });
    const decoded = Object.fromEntries(
      Object.entries(m).map(([k, v]) => [
        k,
        [
          'jobId',
          'reward',
          'deadline',
          'agentId',
          'submittedAt',
          'rejectedAt',
          'disputeRaisedAt',
          'workerBond',
        ].includes(k)
          ? BigInt(String(v))
          : v,
      ]),
    );
    void selector;
    return encodeFunctionResult({ abi: ABI, functionName: 'getBountyMeta', result: decoded });
  });
}
describe('同区块读与只读权限', () => {
  it('ATL-21 枚举非连续大 ID', async () => {
    const r = new ArcReader(config, stateResponse(['8', '19', '104']));
    const result = await r.enumerate(snapshot, 100);
    expect(result.metas.map((m) => m.jobId)).toEqual(['8', '19', '104']);
    expect(result.errors).toEqual([]);
    expect(r.evidence.length).toBe(7);
  });
  it('ATL-22 部分读取失败保留成功原始证据', async () => {
    const r = new ArcReader(config, stateResponse(['8', '19', '104'], '19'));
    const result = await r.enumerate(snapshot, 100);
    expect(result.errors).toHaveLength(1);
    expect(result.metas.map((m) => m.jobId)).toEqual(['8', '104']);
    expect(result.total).toBe('3');
  });
  it('ATL-23 枚举预算不能冒充完整', async () => {
    const r = new ArcReader(config, stateResponse(['8', '19', '104']));
    const result = await r.enumerate(snapshot, 2);
    expect(result.metas).toHaveLength(2);
    expect(result.errors).toContain('达到任务枚举预算，范围不完整。');
  });
  it('ATL-28 同高度哈希变化关闭发布路径', async () => {
    const transport = stateResponse(['8']);
    const old = transport.request;
    transport.request = async <T>(method, params, options) =>
      method === 'eth_getBlockByNumber'
        ? ({ number: '0x14fb180', hash: `0x${'c'.repeat(64)}` } as T)
        : old<T>(method, params, options);
    await expect(new ArcReader(config, transport).enumerate(snapshot, 10)).rejects.toMatchObject({
      code: 'SOURCE_CONFLICT',
    });
  });
  it('ATL-30 错误链不回退测试网', async () => {
    await expect(
      new ArcReader(
        config,
        fakeTransport(() => '0x1'),
      ).anchor(),
    ).rejects.toMatchObject({ code: 'WRONG_CHAIN' });
  });
  it('ATL-31 未知代码先隔离', async () => {
    const r = new ArcReader(
      config,
      fakeTransport((method) =>
        method === 'eth_getTransactionReceipt'
          ? {
              status: '0x1',
              contractAddress: DEPLOYMENT.adapter,
              blockNumber: `0x${BigInt(DEPLOYMENT.verifiedDeploymentBlock).toString(16)}`,
              blockHash: HASH,
            }
          : method === 'eth_getBlockByNumber'
            ? { number: `0x${BigInt(DEPLOYMENT.verifiedDeploymentBlock).toString(16)}`, hash: HASH }
            : '0x6000',
      ),
    );
    await expect(r.verifyDeployment(snapshot)).rejects.toMatchObject({
      code: 'VERSION_QUARANTINED',
    });
  });
  it('ATL-35 所有签名与广播在网络前拒绝', async () => {
    const fn = vi.fn();
    const r = new ArcReader(config, fakeTransport(fn));
    for (const method of [
      'eth_sendRawTransaction',
      'eth_sendTransaction',
      'personal_sign',
      'eth_sign',
      'wallet_sendCalls',
      'eth_signTypedData_v4',
    ])
      await expect(r.read(method, [])).rejects.toMatchObject({ code: 'METHOD_DENIED' });
    expect(fn).not.toHaveBeenCalled();
  });
  it('变更合约函数 selector 不得通过 eth_call', () => {
    expect(() =>
      assertReadRequest('eth_call', [{ to: DEPLOYMENT.adapter, data: '0xa9059cbb' }]),
    ).toThrow();
  });
  it('ATL-37 真实供应源失败不能返回 fixture', async () => {
    const r = new ArcReader(
      config,
      fakeTransport(() => {
        throw new Error('provider unavailable');
      }),
    );
    await expect(r.anchor()).rejects.toThrow('provider unavailable');
    expect(r.evidence).toEqual([]);
  });
  it('ATL-41 对旧任务重新读状态不只读新增', async () => {
    const r = new ArcReader(config, stateResponse(['8', '19']));
    await r.enumerate(snapshot, 10);
    await r.enumerate(snapshot, 10);
    expect(
      r.evidence.filter(
        (e) => (e.raw as { functionName?: string }).functionName === 'getBountyMeta',
      ),
    ).toHaveLength(4);
  });
});
