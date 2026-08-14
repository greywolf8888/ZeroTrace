import {
  ProviderError,
  type BitcoinTransactionRecord,
  type BitcoinUtxoLedgerAdapter,
} from '@zerotrace/chain-adapters';
import { createEvidence } from '@zerotrace/evidence';
import {
  buildBitcoinForensicGraph,
  type BitcoinForensicGraphBuildResult,
} from '@zerotrace/platform-adapters';
import {
  BitcoinForensicGraphReportSchema,
  BitcoinSnapshotSchema,
  type AnalysisSnapshot,
  type Evidence,
} from '@zerotrace/schemas';

import type { EvidenceWriter } from './ledger-query.js';

export interface BitcoinForensicGraphCaptureRequest {
  transactionIds: readonly string[];
}

export interface BitcoinForensicGraphCaptureResult extends BitcoinForensicGraphBuildResult {
  evidence: readonly Evidence[];
  sourceSummary: {
    sourceSet: readonly string[];
    snapshotStart: AnalysisSnapshot;
    snapshotEnd: AnalysisSnapshot;
    transactionCount: number;
    confirmed: true;
  };
}

export type BitcoinForensicGraphCaptureErrorCode =
  | 'BITCOIN_FORENSIC_GRAPH_INVALID_REQUEST'
  | 'BITCOIN_FORENSIC_GRAPH_PROVIDER_DOWN'
  | 'BITCOIN_FORENSIC_GRAPH_UNCONFIRMED'
  | 'BITCOIN_FORENSIC_GRAPH_REORG_RACE';

export class BitcoinForensicGraphCaptureError extends Error {
  readonly code: BitcoinForensicGraphCaptureErrorCode;
  readonly retryable: boolean;

  constructor(
    code: BitcoinForensicGraphCaptureErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'BitcoinForensicGraphCaptureError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function bitcoinSnapshot(snapshot: AnalysisSnapshot, field: string) {
  const parsed = BitcoinSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) {
    throw new BitcoinForensicGraphCaptureError(
      'BITCOIN_FORENSIC_GRAPH_PROVIDER_DOWN',
      `${field} is not a valid Bitcoin Snapshot.`,
      { retryable: true, cause: parsed.error },
    );
  }
  return parsed.data;
}

function ensureRequest(input: BitcoinForensicGraphCaptureRequest): string[] {
  const ids = sortedUnique(input.transactionIds.map((value) => value.trim().toLowerCase()));
  if (ids.length === 0 || ids.length > 100 || ids.some((id) => !/^[0-9a-f]{64}$/.test(id))) {
    throw new BitcoinForensicGraphCaptureError(
      'BITCOIN_FORENSIC_GRAPH_INVALID_REQUEST',
      'Bitcoin forensic graph capture requires 1 to 100 canonical transaction IDs.',
    );
  }
  return ids;
}

function assertHeadUnchanged(
  before: Awaited<ReturnType<BitcoinUtxoLedgerAdapter['readHeadAnchor']>>,
  after: Awaited<ReturnType<BitcoinUtxoLedgerAdapter['readHeadAnchor']>>,
): void {
  if (
    before.anchor.position !== after.anchor.position ||
    before.anchor.hash !== after.anchor.hash
  ) {
    throw new BitcoinForensicGraphCaptureError(
      'BITCOIN_FORENSIC_GRAPH_REORG_RACE',
      'Bitcoin best-chain tip changed during forensic graph capture; retry required.',
      { retryable: true },
    );
  }
}

export async function captureBitcoinForensicGraph(input: {
  adapter: BitcoinUtxoLedgerAdapter;
  request: BitcoinForensicGraphCaptureRequest;
  writeEvidence: EvidenceWriter;
}): Promise<BitcoinForensicGraphCaptureResult> {
  const transactionIds = ensureRequest(input.request);
  let before: Awaited<ReturnType<BitcoinUtxoLedgerAdapter['readHeadAnchor']>>;
  try {
    before = await input.adapter.readHeadAnchor();
  } catch (error) {
    throw new BitcoinForensicGraphCaptureError(
      'BITCOIN_FORENSIC_GRAPH_PROVIDER_DOWN',
      'Bitcoin best-chain anchor could not be read.',
      { retryable: true, cause: error },
    );
  }
  const transactionObservations: Array<{
    transaction: BitcoinTransactionRecord;
    endpointId: string;
    anchor: Awaited<ReturnType<BitcoinUtxoLedgerAdapter['readAnchorAt']>>;
  }> = [];
  const anchors = new Map<string, Awaited<ReturnType<BitcoinUtxoLedgerAdapter['readAnchorAt']>>>();
  try {
    for (const txid of transactionIds) {
      const observation = await input.adapter.getTransactionObservation(txid);
      if (!observation.value.status.confirmed) {
        throw new BitcoinForensicGraphCaptureError(
          'BITCOIN_FORENSIC_GRAPH_UNCONFIRMED',
          `Transaction ${txid} is unconfirmed; forensic graph capture requires best-chain transactions.`,
        );
      }
      const blockHeight = observation.value.status.blockHeight;
      const blockHash = observation.value.status.blockHash;
      if (blockHeight === undefined || blockHash === undefined) {
        throw new BitcoinForensicGraphCaptureError(
          'BITCOIN_FORENSIC_GRAPH_UNCONFIRMED',
          `Transaction ${txid} is missing confirmed block placement.`,
        );
      }
      let anchor = anchors.get(blockHeight);
      if (anchor === undefined) {
        anchor = await input.adapter.readAnchorAt(blockHeight);
        anchors.set(blockHeight, anchor);
      }
      if (anchor.anchor.hash !== blockHash) {
        throw new BitcoinForensicGraphCaptureError(
          'BITCOIN_FORENSIC_GRAPH_REORG_RACE',
          `Transaction ${txid} is not on the current best chain at height ${blockHeight}.`,
          { retryable: true },
        );
      }
      transactionObservations.push({
        transaction: observation.value,
        endpointId: observation.endpointId,
        anchor,
      });
    }
  } catch (error) {
    if (error instanceof BitcoinForensicGraphCaptureError) throw error;
    if (error instanceof ProviderError) {
      throw new BitcoinForensicGraphCaptureError(
        'BITCOIN_FORENSIC_GRAPH_PROVIDER_DOWN',
        error.message,
        { retryable: true, cause: error },
      );
    }
    throw error;
  }
  let after: Awaited<ReturnType<BitcoinUtxoLedgerAdapter['readHeadAnchor']>>;
  try {
    after = await input.adapter.readHeadAnchor();
  } catch (error) {
    throw new BitcoinForensicGraphCaptureError(
      'BITCOIN_FORENSIC_GRAPH_PROVIDER_DOWN',
      'Bitcoin best-chain anchor could not be re-read after graph capture.',
      { retryable: true, cause: error },
    );
  }
  assertHeadUnchanged(before, after);
  const endSnapshot = bitcoinSnapshot(after.snapshot, 'snapshotEnd');
  const orderedAnchors = [...anchors.values()].sort((left, right) =>
    BigInt(left.snapshot.ledger === 'BITCOIN' ? left.snapshot.height : '0') <
    BigInt(right.snapshot.ledger === 'BITCOIN' ? right.snapshot.height : '0')
      ? -1
      : 1,
  );
  const startSnapshot = bitcoinSnapshot(
    orderedAnchors[0]?.snapshot ?? before.snapshot,
    'snapshotStart',
  );
  const evidence: Evidence[] = [];
  const transactionEvidenceIds = new Map<string, string[]>();
  const sourceSet = new Set<string>();
  const blockEvidenceByHeight = new Map<string, Evidence>();
  for (const item of transactionObservations) {
    sourceSet.add(item.endpointId);
    const snapshot = bitcoinSnapshot(item.anchor.snapshot, `transaction ${item.transaction.txid}`);
    const transactionEvidence = await input.writeEvidence(
      createEvidence({
        ledger: 'BITCOIN',
        chainId: 'bitcoin-mainnet',
        kind: 'TRANSACTION',
        source: item.endpointId,
        locator: `transaction:${item.transaction.txid}@${snapshot.height}`,
        payload: item.transaction.raw,
        blockOrSlot: snapshot.height,
        finality: snapshot.finality,
        summary: 'Confirmed Bitcoin transaction captured at its best-chain block Snapshot.',
      }),
      [],
      snapshot,
    );
    evidence.push(transactionEvidence);
    let blockEvidence = blockEvidenceByHeight.get(snapshot.height);
    if (blockEvidence === undefined) {
      blockEvidence = await input.writeEvidence(
        createEvidence({
          ledger: 'BITCOIN',
          chainId: 'bitcoin-mainnet',
          kind: 'BLOCK',
          source: item.anchor.anchor.source,
          locator: `block:${snapshot.height}:${snapshot.blockHash}`,
          payload: item.anchor.payload,
          blockOrSlot: snapshot.height,
          finality: snapshot.finality,
          summary: 'Best-chain Bitcoin block anchor used to bind the forensic graph.',
        }),
        [],
        snapshot,
      );
      blockEvidenceByHeight.set(snapshot.height, blockEvidence);
      evidence.push(blockEvidence);
    }
    transactionEvidenceIds.set(item.transaction.txid, [transactionEvidence.id, blockEvidence.id]);
  }
  const draftGraph = buildBitcoinForensicGraph({
    rootTxids: transactionIds,
    transactions: transactionObservations.map((item) => item.transaction),
    snapshotStart: startSnapshot,
    snapshotEnd: endSnapshot,
    evidenceIds: sortedUnique([...transactionEvidenceIds.values()].flat()),
    transactionEvidenceIds,
    sourceSet: sortedUnique([...sourceSet, ...Object.keys(endSnapshot.providerVersions)]),
    dataCoverage: 1,
    sourceCoverage: sourceSet.size > 0 ? 1 : 0,
    historyCoverage: 0,
    freshness: endSnapshot.capturedAt,
  });
  for (const analysis of draftGraph.analyses) {
    const item = transactionObservations.find(
      (observation) => observation.transaction.txid === analysis.txid,
    );
    if (item === undefined) continue;
    const snapshot = bitcoinSnapshot(item.anchor.snapshot, `analysis ${analysis.txid}`);
    const derived = await input.writeEvidence(
      createEvidence({
        ledger: 'BITCOIN',
        chainId: 'bitcoin-mainnet',
        kind: 'DERIVED_FEATURE',
        source: 'zerotrace:bitcoin-transaction-entity-v1.0.0',
        locator: `transaction-entity:${analysis.txid}@${snapshot.height}`,
        payload: analysis,
        blockOrSlot: snapshot.height,
        finality: snapshot.finality,
        summary:
          analysis.structuralPattern === 'EQUAL_OUTPUT_COINJOIN_LIKE'
            ? 'CoinJoin-like output structure suppresses ownership clustering.'
            : 'Bitcoin transaction heuristics remain candidate Evidence and do not merge entities.',
      }),
      transactionEvidenceIds.get(analysis.txid),
      snapshot,
    );
    evidence.push(derived);
    transactionEvidenceIds.set(analysis.txid, [
      ...(transactionEvidenceIds.get(analysis.txid) ?? []),
      derived.id,
    ]);
  }
  const graph = buildBitcoinForensicGraph({
    rootTxids: transactionIds,
    transactions: transactionObservations.map((item) => item.transaction),
    snapshotStart: startSnapshot,
    snapshotEnd: endSnapshot,
    evidenceIds: sortedUnique([...transactionEvidenceIds.values()].flat()),
    transactionEvidenceIds,
    sourceSet: sortedUnique([...sourceSet, ...Object.keys(endSnapshot.providerVersions)]),
    dataCoverage: 1,
    sourceCoverage: sourceSet.size > 0 ? 1 : 0,
    historyCoverage: 0,
    freshness: endSnapshot.capturedAt,
  });
  BitcoinForensicGraphReportSchema.parse(graph.report);
  return {
    ...graph,
    evidence,
    sourceSummary: {
      sourceSet: sortedUnique([...sourceSet, ...Object.keys(endSnapshot.providerVersions)]),
      snapshotStart: startSnapshot,
      snapshotEnd: endSnapshot,
      transactionCount: transactionObservations.length,
      confirmed: true,
    },
  };
}
