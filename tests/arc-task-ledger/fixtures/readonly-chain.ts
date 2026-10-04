// 测试专用、ABI 编码的合成链；生产不导入，不声称主网观察。
import { decodeFunctionData, encodeFunctionResult } from 'viem';
import type { JsonRpcTransport } from '@zerotrace/chain-adapters/transport';
import { ABI, DEPLOYMENT } from '../../../packages/arc-task-ledger/src/config.js';
import { meta, receipt, event, transfer, completeLogs, WORKER, FEE, HASH } from './helpers.js';
import { protocolAtoms } from '../../../packages/arc-task-ledger/src/protocol.js';

export function readonlyChain(defaultRuling: boolean) {
  const height = BigInt(DEPLOYMENT.verifiedDeploymentBlock) + 2n;
  const anchor = { number: `0x${height.toString(16)}`, hash: HASH, parentHash: HASH };
  const raws = [
    [
      event('WorkerBondRefunded', { jobId: 8n, worker: WORKER, amount: 500000n }, 0),
      event('PayoutParked', { jobId: 8n, payee: WORKER, amount: 500000n }, 1),
    ],
    [
      transfer(DEPLOYMENT.adapter, WORKER, protocolAtoms('500000'), 0),
      event('WithdrawalClaimed', { payee: WORKER, amount: 500000n }, 1),
    ],
    [
      ...completeLogs().slice(0, 3),
      event('PayoutParked', { jobId: 8n, payee: WORKER, amount: 990000n }, 3),
      event(
        'DisputeResolved',
        { jobId: 8n, payProvider: true, rulingHash: 'local-only', defaultRuling },
        4,
      ),
    ],
  ].map((logs, index) => {
    const tx = `0x${String(index + 1).repeat(64)}`;
    const block = `0x${(height - (index < 2 ? 1n : 0n)).toString(16)}`;
    return receipt(
      logs.map((log) => ({ ...log, transactionHash: tx, blockNumber: block })),
      { transactionHash: tx, blockNumber: block, transactionIndex: `0x${index < 2 ? index : 0}` },
    );
  });
  const handler = (method: string, params: readonly unknown[]) => {
    if (method === 'eth_chainId') return '0x13b2';
    if (method === 'eth_getBlockByNumber')
      return params[0] === 'finalized' ? anchor : { ...anchor, number: params[0] };
    if (method === 'eth_getCode')
      return params[0] === DEPLOYMENT.adapter
        ? DEPLOYMENT.adapterCode
        : params[0] === DEPLOYMENT.escrow
          ? DEPLOYMENT.escrowCode
          : DEPLOYMENT.implementationCode;
    if (method === 'eth_getStorageAt')
      return `0x${'0'.repeat(24)}${DEPLOYMENT.escrowImplementation.slice(2)}`;
    if (method === 'eth_getTransactionReceipt')
      return params[0] === DEPLOYMENT.deploymentTransaction
        ? {
            ...receipt([], {
              transactionHash: DEPLOYMENT.deploymentTransaction,
              blockNumber: `0x${BigInt(DEPLOYMENT.verifiedDeploymentBlock).toString(16)}`,
            }),
            contractAddress: DEPLOYMENT.adapter,
          }
        : raws.find((r) => r.transactionHash === params[0]);
    if (method === 'eth_getLogs') {
      const range = params[0] as { fromBlock: string; toBlock: string };
      return raws.flatMap((r) =>
        r.logs.filter(
          (l) =>
            l.address.toLowerCase() === DEPLOYMENT.adapter &&
            BigInt(l.blockNumber) >= BigInt(range.fromBlock) &&
            BigInt(l.blockNumber) <= BigInt(range.toBlock),
        ),
      );
    }
    if (method === 'eth_call') {
      const call = params[0] as { data: `0x${string}` };
      const { functionName, args } = decodeFunctionData({ abi: ABI, data: call.data });
      const state = meta({ requireWorkerBond: true });
      const decoded = Object.fromEntries(
        Object.entries(state).map(([key, value]) => [
          key,
          typeof value === 'string' && /^\d+$/.test(value) ? BigInt(value) : value,
        ]),
      );
      const values: Record<string, unknown> = {
        usdc: DEPLOYMENT.usdcErc20,
        agenticCommerce: DEPLOYMENT.escrow,
        feeBps: 100n,
        feeRecipient: FEE,
        totalBounties: 1n,
        allJobIds: 8n,
        getBountyMeta: decoded,
        pendingWithdrawals: String(args?.[0]).toLowerCase() === WORKER ? 990000n : 0n,
      };
      if (!(functionName in values)) throw new Error(`测试不支持 ${functionName}`);
      return encodeFunctionResult({ abi: ABI, functionName, result: values[functionName] });
    }
    throw new Error(`测试不允许 ${method}`);
  };
  const transport: JsonRpcTransport = {
    endpointId: 'test-only',
    request: async <T>(method: string, params: readonly unknown[] = []) =>
      handler(method, params) as T,
    requestSourced: async <T>(method: string, params: readonly unknown[] = []) => ({
      value: handler(method, params) as T,
      endpointId: 'test-only',
    }),
  };
  return transport;
}
