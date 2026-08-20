import { hashPayload } from '@zerotrace/evidence';
import { assertLoadBearingQuorum, type SourceOperator } from '@zerotrace/source-registry';

import { callBoth, fromHex, normalizeAddress, sha256Hex } from './rpc.js';
import { traceInternalCreate } from './trace.js';
import type {
  CaptureArtifact,
  CreationTraceSource,
  OriginObservation,
  RpcTransport,
  TokenCaptureRequest,
} from './types.js';

interface TxShape {
  hash?: string;
  from?: string;
  to?: string | null;
  blockNumber?: string | null;
}

interface ReceiptShape {
  status?: string;
  contractAddress?: string | null;
  blockNumber?: string;
  transactionHash?: string;
}

function creationMatchesToken(value: unknown, token: string, creationTx: string): boolean {
  if (value === null || typeof value !== 'object') return false;
  const record = value as { address?: unknown; transactionHash?: unknown };
  if (typeof record.address !== 'string' || typeof record.transactionHash !== 'string') {
    return false;
  }
  return (
    normalizeAddress(record.address) === token &&
    record.transactionHash.toLowerCase() === creationTx
  );
}

function originFields(input: {
  creationTx: string;
  txBody: TxShape;
  createdBlock?: string;
}): Pick<OriginObservation, 'creationTx' | 'deployer' | 'createdBlock'> {
  return {
    creationTx: input.creationTx,
    ...(input.txBody.from === undefined ? {} : { deployer: normalizeAddress(input.txBody.from) }),
    ...(input.createdBlock === undefined ? {} : { createdBlock: input.createdBlock }),
  };
}

export async function captureOrigin(input: {
  transport: RpcTransport;
  operators: readonly SourceOperator[];
  request: TokenCaptureRequest;
  traceAvailable?: boolean;
  traceEndpointId?: string;
  creationTraceSource?: CreationTraceSource;
  cachedOrigin?: OriginObservation;
}): Promise<{ origin: OriginObservation; artifacts: CaptureArtifact[] }> {
  const artifacts: CaptureArtifact[] = [];
  if (input.cachedOrigin?.status === 'COMPLETE') {
    return { origin: input.cachedOrigin, artifacts };
  }
  try {
    assertLoadBearingQuorum(input.operators);
  } catch (error) {
    return {
      origin: {
        status: 'FAILED',
        limitation: error instanceof Error ? error.message : '缺少两个独立 Operator。',
      },
      artifacts,
    };
  }
  const token = normalizeAddress(input.request.token);
  const endpoints = input.operators.map((item) => item.endpointId);
  const creationTx = input.request.creationTx?.toLowerCase();
  if (creationTx === undefined) {
    const code = await callBoth(input.transport, endpoints, 'eth_getCode', [token, 'latest']);
    artifacts.push(
      { path: 'rpc/code-left.json', sha256: sha256Hex(code.left.raw) },
      { path: 'rpc/code-right.json', sha256: sha256Hex(code.right.raw) },
    );
    return {
      origin: {
        status: 'PARTIAL',
        ...(code.agree ? { codeHash: hashPayload(code.left.result) } : {}),
        limitation: '缺少起源交易，拒绝用空部署者或首笔 mint 冒充唯一创建。',
      },
      artifacts,
    };
  }

  const tx = await callBoth(input.transport, endpoints, 'eth_getTransactionByHash', [creationTx]);
  artifacts.push(
    { path: 'rpc/tx-left.json', sha256: sha256Hex(tx.left.raw) },
    { path: 'rpc/tx-right.json', sha256: sha256Hex(tx.right.raw) },
  );
  const receipt = await callBoth(input.transport, endpoints, 'eth_getTransactionReceipt', [
    creationTx,
  ]);
  artifacts.push(
    { path: 'rpc/receipt-left.json', sha256: sha256Hex(receipt.left.raw) },
    { path: 'rpc/receipt-right.json', sha256: sha256Hex(receipt.right.raw) },
  );
  const code = await callBoth(input.transport, endpoints, 'eth_getCode', [token, 'latest']);
  artifacts.push(
    { path: 'rpc/code-left.json', sha256: sha256Hex(code.left.raw) },
    { path: 'rpc/code-right.json', sha256: sha256Hex(code.right.raw) },
  );

  if (!tx.left.ok || !tx.right.ok || !receipt.left.ok || !receipt.right.ok) {
    return {
      origin: {
        status: 'FAILED',
        creationTx,
        limitation: '单 Operator 起源捕获不能作为 load-bearing 完成。',
      },
      artifacts,
    };
  }
  if (!tx.agree || !receipt.agree || !code.agree) {
    return {
      origin: {
        status: 'FAILED',
        creationTx,
        limitation: '起源交易/回执/字节码双 Operator 不一致，保持 SOURCE_CONFLICT。',
      },
      artifacts,
    };
  }
  const txBody = tx.left.result as TxShape | null;
  const receiptBody = receipt.left.result as ReceiptShape | null;
  if (txBody === null || receiptBody === null) {
    return {
      origin: {
        status: 'PARTIAL',
        creationTx,
        limitation: '当前头上看不到该交易，保持未知，不得补全部署者。',
      },
      artifacts,
    };
  }
  const created = receiptBody.contractAddress
    ? normalizeAddress(receiptBody.contractAddress)
    : undefined;
  const createdBlock =
    receiptBody.blockNumber === undefined
      ? undefined
      : fromHex(receiptBody.blockNumber).toString(10);
  const fields = originFields({
    creationTx,
    txBody,
    ...(createdBlock === undefined ? {} : { createdBlock }),
  });
  if (receiptBody.status !== '0x1') {
    return {
      origin: {
        status: 'FAILED',
        ...fields,
        limitation: '创建交易未成功，不得把失败回执当起源闭合。',
      },
      artifacts,
    };
  }
  if (created === token) {
    return {
      origin: {
        status: 'COMPLETE',
        ...fields,
        codeHash: hashPayload(code.left.result),
      },
      artifacts,
    };
  }

  const traceReady = input.traceAvailable === true && input.traceEndpointId !== undefined;
  let rpcTraceOk = false;
  if (traceReady) {
    const traced = await traceInternalCreate({
      transport: input.transport,
      endpointId: input.traceEndpointId!,
      txHash: creationTx,
      token,
    });
    artifacts.push({
      path: `rpc/trace-${traced.method ?? 'unavailable'}.json`,
      sha256: sha256Hex(traced.result.raw),
    });
    rpcTraceOk = traced.result.ok;
    if (traced.matched) {
      return {
        origin: {
          status: 'COMPLETE',
          ...fields,
          codeHash: hashPayload(code.left.result),
        },
        artifacts,
      };
    }
  }

  if (input.creationTraceSource !== undefined && createdBlock !== undefined) {
    const bulk = await input.creationTraceSource.getCreations({
      address: token,
      fromBlock: createdBlock,
      toBlock: createdBlock,
    });
    artifacts.push({ path: 'rpc/bulk-creation-traces.json', sha256: sha256Hex(bulk.raw) });
    if (bulk.ok && Array.isArray(bulk.result)) {
      if (bulk.result.some((item) => creationMatchesToken(item, token, creationTx))) {
        return {
          origin: {
            status: 'COMPLETE',
            ...fields,
            codeHash: hashPayload(code.left.result),
          },
          artifacts,
        };
      }
      return {
        origin: {
          status: 'PARTIAL',
          ...fields,
          limitationCode: 'TRACE_NO_MATCH',
          limitation:
            'TRACE_NO_MATCH：bulk CREATE traces 未出现对该 Token 与该交易的匹配。不得把工厂地址或回执 contractAddress 记为 Token。',
        },
        artifacts,
      };
    }
    return {
      origin: {
        status: 'PARTIAL',
        ...fields,
        limitationCode: 'TRACE_UNAVAILABLE',
        limitation: `TRACE_UNAVAILABLE：bulk CREATE traces 读取失败（${bulk.error ?? 'unknown'}）。不得用回执地址或 Explorer 替代。`,
      },
      artifacts,
    };
  }

  if (rpcTraceOk) {
    return {
      origin: {
        status: 'PARTIAL',
        ...fields,
        limitationCode: 'TRACE_NO_MATCH',
        limitation:
          'TRACE_NO_MATCH：traces 未出现对该 Token 的 CREATE/CREATE2。不得把工厂地址或回执 contractAddress 记为 Token。',
      },
      artifacts,
    };
  }

  return {
    origin: {
      status: 'PARTIAL',
      ...fields,
      limitationCode: 'TRACE_UNAVAILABLE',
      limitation: traceReady
        ? 'TRACE_UNAVAILABLE：通用 Trace RPC 与 bulk CREATE traces 均未能闭合该内部创建。不得用回执地址或 Explorer 替代。'
        : 'TRACE_UNAVAILABLE：回执 contractAddress 不是该 Token。工厂/内部 CREATE 需要 traces 才能唯一闭合起源，不得把回执地址或浏览器结果记为 Token。',
    },
    artifacts,
  };
}
