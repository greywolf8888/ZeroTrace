import { hashPayload } from '@zerotrace/evidence';
import { assertLoadBearingQuorum, type SourceOperator } from '@zerotrace/source-registry';

import { callBoth, fromHex, normalizeAddress, sha256Hex } from './rpc.js';
import type {
  CaptureArtifact,
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

export async function captureOrigin(input: {
  transport: RpcTransport;
  operators: readonly SourceOperator[];
  request: TokenCaptureRequest;
}): Promise<{ origin: OriginObservation; artifacts: CaptureArtifact[] }> {
  const artifacts: CaptureArtifact[] = [];
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
  if (created !== token) {
    return {
      origin: {
        status: 'PARTIAL',
        creationTx,
        ...(txBody.from === undefined ? {} : { deployer: normalizeAddress(txBody.from) }),
        ...(createdBlock === undefined ? {} : { createdBlock }),
        limitation:
          '回执 contractAddress 不是该 Token。工厂/内部 CREATE 需要 traces 才能唯一闭合起源，不得把回执地址记为 Token。',
      },
      artifacts,
    };
  }
  if (receiptBody.status !== '0x1') {
    return {
      origin: {
        status: 'FAILED',
        creationTx,
        limitation: '创建交易未成功，不得把失败回执当起源闭合。',
      },
      artifacts,
    };
  }
  return {
    origin: {
      status: 'COMPLETE',
      creationTx,
      ...(txBody.from === undefined ? {} : { deployer: normalizeAddress(txBody.from) }),
      ...(createdBlock === undefined ? {} : { createdBlock }),
      codeHash: hashPayload(code.left.result),
    },
    artifacts,
  };
}
