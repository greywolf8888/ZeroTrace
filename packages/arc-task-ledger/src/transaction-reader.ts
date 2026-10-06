import { ArcReader } from './reader.js';
import { type configFromEnv } from './config.js';
import {
  normalizeTransaction,
  parseTransactionInput,
  type RawAcquisition,
  type Acquisition,
  type BlockRaw,
  type TransactionRaw,
} from './verifier-core.js';
import { LedgerError, hex, type Receipt } from './types.js';

export interface TransactionObservation {
  originalAcquisitionMetrics?: TransactionObservation['metrics'];
  taskContext?: {
    schemaVersion: 'zasv-task-context-v1';
    jobId: string;
    legId: string;
    snapshotRunId: string;
    ruleVersion: string;
    expectedPayee: string;
    expectedMovementPayer?: string;
    expectedAmountAtomic18: string;
    evidenceIds: string[];
    rawEvidence: unknown[];
  };
  transactionHash: string;
  raw: RawAcquisition;
  acquisition: Acquisition;
  source: {
    alias: string;
    observedAt: string;
    agreement: 'SINGLE_SOURCE';
    independence: 'NOT_VERIFIED';
    authenticity: 'RPC_SOURCE_REPORTED';
  };
  metrics: {
    elapsedMs: number;
    rpcRequests: number;
    rpcAttempts: number;
    responseBytes: number;
    cacheHit: boolean;
  };
  collectionError: string | null;
}
export function transactionCollector(
  config: Pick<
    ReturnType<typeof configFromEnv>,
    'rpcUrl' | 'rpcHosts' | 'providerAlias' | 'dnsMode'
  >,
  makeReader = () =>
    new ArcReader(config, undefined, {
      maxRequests: 24,
      maxResponseBytes: 8388608,
      deadlineMs: 45000,
    }),
) {
  const cache = new Map<
    string,
    { until: number; pending: Promise<TransactionObservation>; active: boolean }
  >();
  return async function collect(input: string, force = false): Promise<TransactionObservation> {
    const transactionHash = parseTransactionInput(input);
    const entry = cache.get(transactionHash);
    if (entry && (entry.active || (Date.now() < entry.until && !force))) {
      const start = Date.now();
      const original = await entry.pending;
      return {
        ...original,
        originalAcquisitionMetrics: original.originalAcquisitionMetrics ?? original.metrics,
        metrics: {
          elapsedMs: Date.now() - start,
          rpcRequests: 0,
          rpcAttempts: 0,
          responseBytes: 0,
          cacheHit: true,
        },
      };
    }
    for (const [key, value] of cache)
      if (!value.active && value.until <= Date.now()) cache.delete(key);
    if (cache.size >= 64)
      throw new LedgerError('ACQUISITION_CAPACITY', '当前有界核验容量已满，请稍后重试。', 429);
    const pending = (async () => {
      const reader = makeReader();
      const start = Date.now();
      let code: string | null = null;
      const raw: RawAcquisition = {
        chainId: '',
        transaction: null,
        receipt: null,
        finalized: null,
        blockBefore: null,
        blockAfter: null,
      };
      let acquisition: Acquisition;
      try {
        raw.chainId = await reader.read<string>('eth_chainId');
        if (BigInt(raw.chainId) !== 5042n)
          throw new LedgerError('WRONG_CHAIN', '来源不是Arc主网。', 409);
        raw.transaction = await reader.read<TransactionRaw | null>('eth_getTransactionByHash', [
          transactionHash,
        ]);
        raw.receipt = await reader.read<Receipt | null>('eth_getTransactionReceipt', [
          transactionHash,
        ]);
        raw.finalized = await reader.read<BlockRaw | null>('eth_getBlockByNumber', [
          'finalized',
          false,
        ]);
        if (raw.receipt) {
          const target = hex(BigInt(raw.receipt.blockNumber).toString());
          raw.blockBefore = await reader.read<BlockRaw | null>('eth_getBlockByNumber', [
            target,
            false,
          ]);
          raw.blockAfter = await reader.read<BlockRaw | null>('eth_getBlockByNumber', [
            target,
            false,
          ]);
        }
        acquisition = normalizeTransaction(transactionHash, raw);
      } catch (error) {
        const e = error as { code?: string; cause?: { code?: string } };
        const candidate = e.cause?.code ?? e.code;
        code =
          typeof candidate === 'string' && /^[A-Z0-9_]{1,80}$/.test(candidate)
            ? candidate
            : 'SOURCE_UNAVAILABLE';
        if (Date.now() - start >= 45000) code = 'READ_DEADLINE';
        const limit = /LIMIT|DEADLINE|ABORT|TIMEOUT/.test(code);
        acquisition = {
          state: limit ? 'LIMIT_REACHED' : code === 'WRONG_CHAIN' ? 'CONFLICT' : 'UNAVAILABLE',
          code,
          facts: null,
          completeness: 'INCOMPLETE',
        };
      } finally {
        await reader.close();
      }
      return {
        transactionHash,
        raw,
        acquisition,
        source: {
          alias: config.providerAlias,
          observedAt: new Date().toISOString(),
          agreement: 'SINGLE_SOURCE' as const,
          independence: 'NOT_VERIFIED' as const,
          authenticity: 'RPC_SOURCE_REPORTED' as const,
        },
        metrics: {
          elapsedMs: Date.now() - start,
          rpcRequests: reader.requests,
          rpcAttempts: reader.attempts || reader.requests,
          responseBytes: reader.receivedBytes,
          cacheHit: false,
        },
        collectionError: code,
      };
    })();
    cache.set(transactionHash, { until: Date.now() + 45000, pending, active: true });
    try {
      const result = await pending;
      cache.set(transactionHash, {
        until: Date.now() + 30000,
        pending: Promise.resolve(result),
        active: false,
      });
      return result;
    } catch (error) {
      cache.delete(transactionHash);
      throw error;
    }
  };
}
