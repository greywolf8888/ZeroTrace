import {
  normalizeTransaction,
  parseExpectation,
} from '../../../packages/arc-task-ledger/src/verifier-core.js';
import type { TransactionObservation } from '../../../packages/arc-task-ledger/src/transaction-reader.js';
import { POSTER, WORKER, TX, HASH, transfer, receipt } from './helpers.js';
export function verifierObservation(): TransactionObservation {
  const block = { hash: HASH, number: '0x14fb180', timestamp: '0x68e09000', transactions: [TX] };
  const raw = {
    chainId: '0x13b2',
    transaction: {
      hash: TX,
      from: POSTER,
      to: WORKER,
      value: '0xde0b6b3a7640000',
      blockHash: HASH,
      blockNumber: block.number,
      transactionIndex: '0x0',
    },
    receipt: receipt(
      [{ ...transfer(POSTER, WORKER, '1000000000000000000', 0), transactionIndex: '0x0' }],
      { transactionIndex: '0x0' },
    ),
    finalized: block,
    blockBefore: block,
    blockAfter: block,
  };
  return {
    transactionHash: TX,
    raw,
    acquisition: normalizeTransaction(TX, raw),
    source: {
      alias: 'test-only',
      observedAt: '2026-10-07T00:00:00Z',
      agreement: 'SINGLE_SOURCE',
      independence: 'NOT_VERIFIED',
      authenticity: 'RPC_SOURCE_REPORTED',
    },
    metrics: { elapsedMs: 1, rpcRequests: 6, rpcAttempts: 6, responseBytes: 100, cacheHit: false },
    collectionError: null,
  };
}
export const verifierCondition = () =>
  parseExpectation({
    schemaVersion: 'zasv-expectation-v1',
    chainId: '5042',
    asset: 'USDC',
    expectedPayee: WORKER,
    amountMode: 'EXACT',
    minAmountAtomic18: '1000000000000000000',
    maxAmountAtomic18: '1000000000000000000',
    selection: [`5042:${TX}:0`],
    provenance: 'USER_INPUT',
  });
