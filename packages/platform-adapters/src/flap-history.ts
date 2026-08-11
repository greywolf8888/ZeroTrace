import {
  ProviderError,
  type EvmLedgerAdapter,
  type EvmLogReader,
  type EvmLogRecord,
  type EvmSnapshot,
} from '@zerotrace/chain-adapters';
import { createEvidence } from '@zerotrace/evidence';
import {
  AnalysisMetadataSchema,
  FlapEventHistorySchema,
  unknownValue,
  type AnalysisMetadata,
  type AnalysisSnapshot,
  type Evidence,
  type FlapEventHistory,
  type FlapEventTransaction,
} from '@zerotrace/schemas';
import { getAddress } from 'viem';

import {
  FLAP_EVENT_TOPIC0S,
  identifyFlapPortalEvent,
  inspectFlapEventTransaction,
} from './flap-events.js';
import type { FlapDeployment, FlapEvidenceWriter } from './flap.js';

export const FLAP_HISTORY_MODEL_VERSION = 'flap-bounded-event-history-v1';
export const FLAP_HISTORY_MAX_RANGE_BLOCKS = 50_000;
export const FLAP_HISTORY_DEFAULT_CHUNK_SIZE = 2_000;
export const FLAP_HISTORY_MAX_CHUNKS = 100;
export const FLAP_HISTORY_MAX_TRANSACTIONS = 250;
export const FLAP_HISTORY_MAX_LOGS = 25_000;

interface CandidateTransaction {
  transactionHash: string;
  blockNumber: string;
  blockHash: string;
  transactionIndex: string;
}

function decimalPosition(value: string, field: string): bigint {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new ProviderError('INVALID_RESPONSE', `Flap ${field} must be unsigned decimal.`);
  }
  return BigInt(value);
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  field: string,
): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > maximum) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      `Flap ${field} must be an integer from 1 through ${maximum}.`,
    );
  }
  return selected;
}

function canonicalAddress(value: string, field: string): string {
  try {
    return getAddress(value).toLowerCase();
  } catch (error) {
    throw new ProviderError('INVALID_RESPONSE', `Flap ${field} is not an EVM address.`, {
      cause: error,
    });
  }
}

function snapshotPosition(snapshot: AnalysisSnapshot): string {
  if (snapshot.ledger !== 'EVM') {
    throw new ProviderError('CHAIN_MISMATCH', 'Flap history requires an EVM Snapshot.');
  }
  return snapshot.blockNumber;
}

function compareCandidates(left: CandidateTransaction, right: CandidateTransaction): number {
  const blockOrder = BigInt(left.blockNumber) - BigInt(right.blockNumber);
  if (blockOrder !== 0n) return blockOrder < 0n ? -1 : 1;
  const transactionOrder = BigInt(left.transactionIndex) - BigInt(right.transactionIndex);
  if (transactionOrder !== 0n) return transactionOrder < 0n ? -1 : 1;
  return left.transactionHash.localeCompare(right.transactionHash);
}

function transactionEvidence(transaction: FlapEventTransaction): Evidence {
  const evidence = transaction.evidence.at(-1);
  if (evidence?.kind !== 'DERIVED_FEATURE') {
    throw new ProviderError(
      'INVALID_RESPONSE',
      'A discovered Flap event transaction lacks derived Evidence.',
    );
  }
  return evidence;
}

function metadata(
  snapshot: AnalysisSnapshot,
  sourceSet: readonly string[],
  evidenceIds: readonly string[],
  confidence: number,
): AnalysisMetadata {
  return AnalysisMetadataSchema.parse({
    snapshot,
    dataCoverage: 1,
    sourceCoverage: Math.min(1, new Set(sourceSet).size / 2),
    historyCoverage: 0,
    simulationCoverage: 0,
    freshness: snapshot.capturedAt,
    sourceSet: [...new Set(sourceSet)].sort(),
    modelVersion: FLAP_HISTORY_MODEL_VERSION,
    confidence,
    evidenceIds: [...new Set(evidenceIds)].sort(),
  });
}

export async function discoverFlapEventHistory(options: {
  adapter: EvmLedgerAdapter;
  logReader?: EvmLogReader;
  token: string;
  fromBlock: string;
  toBlock: string;
  deployment: FlapDeployment;
  writeEvidence: FlapEvidenceWriter;
  chunkSize?: number;
  maxTransactions?: number;
  maxLogs?: number;
}): Promise<FlapEventHistory> {
  const { adapter, deployment, writeEvidence } = options;
  const logReader = options.logReader ?? adapter;
  const token = canonicalAddress(options.token, 'history token');
  const portal = canonicalAddress(deployment.portal, 'history Portal');
  if (`eip155:${adapter.config.chainId}` !== deployment.chainId) {
    throw new ProviderError('CHAIN_MISMATCH', 'Flap deployment and EVM adapter chains differ.');
  }
  const fromBlock = decimalPosition(options.fromBlock, 'history fromBlock');
  const toBlock = decimalPosition(options.toBlock, 'history toBlock');
  if (toBlock < fromBlock) {
    throw new ProviderError('INVALID_RESPONSE', 'Flap history range ends before it begins.');
  }
  const range = toBlock - fromBlock + 1n;
  if (range > BigInt(FLAP_HISTORY_MAX_RANGE_BLOCKS)) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      `Flap history range exceeds ${FLAP_HISTORY_MAX_RANGE_BLOCKS} blocks.`,
    );
  }
  const chunkSize = boundedInteger(
    options.chunkSize,
    FLAP_HISTORY_DEFAULT_CHUNK_SIZE,
    10_000,
    'history chunkSize',
  );
  const maxTransactions = boundedInteger(
    options.maxTransactions,
    FLAP_HISTORY_MAX_TRANSACTIONS,
    FLAP_HISTORY_MAX_TRANSACTIONS,
    'history maxTransactions',
  );
  const maxLogs = boundedInteger(
    options.maxLogs,
    FLAP_HISTORY_MAX_LOGS,
    FLAP_HISTORY_MAX_LOGS,
    'history maxLogs',
  );
  const chunkCount = Number((range + BigInt(chunkSize) - 1n) / BigInt(chunkSize));
  if (chunkCount > FLAP_HISTORY_MAX_CHUNKS) {
    throw new ProviderError(
      'INVALID_RESPONSE',
      `Flap history query exceeds the ${FLAP_HISTORY_MAX_CHUNKS}-chunk request limit.`,
    );
  }

  const rangeEvidence: Evidence[] = [];
  const candidates = new Map<string, CandidateTransaction>();
  const candidateLogs = new Map<string, EvmLogRecord[]>();
  const rangeSources = new Set<string>();
  let upperSnapshot: EvmSnapshot | undefined;
  let unrecognizedPortalLogCount = 0;
  let observedLogCount = 0;

  for (let start = fromBlock; start <= toBlock; start += BigInt(chunkSize)) {
    const end = start + BigInt(chunkSize) - 1n > toBlock ? toBlock : start + BigInt(chunkSize) - 1n;
    const anchor = await adapter.readAnchorAt(end.toString());
    if (
      anchor.snapshot.ledger !== 'EVM' ||
      anchor.snapshot.chainId !== deployment.chainId ||
      snapshotPosition(anchor.snapshot) !== end.toString()
    ) {
      throw new ProviderError('CHAIN_MISMATCH', 'Flap history chunk Snapshot is inconsistent.');
    }
    upperSnapshot = anchor.snapshot;
    rangeSources.add(anchor.anchor.source);
    const observation = await logReader.getLogsObservation({
      address: portal,
      fromBlock: start.toString(),
      toBlock: end.toString(),
      topics: [FLAP_EVENT_TOPIC0S],
    });
    observedLogCount += observation.value.length;
    if (observedLogCount > maxLogs) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        `Flap history exceeds the ${maxLogs}-log result limit.`,
      );
    }
    rangeSources.add(observation.endpointId);
    const observationEvidence = await writeEvidence(
      createEvidence({
        ledger: 'EVM',
        chainId: deployment.chainId,
        kind: 'PROVIDER_OBSERVATION',
        source: observation.endpointId,
        locator: `flap-portal-logs:${portal}:${start}-${end}`,
        payload: {
          filter: { address: portal, fromBlock: start.toString(), toBlock: end.toString() },
          topics: FLAP_EVENT_TOPIC0S,
          logs: observation.value.map((log) => log.raw),
        },
        observedAt: anchor.snapshot.capturedAt,
        blockOrSlot: end.toString(),
        finality: anchor.snapshot.finality,
        summary: `Flap Portal logs observed for bounded block range ${start}-${end}.`,
      }),
      [],
      anchor.snapshot,
    );
    rangeEvidence.push(observationEvidence);

    for (const log of observation.value) {
      const identity = identifyFlapPortalEvent(log);
      if (identity === undefined) {
        unrecognizedPortalLogCount += 1;
        continue;
      }
      if (identity.token !== token) continue;
      const discoveredLogs = candidateLogs.get(identity.transactionHash) ?? [];
      discoveredLogs.push(log);
      candidateLogs.set(identity.transactionHash, discoveredLogs);
      const candidate = candidates.get(identity.transactionHash);
      if (candidate === undefined) {
        candidates.set(identity.transactionHash, {
          transactionHash: identity.transactionHash,
          blockNumber: identity.blockNumber,
          blockHash: identity.blockHash,
          transactionIndex: identity.transactionIndex,
        });
      } else if (
        candidate.blockNumber !== identity.blockNumber ||
        candidate.blockHash !== identity.blockHash ||
        candidate.transactionIndex !== identity.transactionIndex
      ) {
        throw new ProviderError(
          'INVALID_RESPONSE',
          'Flap history logs disagree about transaction placement.',
        );
      }
      if (candidates.size > maxTransactions) {
        throw new ProviderError(
          'INVALID_RESPONSE',
          `Flap history exceeds the ${maxTransactions}-transaction result limit.`,
        );
      }
    }
  }

  if (upperSnapshot === undefined) {
    throw new ProviderError('INVALID_RESPONSE', 'Flap history produced no replay Snapshot.');
  }
  const orderedCandidates = [...candidates.values()].sort(compareCandidates);
  const transactions: FlapEventTransaction[] = [];
  for (const candidate of orderedCandidates) {
    const transaction = await inspectFlapEventTransaction({
      adapter,
      token,
      transactionHash: candidate.transactionHash,
      expectedDiscoveryLogs: candidateLogs.get(candidate.transactionHash) ?? [],
      deployment,
      writeEvidence,
    });
    if (transaction.platformMatch.state !== 'known' || !transaction.platformMatch.value) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'A discovered Flap Portal log could not be reproduced from its receipt.',
      );
    }
    transactions.push(transaction);
  }

  const transactionSourceEvidence = transactions.map((transaction) =>
    transactionEvidence(transaction),
  );
  const sourceEvidenceIds = [
    ...rangeEvidence.map((evidence) => evidence.id),
    ...transactionSourceEvidence.map((evidence) => evidence.id),
  ];
  const chronology = orderedCandidates.map((candidate, index) => {
    const transaction = transactions[index];
    const evidence = transactionSourceEvidence[index];
    if (transaction === undefined || evidence === undefined) {
      throw new ProviderError('INVALID_RESPONSE', 'Flap history chronology is incomplete.');
    }
    return {
      ...candidate,
      transactionKind: transaction.transactionKind,
      decodedEventNames: transaction.decodedEventNames,
      evidenceIds: [evidence.id],
    };
  });
  const resultPayload = {
    token,
    requestedRange: {
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
      chunkSize,
      chunkCount,
    },
    chronology,
    unrecognizedPortalLogCount,
  };
  const resultEvidence = await writeEvidence(
    createEvidence({
      ledger: 'EVM',
      chainId: deployment.chainId,
      kind: transactions.length === 0 ? 'NEGATIVE_EVIDENCE' : 'DERIVED_FEATURE',
      source: `zerotrace:${FLAP_HISTORY_MODEL_VERSION}`,
      locator: `flap-event-history:${token}:${fromBlock}-${toBlock}`,
      payload: resultPayload,
      observedAt: upperSnapshot.capturedAt,
      blockOrSlot: toBlock.toString(),
      finality: upperSnapshot.finality,
      summary:
        transactions.length === 0
          ? 'No supported Flap event for the token was found in the requested bounded range.'
          : 'Flap event transactions discovered and replayed within the requested bounded range.',
      sourceEvidenceIds,
    }),
    sourceEvidenceIds,
    upperSnapshot,
  );
  const evidence = [...rangeEvidence, resultEvidence];
  const sourceSet = [
    ...rangeSources,
    ...transactions.flatMap((transaction) => transaction.metadata.sourceSet),
  ];
  const evidenceIds = [
    ...evidence.map((item) => item.id),
    ...transactionSourceEvidence.map((item) => item.id),
  ];
  return FlapEventHistorySchema.parse({
    platform: 'flap',
    token,
    requestedRange: resultPayload.requestedRange,
    requestedRangeCoverage: 1,
    lifetimeCoverage: unknownValue(
      'INSUFFICIENT_DATA',
      'The requested bounded range is complete, but token-lifetime coverage requires an evidenced deployment origin and continuous index.',
    ),
    chronology,
    transactions,
    unrecognizedPortalLogCount,
    metadata: metadata(
      upperSnapshot,
      sourceSet,
      evidenceIds,
      unrecognizedPortalLogCount === 0 ? 0.95 : 0.7,
    ),
    evidence,
  });
}
